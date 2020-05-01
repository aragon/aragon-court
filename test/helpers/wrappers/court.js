const { ACTIVATE_DATA } = require('../utils/jurors')
const { NEXT_WEEK, ONE_DAY } = require('../lib/time')
const { decodeEventsOfType } = require('../lib/decodeEvent')
const { MAX_UINT64, bn, bigExp } = require('../lib/numbers')
const { DISPUTE_MANAGER_EVENTS } = require('../utils/events')
const { getEvents, getEventArgument } = require('@aragon/test-helpers/events')
const { SALT, OUTCOMES, getVoteId, hashVote, oppositeOutcome, outcomeFor } = require('../utils/crvoting')

const PCT_BASE = bn(10000)

const DISPUTE_STATES = {
  PRE_DRAFT: bn(0),
  ADJUDICATING: bn(1),
  RULED: bn(2)
}

const ROUND_STATES = {
  INVALID: bn(0),
  COMMITTING: bn(1),
  REVEALING: bn(2),
  APPEALING: bn(3),
  CONFIRMING_APPEAL: bn(4),
  ENDED: bn(5)
}

const MODULE_IDS = {
  disputes: '0x14a6c70f0f6d449c014c7bbc9e68e31e79e8474fb03b7194df83109a2d888ae6',
  treasury: '0x06aa03964db1f7257357ef09714a5f0ca3633723df419e97015e0c7a3e83edb7',
  voting: '0x7cbb12e82a6d63ff16fe43977f43e3e2b247ecd4e62c0e340da8800a48c67346',
  registry: '0x3b21d36b36308c830e6c4053fb40a3b6d79dde78947fbf6b0accd30720ab5370',
  subscriptions: '0x2bfa3327fe52344390da94c32a346eeb1b65a8b583e4335a419b9471e88c1365'
}

const DEFAULTS = {
  termDuration:                       bn(ONE_DAY),     //  terms lasts one day
  firstTermStartTime:                 bn(NEXT_WEEK),   //  first term starts one week after mocked timestamp
  skippedDisputes:                    bn(0),           //  number of disputes to be skipped
  maxJurorsPerDraftBatch:             bn(10),          //  max number of jurors drafted per batch
  evidenceTerms:                      bn(4),           //  evidence period lasts 4 terms maximum
  commitTerms:                        bn(2),           //  vote commits last 2 terms
  revealTerms:                        bn(2),           //  vote reveals last 2 terms
  appealTerms:                        bn(2),           //  appeals last 2 terms
  appealConfirmTerms:                 bn(2),           //  appeal confirmations last 2 terms
  jurorFee:                           bigExp(10, 18),  //  10 fee tokens for juror fees
  draftFee:                           bigExp(30, 18),  //  30 fee tokens for draft fees
  settleFee:                          bigExp(40, 18),  //  40 fee tokens for settle fees
  penaltyPct:                         bn(100),         //  1% (1/10,000)
  finalRoundReduction:                bn(3300),        //  33% (1/10,000)
  firstRoundJurorsNumber:             bn(3),           //  disputes start with 3 jurors
  appealStepFactor:                   bn(3),           //  each time a new appeal occurs, the amount of jurors to be drafted will be incremented 3 times
  maxRegularAppealRounds:             bn(2),           //  there can be up to 2 appeals in total per dispute
  finalRoundLockTerms:                bn(10),          //  coherent jurors in the final round won't be able to withdraw for 10 terms
  appealCollateralFactor:             bn(25000),       //  permyriad multiple of dispute fees required to appeal a preliminary ruling (1/10,000)
  appealConfirmCollateralFactor:      bn(35000),       //  permyriad multiple of dispute fees required to confirm appeal (1/10,000)
  minActiveBalance:                   bigExp(100, 18), //  100 ANJ is the minimum balance jurors must activate to participate in the Court
  finalRoundWeightPrecision:          bn(1000),        //  use to improve division rounding for final round maths
  subscriptionPeriodDuration:         bn(10),          //  each subscription period lasts 10 terms
  subscriptionFeeAmount:              bigExp(100, 18), //  100 fee tokens per subscription period
  subscriptionGovernorSharePct:       bn(0)            //  none subscription governor shares
}

