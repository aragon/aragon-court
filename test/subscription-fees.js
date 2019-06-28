const { assertRevert } = require('@aragon/os/test/helpers/assertThrow')

const Subscription = artifacts.require('Subscription')
const SubscriptionOwner = artifacts.require('SubscriptionOwnerMock')
const SumTree = artifacts.require('HexSumTreeWrapper')
const MiniMeToken = artifacts.require('@aragon/apps-shared-minime/contracts/MiniMeToken')

const deployedContract = async (receiptPromise, name) =>
      artifacts.require(name).at(getLog(await receiptPromise, 'Deployed', 'addr'))

const assertEqualBN = async (actualPromise, expected, message) =>
      assert.equal((await actualPromise).toNumber(), expected, message)

const getLog = (receipt, logName, argName) => {
  const log = receipt.logs.find(({ event }) => event == logName)
  return log ? log.args[argName] : null
}

const ZERO_ADDRESS = '0x' + '00'.repeat(20)

const ERROR_NOT_OWNER = 'SUB_NOT_OWNER'
const ERROR_NOT_ALLOWED_BY_OWNER = 'SUB_NOT_ALLOWED_BY_OWNER'
const ERROR_ZERO_FEE = 'SUB_ZERO_FEE'

contract('Subscription', ([ org1, org2, juror1, juror2, juror3 ]) => {
  let token
  const START_TERM_ID = 1
  const PERIOD_DURATION = 24 * 30 // 30 days, assuming terms are 1h
  const FEE_AMOUNT = web3.toWei(10)
  const INITIAL_BALANCE = web3.toWei(1e6)
  const GOVERNOR_SHARE_PCT = 100 // 100‱ = 1%
  const LATE_PAYMENT_PENALTY_PCT = 1000 // 1000‱ = 10%
  const orgs = [ org1, org2 ]
  const jurors = [ juror1, juror2, juror3 ]

  const pct4 = (n, p) => n * p / 1e4

  beforeEach(async () => {
    this.sumTree = await SumTree.new()

    this.subscription = await Subscription.new()
    // Mints 1,000,000 tokens for orgs
    token = await MiniMeToken.new(ZERO_ADDRESS, ZERO_ADDRESS, 0, 'n', 0, 'n', true) // empty parameters minime
    for (let org of orgs) {
      await token.generateTokens(org, INITIAL_BALANCE)
      await token.approve(this.subscription.address, INITIAL_BALANCE, { from: org })
      await assertEqualBN(token.balanceOf(org), INITIAL_BALANCE, `org ${org} balance`)
    }
  })

  it('can init and set owner', async () => {
    assert.equal(await this.subscription.getOwner.call(), ZERO_ADDRESS, 'wrong owner before init')
    await this.subscription.init(org1, this.sumTree.address, START_TERM_ID, PERIOD_DURATION, token.address, FEE_AMOUNT, LATE_PAYMENT_PENALTY_PCT, GOVERNOR_SHARE_PCT)
    assert.equal(await this.subscription.getOwner.call(), org1, 'wrong owner after init')
  })

  it('fails to set Fee Amount if not owner', async () => {
    await assertRevert(this.subscription.setFeeAmount(1, { from: org1 }), ERROR_NOT_OWNER)
  })

  it('fails to set Fee Token if not owner', async () => {
    await assertRevert(this.subscription.setFeeToken(token.address, { from: org1 }), ERROR_NOT_OWNER)
  })

  it('fails to set late payment penalty if not owner', async () => {
    await assertRevert(this.subscription.setLatePaymentPenaltyPct(2, { from: org1 }), ERROR_NOT_OWNER)
  })

  it('fails to set governor share if not owner', async () => {
    await assertRevert(this.subscription.setGovernorSharePct(2, { from: org1 }), ERROR_NOT_OWNER)
  })

  context('With Owner interface', () => {
    const vote = 1
    let subscriptionOwner

    beforeEach(async () => {
      subscriptionOwner = await SubscriptionOwner.new(this.subscription.address)
      await this.subscription.init(subscriptionOwner.address, this.sumTree.address, START_TERM_ID, PERIOD_DURATION, token.address, FEE_AMOUNT, LATE_PAYMENT_PENALTY_PCT, GOVERNOR_SHARE_PCT)
      await this.subscription.getOwner.call()
    })

    it('can set Fee amount as owner', async () => {
      const feeAmount = 2
      await subscriptionOwner.setFeeAmount(2)
      assertEqualBN(await this.subscription.feeAmount(), feeAmount)
    })

    it('fails to set Fee Amount if zero', async () => {
      await assertRevert(this.subscriptionOwner.setFeeAmount(0), ERROR_ZERO_FEE)
    })

    it('can set Fee Token as owner', async () => {
      const tokenAddress = '0x' + '00'.repeat(18) + '1234'
      await subscriptionOwner.setFeeToken(tokenAddress)
      assert.equal(await this.subscription.feeToken(), tokenAddress)
    })

    it('can set late payment penalty as owner', async () => {
      const latePaymentPenaltyPct = 2
      await subscriptionOwner.setLatePaymentPenaltyPct(latePaymentPenaltyPct)
      assertEqualBN(await this.subscription.latePaymentPenaltyPct(), latePaymentPenaltyPct)
    })

    it('can set governor share as owner', async () => {
      const governorSharePct = 2
      await subscriptionOwner.setGovernorSharePct(governorSharePct)
      assertEqualBN(await this.subscription.governorSharePct(), governorSharePct)
    })

    context('Juror actions', () => {
      beforeEach(async () => {
      })

      it('Org pays fees', async () => {
        const initialBalance = await token.balanceOf(org1)
        const r = await this.subscription.payFees(org1, { from: org1 })
        const finalBalance = await token.balanceOf(org1)
        assertEqualBN(initialBalance.sub(FEE_AMOUNT), finalBalance, 'Token balance mismatch');
      })
    })
  })
})
