const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

module.exports = (web3, artifacts) => {
  const { bn } = require('./numbers')(web3)
  const { NEXT_WEEK, ONE_WEEK } = require('./time')

  // TODO: update default to make sure we test using real values
  const DEFAULTS = {
    termDuration:                       bn(ONE_WEEK),   //  terms lasts one week
    firstTermStartTime:                 bn(NEXT_WEEK),  //  first term starts one week after mocked timestamp
    commitTerms:                        bn(1),          //  vote commits last 1 term
    revealTerms:                        bn(1),          //  vote reveals last 1 term
    appealTerms:                        bn(1),          //  appeals last 1 term
    appealConfirmTerms:                 bn(1),          //  appeal confirmations last 1 term
    jurorFee:                           bn(10),         //  10 fee tokens for juror fees
    heartbeatFee:                       bn(20),         //  20 fee tokens for heartbeat fees
    draftFee:                           bn(30),         //  30 fee tokens for draft fees
    settleFee:                          bn(40),         //  40 fee tokens for settle fees
    penaltyPct:                         bn(100),        //  1% (1/10,000)
    finalRoundReduction:                bn(3300),       //  33% (1/10,000)
    appealStepFactor:                   bn(3),          //  each time a new appeal occurs, the amount of jurors to be drafted will be incremented 3 times
    maxRegularAppealRounds:             bn(4),          //  there can be up to 4 appeals in total per dispute
    jurorsMinActiveBalance:             bn(100),        //  100 ANJ is the minimum balance jurors must activate to participate in the Court
    subscriptionPeriodDuration:         bn(0),          //  none subscription period
    subscriptionFeeAmount:              bn(0),          //  none subscription fee
    subscriptionPrePaymentPeriods:      bn(0),          //  none subscription pre payment period
    subscriptionLatePaymentPenaltyPct:  bn(0),          //  none subscription late payment penalties
    subscriptionGovernorSharePct:       bn(0),          //  none subscription governor shares
  }

  class CourtHelper {
    constructor(web3, artifacts) {
      this.web3 = web3
      this.artifacts = artifacts
    }

    async setTimestamp(timestamp) {
      await this.jurorsRegistry.mockSetTimestamp(timestamp)
      await this.court.mockSetTimestamp(timestamp)
    }

    async increaseTime(seconds) {
      await this.jurorsRegistry.mockIncreaseTime(seconds)
      await this.court.mockIncreaseTime(seconds)
    }

    async advanceBlocks(blocks) {
      await this.jurorsRegistry.mockAdvanceBlocks(blocks)
      await this.court.mockAdvanceBlocks(blocks)
    }

    async deploy(params) {
      Object.assign(this, { ...DEFAULTS, ...params })
      if (!this.governor) this.governor = this.web3.eth.accounts[0]
      if (!this.voting) this.voting = await this.artifacts.require('CRVoting').new()
      if (!this.accounting) this.accounting = await this.artifacts.require('CourtAccounting').new()
      if (!this.feeToken) this.feeToken = await this.artifacts.require('MiniMeToken').new(ZERO_ADDRESS, ZERO_ADDRESS, 0, 'Court Fee Token', 18, 'CFT', true)
      if (!this.jurorToken) this.jurorToken = await this.artifacts.require('MiniMeToken').new(ZERO_ADDRESS, ZERO_ADDRESS, 0, 'Aragon Network Juror Token', 18, 'ANJ', true)
      if (!this.jurorsRegistry) this.jurorsRegistry =  await this.artifacts.require('JurorsRegistryMock').new()
      if (!this.subscriptions) this.subscriptions = await this.artifacts.require('SubscriptionsMock').new()

      this.court = await artifacts.require('CourtMock').new(
        this.termDuration,
        [ this.jurorToken.address, this.feeToken.address ],
        this.jurorsRegistry.address,
        this.accounting.address,
        this.voting.address,
        this.subscriptions.address,
        [ this.jurorFee, this.heartbeatFee, this.draftFee, this.settleFee ],
        this.governor,
        this.firstTermStartTime,
        this.jurorsMinActiveBalance,
        [ this.commitTerms, this.revealTerms, this.appealTerms, this.appealConfirmTerms ],
        [ this.penaltyPct, this.finalRoundReduction ],
        this.appealStepFactor,
        this.maxRegularAppealRounds,
        [ this.subscriptionPeriodDuration, this.subscriptionFeeAmount, this.subscriptionPrePaymentPeriods, this.subscriptionLatePaymentPenaltyPct, this.subscriptionGovernorSharePct ]
      )

      const zeroTermStartTime = this.firstTermStartTime - this.termDuration
      await this.setTimestamp(zeroTermStartTime)

      return this.court
    }
  }

  return {
    DEFAULTS,
    buildHelper: () => new CourtHelper(web3, artifacts),
  }
}
