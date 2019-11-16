const { assertBn } = require('../helpers/asserts/assertBn')
const { bn, bigExp } = require('../helpers/lib/numbers')
const { buildHelper } = require('../helpers/wrappers/court')(web3, artifacts)
const { assertRevert } = require('../helpers/asserts/assertThrow')
const { assertAmountOfEvents } = require('../helpers/asserts/assertEvent')
const { SUBSCRIPTIONS_ERRORS } = require('../helpers/utils/errors')
const { SUBSCRIPTIONS_EVENTS } = require('../helpers/utils/events')

const CourtSubscriptions = artifacts.require('CourtSubscriptions')
const ERC20 = artifacts.require('ERC20Mock')

contract('CourtSubscriptions', ([_, payer]) => {
  let controller, subscriptions, feeToken

  const FEE_AMOUNT = bigExp(10, 18)
  const PREPAYMENT_PERIODS = 5
  const RESUME_PRE_PAID_PERIODS = 1
  const PERIOD_DURATION = 24 * 30           // 30 days, assuming terms are 1h
  const GOVERNOR_SHARE_PCT = bn(100)        // 100‱ = 1%
  const LATE_PAYMENT_PENALTY_PCT = bn(1000) // 1000‱ = 10%

  before('create base contracts', async () => {
    controller = await buildHelper().deploy()
    feeToken = await ERC20.new('Subscriptions Fee Token', 'SFT', 18)
  })

  beforeEach('create subscriptions module', async () => {
    subscriptions = await CourtSubscriptions.new(controller.address, PERIOD_DURATION, feeToken.address, FEE_AMOUNT, PREPAYMENT_PERIODS, RESUME_PRE_PAID_PERIODS, LATE_PAYMENT_PENALTY_PCT, GOVERNOR_SHARE_PCT)
    await controller.setSubscriptions(subscriptions.address)
  })

  describe('donate', () => {
    context('when the amount is greater than zero', () => {
      const amount = bn(10)

      context('when the court has not started yet', () => {
        it('reverts', async () => {
          await assertRevert(subscriptions.donate(amount, { from: payer }), SUBSCRIPTIONS_ERRORS.COURT_HAS_NOT_STARTED)
        })
      })

      context('when the court has already started', () => {
        beforeEach('move terms to reach period #0', async () => {
          await controller.mockSetTerm(PERIOD_DURATION)
        })

        context('when the sender has enough balance', () => {
          const from = payer

          beforeEach('mint fee tokens', async () => {
            const balance = FEE_AMOUNT.mul(bn(10000))
            await feeToken.generateTokens(from, balance)
            await feeToken.approve(subscriptions.address, balance, { from })
          })

          it('pays the requested periods subscriptions', async () => {
            const previousPayerBalance = await feeToken.balanceOf(from)
            const previousSubscriptionsBalance = await feeToken.balanceOf(subscriptions.address)

            const { collectedFees } = await subscriptions.getCurrentPeriod()

            const receipt = await subscriptions.donate(amount, { from })
            assertAmountOfEvents(receipt, SUBSCRIPTIONS_EVENTS.FEES_DONATED)

            const currentSubscriptionsBalance = await feeToken.balanceOf(subscriptions.address)
            assertBn(currentSubscriptionsBalance, previousSubscriptionsBalance.add(amount), 'subscriptions balances do not match')

            const currentPayerBalance = await feeToken.balanceOf(from)
            assertBn(currentPayerBalance, previousPayerBalance.sub(amount), 'payer balances do not match')

            const { collectedFees: newCollectedFees } = await subscriptions.getCurrentPeriod()
            assertBn(newCollectedFees, collectedFees.add(amount), 'period collected fees do not match')
          })
        })

        context('when the sender does not have enough balance', () => {
          it('reverts', async () => {
            await assertRevert(subscriptions.donate(1), SUBSCRIPTIONS_ERRORS.TOKEN_TRANSFER_FAILED)
          })
        })
      })
    })

    context('when the amount is zero', () => {
      const amount = bn(0)

      it('reverts', async () => {
        await assertRevert(subscriptions.donate(amount), SUBSCRIPTIONS_ERRORS.DONATION_AMOUNT_ZERO)
      })
    })
  })
})
