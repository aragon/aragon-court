const { NEXT_WEEK, ONE_DAY } = require('../lib/time')
const { MAX_UINT64, bn, bigExp } = require('../lib/numbers')

const MODULE_IDS = {
  court: '0x26f3b895987e349a46d6d91132234924c6d45cfdc564b33427f53e3f9284955c',
  treasury: '0x06aa03964db1f7257357ef09714a5f0ca3633723df419e97015e0c7a3e83edb7',
  voting: '0x7cbb12e82a6d63ff16fe43977f43e3e2b247ecd4e62c0e340da8800a48c67346',
  registry: '0x3b21d36b36308c830e6c4053fb40a3b6d79dde78947fbf6b0accd30720ab5370',
  subscriptions: '0x2bfa3327fe52344390da94c32a346eeb1b65a8b583e4335a419b9471e88c1365'
}

module.exports = (web3, artifacts) => {
  const { advanceBlocks } = require('../lib/blocks')(web3)

  const DEFAULTS = {
    termDuration:                       bn(ONE_DAY),     //  terms lasts one day
    firstTermStartTime:                 bn(NEXT_WEEK),   //  first term starts one week after mocked timestamp
    maxJurorsPerDraftBatch:             bn(10),          //  max number of jurors drafted per batch
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
    appealCollateralFactor:             bn(25000),       //  permyriad multiple of juror fees required to appeal a preliminary ruling (1/10,000)
    appealConfirmCollateralFactor:      bn(35000),       //  permyriad multiple of juror fees required to confirm appeal (1/10,000)
    minActiveBalance:                   bigExp(100, 18), //  100 ANJ is the minimum balance jurors must activate to participate in the Court
    finalRoundWeightPrecision:          bn(1000),        //  use to improve division rounding for final round maths
    subscriptionPeriodDuration:         bn(10),          //  each subscription period lasts 10 terms
    subscriptionFeeAmount:              bigExp(100, 18), //  100 fee tokens per subscription period
    subscriptionPrePaymentPeriods:      bn(15),          //  15 subscription pre payment period
    subscriptionResumePrePaidPeriods:   bn(10),          //  10 pre-paid periods when resuming activity
    subscriptionLatePaymentPenaltyPct:  bn(0),           //  none subscription late payment penalties
    subscriptionGovernorSharePct:       bn(0)            //  none subscription governor shares
  }

  class ControllerHelper {
    constructor(web3, artifacts) {
      this.web3 = web3
      this.artifacts = artifacts
    }

    async getConfig(termId) {
      const { feeToken, fees, roundStateDurations, pcts, roundParams, appealCollateralParams, minActiveBalance } = await this.controller.getConfig(termId)
      return {
        feeToken: await this.artifacts.require('ERC20Mock').at(feeToken),
        jurorFee: fees[0],
        draftFee: fees[1],
        settleFee: fees[2],
        commitTerms: roundStateDurations[0],
        revealTerms: roundStateDurations[1],
        appealTerms: roundStateDurations[2],
        appealConfirmTerms: roundStateDurations[3],
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

    async setTimestamp(timestamp) {
      await this.controller.mockSetTimestamp(timestamp)
    }

    async increaseTimeInTerms(terms) {
      const seconds = this.termDuration.mul(bn(terms))
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
      if (neededTransitions.gt(bn(0))) await this.controller.heartbeat(neededTransitions)
    }

    async passTerms(terms) {
      // increase X terms based on term duration
      await this.increaseTimeInTerms(terms)
      // call heartbeat function for X terms
      await this.controller.heartbeat(terms)
      // advance 2 blocks to ensure we can compute term randomness
      await this.advanceBlocks(2)
    }

    async passRealTerms(terms) {
      // increase X terms based on term duration
      await this.increaseTimeInTerms(terms)
      // call heartbeat function for X terms
      await this.controller.heartbeat(terms)
      // advance 2 blocks to ensure we can compute term randomness
      await advanceBlocks(2)
    }

    async setConfig(termId, newConfig, txParams = { }) {
      if (!txParams.from) txParams.from = this.configGovernor

      const {
        feeToken,
        jurorFee, draftFee, settleFee,
        commitTerms, revealTerms, appealTerms, appealConfirmTerms,
        penaltyPct, finalRoundReduction,
        firstRoundJurorsNumber, appealStepFactor, maxRegularAppealRounds, finalRoundLockTerms,
        appealCollateralFactor, appealConfirmCollateralFactor,
        minActiveBalance
      } = newConfig

      return this.controller.setConfig(
        termId,
        feeToken.address,
        [jurorFee, draftFee, settleFee],
        [commitTerms, revealTerms, appealTerms, appealConfirmTerms],
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

      if (!this.controller) {
        this.controller = await this.artifacts.require('ControllerMock').new(
          [this.termDuration, this.firstTermStartTime],
          [this.fundsGovernor, this.configGovernor, this.modulesGovernor],
          this.feeToken.address,
          [this.jurorFee, this.draftFee, this.settleFee],
          [this.commitTerms, this.revealTerms, this.appealTerms, this.appealConfirmTerms],
          [this.penaltyPct, this.finalRoundReduction],
          [this.firstRoundJurorsNumber, this.appealStepFactor, this.maxRegularAppealRounds, this.finalRoundLockTerms],
          [this.appealCollateralFactor, this.appealConfirmCollateralFactor],
          this.minActiveBalance
        )
      }

      return this.controller
    }

    async deployModules() {
      if (!this.jurorToken) this.jurorToken = await this.artifacts.require('ERC20Mock').new('Aragon Network Juror Token', 'ANJ', 18)
      if (!this.court) this.court = await this.artifacts.require('Court').new(this.controller.address, this.maxJurorsPerDraftBatch)
      if (!this.voting) this.voting = await this.artifacts.require('CRVoting').new(this.controller.address)
      if (!this.treasury) this.treasury = await this.artifacts.require('CourtTreasury').new(this.controller.address)

      if (!this.jurorsRegistry) {
        this.jurorsRegistry = await this.artifacts.require('JurorsRegistryMock').new(
          this.controller.address,
          this.jurorToken.address,
          this.minActiveBalance.mul(MAX_UINT64.div(this.finalRoundWeightPrecision))
        )
      }

      if (!this.subscriptions) {
        this.subscriptions = await this.artifacts.require('SubscriptionsMock').new(
          this.controller.address,
          this.subscriptionPeriodDuration,
          this.feeToken.address,
          this.subscriptionFeeAmount,
          this.subscriptionPrePaymentPeriods,
          this.subscriptionLatePaymentPenaltyPct,
          this.subscriptionGovernorSharePct
        )
      }

      const ids = Object.values(MODULE_IDS)
      const implementations = [this.court, this.treasury, this.voting, this.jurorsRegistry, this.subscriptions].map(i => i.address)
      await this.controller.setModules(ids, implementations, { from: this.modulesGovernor })

      const zeroTermStartTime = this.firstTermStartTime.sub(this.termDuration)
      await this.setTimestamp(zeroTermStartTime)

      return this.controller
    }

    async _getAccount(index) {
      const accounts = await this.web3.eth.getAccounts()
      return accounts[index]
    }
  }

  return {
    DEFAULTS,
    buildHelper: () => new ControllerHelper(web3, artifacts)
  }
}
