const { sha3 } = require('web3-utils')
const { decodeEventsOfType } = require('./decodeEvent')
const { NEXT_WEEK, ONE_DAY } = require('./time')
const { MAX_UINT64, bn, bigExp } = require('./numbers')
const { getEvents, getEventArgument } = require('@aragon/os/test/helpers/events')
const { SALT, OUTCOMES, getVoteId, encryptVote, oppositeOutcome, outcomeFor } = require('../helpers/crvoting')

const PCT_BASE = bn(10000)

const DISPUTE_STATES = {
  PRE_DRAFT: bn(0),
  ADJUDICATING: bn(1),
  EXECUTED: bn(2)
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
  court: '0x26f3b895987e349a46d6d91132234924c6d45cfdc564b33427f53e3f9284955c',
  accounting: '0x3ec26b85a7d49ed13a920deeaceb063fa458eb25266fa7b504696047900a5b0f',
  voting: '0x7cbb12e82a6d63ff16fe43977f43e3e2b247ecd4e62c0e340da8800a48c67346',
  registry: '0x3b21d36b36308c830e6c4053fb40a3b6d79dde78947fbf6b0accd30720ab5370',
  subscriptions: '0x2bfa3327fe52344390da94c32a346eeb1b65a8b583e4335a419b9471e88c1365'
}