module.exports = (web3, artifacts) => {
  const { advanceBlocks } = require('../lib/blocks')(web3)

  class CourtHelper {
    constructor(web3, artifacts) {
      this.web3 = web3
      this.artifacts = artifacts
    }

    async getConfig(termId) {
      const { feeToken, fees, roundStateDurations, pcts, roundParams, appealCollateralParams, minActiveBalance } = await this.court.getConfig(termId)
      return {
        feeToken: await this.artifacts.require('ERC20Mock').at(feeToken),
        jurorFee: fees[0],
        draftFee: fees[1],
        settleFee: fees[2],
        evidenceTerms: roundStateDurations[0],
        commitTerms: roundStateDurations[1],
        revealTerms: roundStateDurations[2],
        appealTerms: roundStateDurations[3],
        appealConfirmTerms: roundStateDurations[4],
        penaltyPct: pcts[0],
        finalRoundReduction: pcts[1],
        firstRoundJurorsNumber: roundParams[0],
        appealStepFactor: roundParams[1],
        maxRegularAppealRounds: roundParams[2],
        finalRoundLockTerms: roundParams[3],
        appealCollateralFactor: appealCollateralParams[0],
        appealConfirmCollateralFactor: appealCollateralParams[1],
        minActiveBalance
      }
    }

    async getDispute(disputeId) {
      const { subject, possibleRulings, state, finalRuling, lastRoundId, createTermId } = await this.disputeManager.getDispute(disputeId)
      return { subject, possibleRulings, state, finalRuling, lastRoundId, createTermId }
    }

    async getRound(disputeId, roundId) {
      const { draftTerm, delayedTerms, jurorsNumber: roundJurorsNumber, selectedJurors, settledPenalties, jurorFees, collectedTokens, coherentJurors, state: roundState } = await this.disputeManager.getRound(disputeId, roundId)
      return { draftTerm, delayedTerms, roundJurorsNumber, selectedJurors, settledPenalties, jurorFees, collectedTokens, coherentJurors, roundState }
    }

    async getAppeal(disputeId, roundId) {
      const { maker: appealer, appealedRuling, taker, opposedRuling } = await this.disputeManager.getAppeal(disputeId, roundId)
      return { appealer, appealedRuling, taker, opposedRuling }
    }

    async getDisputeFees() {
      const { feeToken, totalFees } = await this.disputeManager.getDisputeFees()
      return { feeToken, disputeFees: totalFees }
    }

    async getNextRoundJurorsNumber(disputeId, roundId) {
      if (roundId < this.maxRegularAppealRounds.toNumber() - 1) {
        const { roundJurorsNumber } = await this.getRound(disputeId, roundId)
        let nextRoundJurorsNumber = this.appealStepFactor.mul(roundJurorsNumber)
        if (nextRoundJurorsNumber.mod(bn(2)).eq(bn(0))) nextRoundJurorsNumber = nextRoundJurorsNumber.add(bn(1))
        return nextRoundJurorsNumber
      } else {
        const finalRoundStartTerm = await this.getNextRoundStartTerm(disputeId, roundId)
        const totalActiveBalance = await this.jurorsRegistry.totalActiveBalanceAt(finalRoundStartTerm)
        return totalActiveBalance.mul(this.finalRoundWeightPrecision).div(this.minActiveBalance)
      }
    }

    async getNextRoundJurorFees(disputeId, roundId) {
      const jurorsNumber = await this.getNextRoundJurorsNumber(disputeId, roundId)
      let jurorFees = this.jurorFee.mul(jurorsNumber)
      if (roundId >= this.maxRegularAppealRounds.toNumber() - 1) {
        jurorFees = jurorFees.div(this.finalRoundWeightPrecision).mul(this.finalRoundReduction).div(PCT_BASE)
      }
      return jurorFees
    }

    async getAppealFees(disputeId, roundId) {
      const nextRoundJurorsNumber = await this.getNextRoundJurorsNumber(disputeId, roundId)
      const jurorFees = await this.getNextRoundJurorFees(disputeId, roundId)
      let appealFees = jurorFees

      if (roundId < this.maxRegularAppealRounds.toNumber() - 1) {
        const draftFees = this.draftFee.mul(nextRoundJurorsNumber)
        const settleFees = this.settleFee.mul(nextRoundJurorsNumber)
        appealFees = appealFees.add(draftFees).add(settleFees)
      }

      const appealDeposit = appealFees.mul(this.appealCollateralFactor).div(PCT_BASE)
      const confirmAppealDeposit = appealFees.mul(this.appealConfirmCollateralFactor).div(PCT_BASE)
      return { appealFees, appealDeposit, confirmAppealDeposit }
    }

    async getNextRoundStartTerm(disputeId, roundId) {
      const { draftTerm } = await this.getRound(disputeId, roundId)
      return draftTerm.add(this.commitTerms).add(this.revealTerms).add(this.appealTerms).add(this.appealConfirmTerms)
    }

    async getRoundJuror(disputeId, roundId, juror) {
      const { weight, rewarded } = await this.disputeManager.getJuror(disputeId, roundId, juror)
      return { weight, rewarded }
    }

    async getRoundLockBalance(disputeId, roundId, juror) {
      if (roundId < this.maxRegularAppealRounds) {
        const lockPerDraft = this.minActiveBalance.mul(this.penaltyPct).div(PCT_BASE)
        const { weight } = await this.getRoundJuror(disputeId, roundId, juror)
        return lockPerDraft.mul(weight)
      } else {
        const { draftTerm } = await this.getRound(disputeId, roundId)
        const draftActiveBalance = await this.jurorsRegistry.activeBalanceOfAt(juror, draftTerm)
        if (draftActiveBalance.lt(this.minActiveBalance)) return bn(0)
        return draftActiveBalance.mul(this.penaltyPct).div(PCT_BASE)
      }
    }

    async getFinalRoundWeight(disputeId, roundId, juror) {
      const { draftTerm } = await this.getRound(disputeId, roundId)
      const draftActiveBalance = await this.jurorsRegistry.activeBalanceOfAt(juror, draftTerm)
      if (draftActiveBalance.lt(this.minActiveBalance)) return bn(0)
      return draftActiveBalance.mul(this.finalRoundWeightPrecision).div(this.minActiveBalance)
    }

    async mintFeeTokens(to, amount) {
      await this.feeToken.generateTokens(to, amount)
    }

    async mintAndApproveFeeTokens(from, to, amount) {
      // reset allowance in case allowed address has already been approved some balance
      const allowance = await this.feeToken.allowance(from, to)
      if (allowance.gt(bn(0))) await this.feeToken.approve(to, 0, { from })

      // mint and approve tokens
      await this.mintFeeTokens(from, amount)
      await this.feeToken.approve(to, amount, { from })
    }

    async activate(jurors) {
      for (const { address, initialActiveBalance } of jurors) {
        await this.jurorToken.generateTokens(address, initialActiveBalance)
        await this.jurorToken.approveAndCall(this.jurorsRegistry.address, initialActiveBalance, ACTIVATE_DATA, { from: address })
      }
    }

    async dispute({ arbitrable = undefined, possibleRulings = bn(2), metadata = '0x', closeEvidence = true } = {}) {
      // create an arbitrable if no one was given
      if (!arbitrable) arbitrable = await this.artifacts.require('ArbitrableMock').new(this.court.address)

      // mint fee tokens for the arbitrable instance
      const { disputeFees } = await this.getDisputeFees()
      await this.mintFeeTokens(arbitrable.address, disputeFees)

      // create dispute and return id
      const receipt = await arbitrable.createDispute(possibleRulings, metadata)
      const logs = decodeEventsOfType(receipt, this.artifacts.require('DisputeManager').abi, DISPUTE_MANAGER_EVENTS.NEW_DISPUTE)
      const disputeId = getEventArgument({ logs }, DISPUTE_MANAGER_EVENTS.NEW_DISPUTE, 'disputeId')

      // close evidence submission if requested
      if (closeEvidence) {
        await this.passTerms(1)
        const currentTerm = await this.court.getCurrentTermId()
        const { draftTerm } = await this.getRound(disputeId, 0)
        if (draftTerm.gt(currentTerm)) await arbitrable.submitEvidence(disputeId, '0x', true)
      }

      return disputeId
    }

    async draft({ disputeId, draftedJurors = undefined, drafter = undefined }) {
      // if no drafter was given pick the third account
      if (!drafter) drafter = await this._getAccount(2)

      const { lastRoundId } = await this.getDispute(disputeId)
      const { draftTerm, roundJurorsNumber } = await this.getRound(disputeId, lastRoundId)

      // mock draft if there was a jurors set to be drafted
      if (draftedJurors) {
        const maxJurorsPerDraftBatch = await this.disputeManager.maxJurorsPerDraftBatch()
        const jurorsToBeDrafted = roundJurorsNumber.lt(maxJurorsPerDraftBatch)
          ? roundJurorsNumber.toNumber() : maxJurorsPerDraftBatch.toNumber()
        const totalWeight = draftedJurors.reduce((total, { weight }) => total + weight, 0)
        if (totalWeight !== jurorsToBeDrafted) throw Error('Given jurors to be drafted do not fit the batch jurors number')
        const jurors = draftedJurors.map(j => j.address)
        const weights = draftedJurors.map(j => j.weight)
        await this.jurorsRegistry.mockNextDraft(jurors, weights)
      }

      // move to draft term if needed
      const currentTerm = await this.court.getCurrentTermId()
      if (draftTerm.gt(currentTerm)) await this.passTerms(draftTerm.sub(currentTerm))
      else await this.advanceBlocks(2) // to ensure term randomness

      // draft and flat jurors with their weights
      const receipt = await this.disputeManager.draft(disputeId, { from: drafter })
      const logs = decodeEventsOfType(receipt, this.artifacts.require('DisputeManager').abi, DISPUTE_MANAGER_EVENTS.JUROR_DRAFTED)
      const weights = getEvents({ logs }, DISPUTE_MANAGER_EVENTS.JUROR_DRAFTED).reduce((jurors, event) => {
        const { juror } = event.args
        jurors[juror] = (jurors[juror] || bn(0)).add(bn(1))
        return jurors
      }, {})
      return Object.keys(weights).map(address => ({ address, weight: weights[address] }))
    }

    async commit({ disputeId, roundId, voters }) {
      // commit votes of each given voter
      const voteId = getVoteId(disputeId, roundId)
      for (let i = 0; i < voters.length; i++) {
        let { address, outcome } = voters[i]
        // if no outcome was set for the given outcome, pick one based on its index
        if (!outcome) outcome = outcomeFor(i)
        await this.voting.commit(voteId, hashVote(outcome), { from: address })
        if (outcome === OUTCOMES.LEAKED) {
          await this.voting.leak(voteId, address, outcome, SALT)
        }
      }

      // move to reveal period
      await this.passTerms(this.commitTerms)
    }

    async reveal({ disputeId, roundId, voters }) {
      // reveal votes of each given voter
      const voteId = getVoteId(disputeId, roundId)
      for (let i = 0; i < voters.length; i++) {
        let { address, outcome } = voters[i]
        // if no outcome was set for the given outcome, pick one based on its index
        if (!outcome) outcome = outcomeFor(i)
        if (outcome !== OUTCOMES.LEAKED) {
          await this.voting.reveal(voteId, address, outcome, SALT, { from: address })
        }
      }

      // move to appeal period
      await this.passTerms(this.revealTerms)
    }

    async appeal({ disputeId, roundId, appealMaker = undefined, ruling = undefined }) {
      // mint fee tokens for the appealer, if no appealer was given pick the fourth account
      if (!appealMaker) appealMaker = await this._getAccount(3)
      const { appealDeposit } = await this.getAppealFees(disputeId, roundId)
      await this.mintAndApproveFeeTokens(appealMaker, this.disputeManager.address, appealDeposit)

      // use the opposite to the round winning ruling for the appeal if no one was given
      if (!ruling) {
        const voteId = getVoteId(disputeId, roundId)
        const winningRuling = await this.voting.getWinningOutcome(voteId)
        ruling = oppositeOutcome(winningRuling)
      }

      // appeal and move to confirm appeal period
      await this.disputeManager.createAppeal(disputeId, roundId, ruling, { from: appealMaker })
      await this.passTerms(this.appealTerms)
    }

    async confirmAppeal({ disputeId, roundId, appealTaker = undefined, ruling = undefined }) {
      // mint fee tokens for the appeal taker, if no taker was given pick the fifth account
      if (!appealTaker) appealTaker = await this._getAccount(4)
      const { confirmAppealDeposit } = await this.getAppealFees(disputeId, roundId)
      await this.mintAndApproveFeeTokens(appealTaker, this.disputeManager.address, confirmAppealDeposit)

      // use the opposite ruling the one appealed if no one was given
      if (!ruling) {
        const { appealedRuling } = await this.getAppeal(disputeId, roundId)
        ruling = oppositeOutcome(appealedRuling)
      }

      // confirm appeal and move to end of confirm appeal period
      await this.disputeManager.confirmAppeal(disputeId, roundId, ruling, { from: appealTaker })
      await this.passTerms(this.appealConfirmTerms)
    }

    async moveToFinalRound({ disputeId }) {
      for (let roundId = 0; roundId < this.maxRegularAppealRounds.toNumber(); roundId++) {
        const draftedJurors = await this.draft({ disputeId })
        await this.commit({ disputeId, roundId, voters: draftedJurors })
        await this.reveal({ disputeId, roundId, voters: draftedJurors })
        await this.appeal({ disputeId, roundId })
        await this.confirmAppeal({ disputeId, roundId })
      }
    }

    async setConfig(termId, newConfig, txParams = { }) {
      if (!txParams.from) txParams.from = this.configGovernor

      const {
        feeToken,
        jurorFee, draftFee, settleFee,
        evidenceTerms, commitTerms, revealTerms, appealTerms, appealConfirmTerms,
        penaltyPct, finalRoundReduction,
        firstRoundJurorsNumber, appealStepFactor, maxRegularAppealRounds, finalRoundLockTerms,
        appealCollateralFactor, appealConfirmCollateralFactor,
        minActiveBalance
      } = newConfig

      return this.court.setConfig(
        termId,
        feeToken.address,
        [jurorFee, draftFee, settleFee],
        [evidenceTerms, commitTerms, revealTerms, appealTerms, appealConfirmTerms],
        [penaltyPct, finalRoundReduction],
        [firstRoundJurorsNumber, appealStepFactor, maxRegularAppealRounds, finalRoundLockTerms],
        [appealCollateralFactor, appealConfirmCollateralFactor],
        minActiveBalance,
        txParams
      )
    }

    async deploy(params) {
      Object.assign(this, { ...DEFAULTS, ...params })

      if (!this.fundsGovernor) this.fundsGovernor = await this._getAccount(0)
      if (!this.configGovernor) this.configGovernor = await this._getAccount(0)
      if (!this.modulesGovernor) this.modulesGovernor = await this._getAccount(0)
      if (!this.feeToken) this.feeToken = await this.artifacts.require('ERC20Mock').new('Court Fee Token', 'CFT', 18)
      if (!this.jurorToken) this.jurorToken = await this.artifacts.require('ERC20Mock').new('Aragon Network Juror Token', 'ANJ', 18)

      this.court = await this.artifacts.require('AragonCourtMock').new(
        [this.termDuration, this.firstTermStartTime],
        [this.fundsGovernor, this.configGovernor, this.modulesGovernor],
        this.feeToken.address,
        [this.jurorFee, this.draftFee, this.settleFee],
        [this.evidenceTerms, this.commitTerms, this.revealTerms, this.appealTerms, this.appealConfirmTerms],
        [this.penaltyPct, this.finalRoundReduction],
        [this.firstRoundJurorsNumber, this.appealStepFactor, this.maxRegularAppealRounds, this.finalRoundLockTerms],
        [this.appealCollateralFactor, this.appealConfirmCollateralFactor],
        this.minActiveBalance
      )

      if (!this.disputeManager) this.disputeManager = await this.artifacts.require('DisputeManager').new(this.court.address, this.maxJurorsPerDraftBatch, this.skippedDisputes)
      if (!this.voting) this.voting = await this.artifacts.require('CRVoting').new(this.court.address)
      if (!this.treasury) this.treasury = await this.artifacts.require('CourtTreasury').new(this.court.address)

      if (!this.jurorsRegistry) {
        this.jurorsRegistry = await this.artifacts.require('JurorsRegistryMock').new(
          this.court.address,
          this.jurorToken.address,
          this.minActiveBalance.mul(MAX_UINT64.div(this.finalRoundWeightPrecision))
        )
      }

      if (!this.subscriptions) {
        this.subscriptions = await this.artifacts.require('SubscriptionsMock').new(
          this.court.address,
          this.subscriptionPeriodDuration,
          this.feeToken.address,
          this.subscriptionFeeAmount,
          this.subscriptionGovernorSharePct
        )
      }

      const ids = Object.values(MODULE_IDS)
      const implementations = [this.disputeManager, this.treasury, this.voting, this.jurorsRegistry, this.subscriptions].map(i => i.address)
      await this.court.setModules(ids, implementations, { from: this.modulesGovernor })

      const zeroTermStartTime = this.firstTermStartTime.sub(this.termDuration)
      await this.setTimestamp(zeroTermStartTime)

      return this.court
    }

    async setTimestamp(timestamp) {
      await this.court.mockSetTimestamp(timestamp)
    }

    async increaseTimeInTerms(terms) {
      const seconds = this.termDuration.mul(bn(terms))
      await this.court.mockIncreaseTime(seconds)
    }

    async advanceBlocks(blocks) {
      await this.court.mockAdvanceBlocks(blocks)
    }

    async setTerm(termId) {
      // set timestamp corresponding to given term ID
      const timestamp = this.firstTermStartTime.add(this.termDuration.mul(bn(termId - 1)))
      await this.setTimestamp(timestamp)

      // call heartbeat function for X needed terms
      const neededTransitions = await this.court.getNeededTermTransitions()
      if (neededTransitions.gt(bn(0))) await this.court.heartbeat(neededTransitions)
    }

    async passTerms(terms) {
      // increase X terms based on term duration
      await this.increaseTimeInTerms(terms)
      // call heartbeat function for X terms
      await this.court.heartbeat(terms)
      // advance 2 blocks to ensure we can compute term randomness
      await this.advanceBlocks(2)
    }

    async passRealTerms(terms) {
      // increase X terms based on term duration
      await this.increaseTimeInTerms(terms)
      // call heartbeat function for X terms
      await this.court.heartbeat(terms)
      // advance 2 blocks to ensure we can compute term randomness
      await advanceBlocks(2)
    }

    async _getAccount(index) {
      const accounts = await this.web3.eth.getAccounts()
      return accounts[index]
    }
  }

  return {
    DEFAULTS,
    DISPUTE_STATES,
    ROUND_STATES,
    buildHelper: () => new CourtHelper(web3, artifacts)
  }
}
