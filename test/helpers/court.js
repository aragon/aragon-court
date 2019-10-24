const { bn } = require('./numbers')
const { sha3 } = require('web3-utils')
const { decodeEventsOfType } = require('./decodeEvent')
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

module.exports = (web3, artifacts) => {
  const { DEFAULTS, buildHelper } = require('./controller')(web3, artifacts)

  class CourtHelper {
    constructor(web3, artifacts) {
      this.web3 = web3
      this.artifacts = artifacts
      this.controllerHelper = buildHelper()
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
      let appealFees = jurorFees

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
      await this.controllerHelper.deploy(params)
      await this.controllerHelper.deployModules()
      const { controller, court, jurorsRegistry, voting, subscriptions, accounting, feeToken, jurorToken, governor } = this.controllerHelper
      Object.assign(this, { controller, court, jurorsRegistry, voting, subscriptions, accounting, feeToken, jurorToken, governor })
      return this.court
    }

    async setTimestamp(timestamp) {
      await this.controllerHelper.setTimestamp(timestamp)
    }

    async increaseTimeInTerms(terms) {
      await this.controllerHelper.increaseTimeInTerms(terms)
    }

    async advanceBlocks(blocks) {
      await this.controllerHelper.advanceBlocks(blocks)
    }

    async setTerm(termId) {
      await this.controllerHelper.setTerm(termId)
    }

    async passTerms(terms) {
      await this.controllerHelper.passTerms(terms)
    }

    async passRealTerms(terms) {
      await this.controllerHelper.passRealTerms(terms)
    }

    async _getAccount(index) {
      const accounts = await this.web3.eth.getAccounts()
      return accounts[index]
    }
  }

  return {
    DISPUTE_STATES,
    ROUND_STATES,
    buildHelper: () => new CourtHelper(web3, artifacts),
  }
}