module.exports = (web3, artifacts) => {
  const { advanceBlocks } = require('../helpers/blocks')(web3)

  const DEFAULTS = {
    termDuration:                       bn(ONE_DAY),     //  terms lasts one day
    firstTermStartTime:                 bn(NEXT_WEEK),   //  first term starts one week after mocked timestamp
    commitTerms:                        bn(1),           //  vote commits last 1 term
    revealTerms:                        bn(1),           //  vote reveals last 1 term
    appealTerms:                        bn(1),           //  appeals last 1 term
    appealConfirmTerms:                 bn(1),           //  appeal confirmations last 1 term
    jurorFee:                           bigExp(10, 18),  //  10 fee tokens for juror fees
    heartbeatFee:                       bigExp(20, 18),  //  20 fee tokens for heartbeat fees
    draftFee:                           bigExp(30, 18),  //  30 fee tokens for draft fees
    settleFee:                          bigExp(40, 18),  //  40 fee tokens for settle fees
    penaltyPct:                         bn(100),         //  1% (1/10,000)
    finalRoundReduction:                bn(3300),        //  33% (1/10,000)
    firstRoundJurorsNumber:             bn(3),           //  disputes start with 3 jurors
    appealStepFactor:                   bn(3),           //  each time a new appeal occurs, the amount of jurors to be drafted will be incremented 3 times
    maxRegularAppealRounds:             bn(2),           //  there can be up to 2 appeals in total per dispute
    appealCollateralFactor:             bn(2),           //  multiple of juror fees required to appeal a preliminary ruling
    appealConfirmCollateralFactor:      bn(3),           //  multiple of juror fees required to confirm appeal
    jurorsMinActiveBalance:             bigExp(100, 18), //  100 ANJ is the minimum balance jurors must activate to participate in the Court
    finalRoundWeightPrecision:          bn(1000),        //  use to improve division rounding for final round maths

    subscriptionPeriodDuration:         bn(10),          //  each subscription period lasts 10 terms
    subscriptionFeeAmount:              bigExp(100, 18), //  100 fee tokens per subscription period
    subscriptionPrePaymentPeriods:      bn(15),          //  15 subscription pre payment period
    subscriptionResumePrePaidPeriods:   bn(10),          //  10 pre-paid periods when resuming activity
    subscriptionLatePaymentPenaltyPct:  bn(0),           //  none subscription late payment penalties
    subscriptionGovernorSharePct:       bn(0),           //  none subscription governor shares
  }

  class CourtHelper {
    constructor(web3, artifacts) {
      this.web3 = web3
      this.artifacts = artifacts
    }

    async getCourtConfig(termId) {
      const {
        feeToken,
        fees,
        roundStateDurations,
        pcts,
        roundParams,
        appealCollateralParams
      } = await this.court.getCourtConfig(termId)

      return {
        feeToken,
        jurorFee: fees[0],
        heartbeatFee: fees[1],
        draftFee: fees[2],
        settleFee: fees[3],
        commitTerms: roundStateDurations[0],
        revealTerms: roundStateDurations[1],
        appealTerms: roundStateDurations[2],
        appealConfirmTerms: roundStateDurations[3],
        penaltyPct: pcts[0],
        finalRoundReduction: pcts[1],
        firstRoundJurorsNumber: roundParams[0],
        appealStepFactor: roundParams[1],
        maxRegularAppealRounds: roundParams[2],
        appealCollateralFactor: appealCollateralParams[0],
        appealConfirmCollateralFactor: appealCollateralParams[1],
      }
    }

    async getDispute(disputeId) {
      const { subject, possibleRulings, state, finalRuling, lastRoundId } = await this.court.getDispute(disputeId)
      return { subject, possibleRulings, state, finalRuling, lastRoundId }
    }

    async getRound(disputeId, roundId) {
      const { draftTerm, delayedTerms, jurorsNumber: roundJurorsNumber, selectedJurors, triggeredBy, settledPenalties, jurorFees, collectedTokens, coherentJurors, state: roundState } = await this.court.getRound(disputeId, roundId)
      return { draftTerm, delayedTerms, roundJurorsNumber, selectedJurors, triggeredBy, settledPenalties, jurorFees, collectedTokens, coherentJurors, roundState }
    }

    async getAppeal(disputeId, roundId) {
      const { maker: appealer, appealedRuling, taker, opposedRuling } = await this.court.getAppeal(disputeId, roundId)
      return { appealer, appealedRuling, taker, opposedRuling }
    }

    async getDisputeFees(draftTermId) {
      const { feeToken, jurorFees, totalFees } = await this.court.getDisputeFees(draftTermId)
      return { feeToken, jurorFees, disputeFees: totalFees }
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
        return totalActiveBalance.mul(this.finalRoundWeightPrecision).div(this.jurorsMinActiveBalance)
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
      let appealFees = this.heartbeatFee.add(jurorFees)

      if (roundId < this.maxRegularAppealRounds.toNumber() - 1) {
        const draftFees = this.draftFee.mul(nextRoundJurorsNumber)
        const settleFees = this.settleFee.mul(nextRoundJurorsNumber)
        appealFees = appealFees.add(draftFees).add(settleFees)
      }

      const appealDeposit = appealFees.mul(this.appealCollateralFactor)
      const confirmAppealDeposit = appealFees.mul(this.appealConfirmCollateralFactor)
      return { appealFees , appealDeposit, confirmAppealDeposit }
    }

    async getNextRoundStartTerm(disputeId, roundId) {
      const { draftTerm } = await this.getRound(disputeId, roundId)
      return draftTerm.add(this.commitTerms).add(this.revealTerms).add(this.appealTerms).add(this.appealConfirmTerms)
    }

    async getRoundJuror(disputeId, roundId, juror) {
      const { weight, rewarded } = await this.court.getJuror(disputeId, roundId, juror)
      return { weight, rewarded }
    }

    async getRoundLockBalance(disputeId, roundId, juror) {
      if (roundId < this.maxRegularAppealRounds) {
        const lockPerDraft = this.jurorsMinActiveBalance.mul(this.penaltyPct).div(PCT_BASE)
        const { weight } = await this.getRoundJuror(disputeId, roundId, juror)
        return lockPerDraft.mul(weight)
      } else {
        const { draftTerm } = await this.getRound(disputeId, roundId)
        const draftActiveBalance = await this.jurorsRegistry.activeBalanceOfAt(juror, draftTerm)
        if (draftActiveBalance.lt(this.jurorsMinActiveBalance)) return bn(0)
        return draftActiveBalance.mul(this.penaltyPct).div(PCT_BASE)
      }
    }

    async getFinalRoundWeight(disputeId, roundId, juror) {
      const { draftTerm } = await this.getRound(disputeId, roundId)
      const draftActiveBalance = await this.jurorsRegistry.activeBalanceOfAt(juror, draftTerm)
      if (draftActiveBalance.lt(this.jurorsMinActiveBalance)) return bn(0)
      return draftActiveBalance.mul(this.finalRoundWeightPrecision).div(this.jurorsMinActiveBalance)
    }

    async setTimestamp(timestamp) {
      await this.controller.mockSetTimestamp(timestamp)
    }

    async increaseTime(seconds) {
      await this.controller.mockIncreaseTime(seconds)
    }

    async advanceBlocks(blocks) {
      await this.controller.mockAdvanceBlocks(blocks)
    }

    async setTerm(termId) {
      // set timestamp corresponding to given term ID
      const timestamp = this.firstTermStartTime.add(this.termDuration.mul(bn(termId - 1)))
      await this.setTimestamp(timestamp)

      // call heartbeat function for X needed terms
      const neededTransitions = await this.controller.getNeededTermTransitions()
      if (neededTransitions.gt(bn(0))) await this.court.heartbeat(neededTransitions)
    }

    async passTerms(terms) {
      // increase X terms based on term duration
      await this.increaseTime(this.termDuration.mul(terms))
      // call heartbeat function for X terms
      await this.court.heartbeat(terms)
      // advance 2 blocks to ensure we can compute term randomness
      await this.advanceBlocks(2)
    }

    async passRealTerms(terms) {
      // increase X terms based on term duration
      await this.increaseTime(this.termDuration.mul(bn(terms)))
      // call heartbeat function for X terms
      await this.court.heartbeat(terms)
      // advance 2 blocks to ensure we can compute term randomness
      await advanceBlocks(2)
    }

    async buildNewConfig(originalConfig, iteration = 1) {
      const {
        jurorFee, heartbeatFee, draftFee, settleFee,
        commitTerms, revealTerms, appealTerms, appealConfirmTerms,
        penaltyPct, finalRoundReduction,
        firstRoundJurorsNumber, appealStepFactor, maxRegularAppealRounds,
        appealCollateralFactor, appealConfirmCollateralFactor,
      } = originalConfig

      const newFeeToken = await artifacts.require('ERC20Mock').new('Court Fee Token', 'CFT', 18)
      const newFeeTokenAddress = newFeeToken.address
      const newJurorFee = jurorFee.add(bigExp(iteration * 10, 18))
      const newHeartbeatFee = heartbeatFee.add(bigExp(iteration * 10, 18))
      const newDraftFee = draftFee.add(bigExp(iteration * 10, 18))
      const newSettleFee = settleFee.add(bigExp(iteration * 10, 18))
      const newCommitTerms = commitTerms.add(bn(iteration))
      const newRevealTerms = revealTerms.add(bn(iteration))
      const newAppealTerms = appealTerms.add(bn(iteration))
      const newAppealConfirmTerms = appealConfirmTerms.add(bn(iteration))
      const newPenaltyPct = penaltyPct.add(bn(iteration * 100))
      const newFinalRoundReduction = finalRoundReduction.add(bn(iteration * 100))
      const newFirstRoundJurorsNumber = firstRoundJurorsNumber.add(bn(iteration))
      const newAppealStepFactor = appealStepFactor.add(bn(iteration))
      const newMaxRegularAppealRounds = maxRegularAppealRounds.add(bn(iteration))
      const newAppealCollateralFactor = appealCollateralFactor.add(bn(iteration))
      const newAppealConfirmCollateralFactor = appealConfirmCollateralFactor.add(bn(iteration))

      return {
        newFeeTokenAddress,
        newJurorFee, newHeartbeatFee, newDraftFee, newSettleFee,
        newCommitTerms, newRevealTerms, newAppealTerms, newAppealConfirmTerms,
        newPenaltyPct, newFinalRoundReduction,
        newFirstRoundJurorsNumber, newAppealStepFactor, newMaxRegularAppealRounds,
        newAppealCollateralFactor,
        newAppealConfirmCollateralFactor,
      }
    }

    async changeConfigPromise(originalConfig, termId, from, iteration = 1) {
      const newConfig = await this.buildNewConfig(originalConfig, iteration)
      const {
        newFeeTokenAddress,
        newJurorFee, newHeartbeatFee, newDraftFee, newSettleFee,
        newCommitTerms, newRevealTerms, newAppealTerms, newAppealConfirmTerms,
        newPenaltyPct, newFinalRoundReduction,
        newFirstRoundJurorsNumber, newAppealStepFactor, newMaxRegularAppealRounds,
        newAppealCollateralFactor,
        newAppealConfirmCollateralFactor,
      } = newConfig

      const promise = this.court.setCourtConfig(
        termId,
        newFeeTokenAddress,
        [ newJurorFee, newHeartbeatFee, newDraftFee, newSettleFee ],
        [ newCommitTerms, newRevealTerms, newAppealTerms, newAppealConfirmTerms ],
        [ newPenaltyPct, newFinalRoundReduction ],
        [ newFirstRoundJurorsNumber, newAppealStepFactor, newMaxRegularAppealRounds ],
        [ newAppealCollateralFactor, newAppealConfirmCollateralFactor ],
        { from }
      )

      return { promise, newConfig }
    }

    async changeConfig(originalConfig, termId, iteration = 1) {
      const { promise, newConfig } = await this.changeConfigPromise(originalConfig, termId, this.governor, iteration)
      await promise

      return newConfig
    }

    async mintAndApproveFeeTokens(from, to, amount) {
      // reset allowance in case allowed address has already been approved some balance
      const allowance = await this.feeToken.allowance(from, to)
      if (allowance.gt(bn(0))) await this.feeToken.approve(to, 0, { from })

      // mint and approve tokens
      await this.feeToken.generateTokens(from, amount)
      await this.feeToken.approve(to, amount, { from })
    }

    async activate(jurors) {
      const ACTIVATE_DATA = sha3('activate(uint256)').slice(0, 10)

      for (const { address, initialActiveBalance } of jurors) {
        await this.jurorToken.generateTokens(address, initialActiveBalance)
        await this.jurorToken.approveAndCall(this.jurorsRegistry.address, initialActiveBalance, ACTIVATE_DATA, { from: address })
      }
    }

    async dispute({ draftTermId, possibleRulings = bn(2), arbitrable = undefined, disputer = undefined }) {
      // mint enough fee tokens for the disputer, if no disputer was given pick the second account
      if (!disputer) disputer = await this._getAccount(1)
      await this.setTerm(draftTermId - 1)
      const { disputeFees } = await this.getDisputeFees(draftTermId)
      await this.mintAndApproveFeeTokens(disputer, this.court.address, disputeFees)

      // create an arbitrable if no one was given, and mock subscriptions
      if (!arbitrable) arbitrable = await this.artifacts.require('ArbitrableMock').new()
      await this.subscriptions.setUpToDate(true)

      // create dispute and return id
      const receipt = await this.court.createDispute(arbitrable.address, possibleRulings, { from: disputer })
      return getEventArgument(receipt, 'NewDispute', 'disputeId')
    }

    async draft({ disputeId, maxJurorsToBeDrafted = undefined, draftedJurors = undefined, drafter = undefined }) {
      // if no drafter was given pick the third account
      if (!drafter) drafter = await this._getAccount(2)

      // draft all jurors if there was no max given
      if (!maxJurorsToBeDrafted) {
        const { lastRoundId } = await this.getDispute(disputeId)
        const { roundJurorsNumber } = await this.getRound(disputeId, lastRoundId)
        maxJurorsToBeDrafted = roundJurorsNumber.toNumber()
      }

      // mock draft if there was a jurors set to be drafted
      if (draftedJurors) {
        const totalWeight = draftedJurors.reduce((total, { weight }) => total + weight, 0)
        if (totalWeight !== maxJurorsToBeDrafted) throw Error('Given jurors to be drafted do not fit the round jurors number')
        const jurors = draftedJurors.map(j => j.address)
        const weights = draftedJurors.map(j => j.weight)
        await this.jurorsRegistry.mockNextDraft(jurors, weights)
      }

      // draft and flat jurors with their weights
      const receipt = await this.court.draft(disputeId, maxJurorsToBeDrafted, { from: drafter })
      const logs = decodeEventsOfType(receipt, this.artifacts.require('JurorsRegistry').abi, 'JurorDrafted')
      const weights = getEvents({ logs }, 'JurorDrafted').reduce((jurors, event) => {
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
        await this.voting.commit(voteId, encryptVote(outcome), { from: address })
        if (outcome == OUTCOMES.LEAKED) {
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
        if (outcome != OUTCOMES.LEAKED) {
          await this.voting.reveal(voteId, outcome, SALT, { from: address })
        }
      }

      // move to appeal period
      await this.passTerms(this.revealTerms)
    }

    async appeal({ disputeId, roundId, appealMaker = undefined, ruling = undefined }) {
      // mint fee tokens for the appealer, if no appealer was given pick the fourth account
      if (!appealMaker) appealMaker = await this._getAccount(3)
      const { appealDeposit } = await this.getAppealFees(disputeId, roundId)
      await this.mintAndApproveFeeTokens(appealMaker, this.court.address, appealDeposit)

      // use the opposite to the round winning ruling for the appeal if no one was given
      if (!ruling) {
        const voteId = getVoteId(disputeId, roundId)
        const winningRuling = await this.voting.getWinningOutcome(voteId)
        ruling = oppositeOutcome(winningRuling)
      }

      // appeal and move to confirm appeal period
      await this.court.createAppeal(disputeId, roundId, ruling, { from: appealMaker })
      await this.passTerms(this.appealTerms)
    }

    async confirmAppeal({ disputeId, roundId, appealTaker = undefined, ruling = undefined }) {
      // mint fee tokens for the appeal taker, if no taker was given pick the fifth account
      if (!appealTaker) appealTaker = await this._getAccount(4)
      const { confirmAppealDeposit } = await this.getAppealFees(disputeId, roundId)
      await this.mintAndApproveFeeTokens(appealTaker, this.court.address, confirmAppealDeposit)

      // use the opposite ruling the one appealed if no one was given
      if (!ruling) {
        const { appealedRuling } = await this.getAppeal(disputeId, roundId)
        ruling = oppositeOutcome(appealedRuling)
      }

      // confirm appeal and move to end of confirm appeal period
      await this.court.confirmAppeal(disputeId, roundId, ruling, { from: appealTaker })
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

    async deploy(params) {
      Object.assign(this, { ...DEFAULTS, ...params })
      if (!this.governor) this.governor = await this._getAccount(0)
      if (!this.feeToken) this.feeToken = await this.artifacts.require('ERC20Mock').new('Court Fee Token', 'CFT', 18)
      if (!this.jurorToken) this.jurorToken = await this.artifacts.require('ERC20Mock').new('Aragon Network Juror Token', 'ANJ', 18)

      if (!this.controller) this.controller = await this.artifacts.require('ControllerMock').new(this.termDuration, this.firstTermStartTime, { from: this.governor })
      if (!this.voting) this.voting = await this.artifacts.require('CRVoting').new(this.controller.address)
      if (!this.accounting) this.accounting = await this.artifacts.require('CourtAccounting').new(this.controller.address)

      if (!this.court) this.court = await this.artifacts.require('CourtMock').new(
        this.controller.address,
        this.feeToken.address,
        [this.jurorFee, this.heartbeatFee, this.draftFee, this.settleFee],
        [this.commitTerms, this.revealTerms, this.appealTerms, this.appealConfirmTerms],
        [this.penaltyPct, this.finalRoundReduction],
        [this.firstRoundJurorsNumber, this.appealStepFactor, this.maxRegularAppealRounds],
        [this.appealCollateralFactor, this.appealConfirmCollateralFactor],
      )

      if (!this.jurorsRegistry) this.jurorsRegistry = await this.artifacts.require('JurorsRegistryMock').new(
        this.controller.address,
        this.jurorToken.address,
        this.jurorsMinActiveBalance,
        this.jurorsMinActiveBalance.mul(MAX_UINT64.div(this.finalRoundWeightPrecision)),
      )

      if (!this.subscriptions) this.subscriptions = await this.artifacts.require('SubscriptionsMock').new(
        this.controller.address,
        this.subscriptionPeriodDuration,
        this.feeToken.address,
        this.subscriptionFeeAmount,
        this.subscriptionPrePaymentPeriods,
        this.subscriptionLatePaymentPenaltyPct,
        this.subscriptionGovernorSharePct,
      )

      const ids = Object.values(MODULE_IDS)
      const implementations = [this.court, this.accounting, this.voting, this.jurorsRegistry, this.subscriptions].map(i => i.address)
      await this.controller.setModules(ids, implementations, { from: this.governor })

      const zeroTermStartTime = this.firstTermStartTime.sub(this.termDuration)
      await this.setTimestamp(zeroTermStartTime)

      return this.court
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
    buildHelper: () => new CourtHelper(web3, artifacts),
  }
}
