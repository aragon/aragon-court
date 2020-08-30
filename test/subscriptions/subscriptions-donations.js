const { assertBn } = require('../helpers/asserts/assertBn')
const { bn, bigExp } = require('../helpers/lib/numbers')
const { buildHelper } = require('../helpers/wrappers/court')(web3, artifacts)

const CourtSubscriptions = artifacts.require('CourtSubscriptions')
const ERC20 = artifacts.require('ERC20Mock')

// TODO: Delete these tests?
contract('CourtSubscriptions', ([_, payer]) => {
  let controller, subscriptions, feeToken

  const FEE_AMOUNT = bigExp(10, 18)
  const PERIOD_DURATION = 24 * 30           // 30 days, assuming terms are 1h

  before('create base contracts', async () => {
    controller = await buildHelper().deploy()
    feeToken = await ERC20.new('Subscriptions Fee Token', 'SFT', 18)
  })

  beforeEach('create subscriptions module', async () => {
    subscriptions = await CourtSubscriptions.new(controller.address, PERIOD_DURATION, feeToken.address)
    await controller.setSubscriptions(subscriptions.address)
  })

  describe('donate', () => {
    context('when the amount is greater than zero', () => {
      const amount = bn(10)
      const from = payer

      beforeEach('mint fee tokens', async () => {
        const balance = FEE_AMOUNT.mul(bn(10000))
        await feeToken.generateTokens(from, balance)
      })

      it('pays the requested periods subscriptions', async () => {
        const previousPayerBalance = await feeToken.balanceOf(from)
        const previousSubscriptionsBalance = await feeToken.balanceOf(subscriptions.address)

        await feeToken.transfer(subscriptions.address, amount, { from })

        const currentSubscriptionsBalance = await feeToken.balanceOf(subscriptions.address)
        assertBn(currentSubscriptionsBalance, previousSubscriptionsBalance.add(amount), 'subscriptions balances do not match')

        const currentPayerBalance = await feeToken.balanceOf(from)
        assertBn(currentPayerBalance, previousPayerBalance.sub(amount), 'payer balances do not match')
      })
    })
  })
})
