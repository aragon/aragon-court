const { assertBn } = require('../helpers/asserts/assertBn')
const { bn, bigExp } = require('../helpers/lib/numbers')
const { buildHelper } = require('../helpers/wrappers/court')(web3, artifacts)
const { assertRevert } = require('../helpers/asserts/assertThrow')
const { assertAmountOfEvents } = require('../helpers/asserts/assertEvent')
const { SUBSCRIPTIONS_ERRORS } = require('../helpers/utils/errors')
const { SUBSCRIPTIONS_EVENTS } = require('../helpers/utils/events')
const { getGasConsumed, getWeiBalance } = require('../helpers/lib/web3-utils')(web3)

const CourtSubscriptions = artifacts.require('CourtSubscriptions')
const ERC20 = artifacts.require('ERC20Mock')

contract('CourtSubscriptions', ([_, payer]) => {
  let controller, subscriptions

  const FEE_AMOUNT = bigExp(10, 18)
  const PERIOD_DURATION = 24 * 30           // 30 days, assuming terms are 1h
  const GOVERNOR_SHARE_PCT = bn(100)        // 100‱ = 1%
  const ETH_TOKEN = '0x0000000000000000000000000000000000000000'

  describe('donate', () => {
    context('when using ETH for the fee token', () => {
      const feeToken = ETH_TOKEN

      before('create controller', async () => {
        controller = await buildHelper().deploy()
      })

      beforeEach('create subscriptions module', async () => {
        subscriptions = await CourtSubscriptions.new(controller.address, PERIOD_DURATION, feeToken, FEE_AMOUNT, GOVERNOR_SHARE_PCT)
        await controller.setSubscriptions(subscriptions.address)
      })

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

            beforeEach('assert ETH balance', async () => {
              const balance = FEE_AMOUNT
              const weiBalance = await getWeiBalance(from)
              assert.isTrue(balance.lt(weiBalance), 'sender address does not have enough ETH')
            })

            it('pays the requested periods subscriptions', async () => {
              const previousPayerBalance = await getWeiBalance(from)
              const previousSubscriptionsBalance = await getWeiBalance(subscriptions.address)

              const currentPeriodId = await subscriptions.getCurrentPeriodId()
              const { collectedFees } = await subscriptions.getPeriod(currentPeriodId)

              const receipt = await subscriptions.donate(amount, { from, value: amount })
              assertAmountOfEvents(receipt, SUBSCRIPTIONS_EVENTS.FEES_DONATED)

              const currentSubscriptionsBalance = await getWeiBalance(subscriptions.address)
              assertBn(currentSubscriptionsBalance, previousSubscriptionsBalance.add(amount), 'subscriptions balances do not match')

              const gasCost = await getGasConsumed(receipt)
              const currentPayerBalance = await getWeiBalance(from)
              assertBn(currentPayerBalance, previousPayerBalance.sub(amount).sub(gasCost), 'payer balances do not match')

              const { collectedFees: newCollectedFees } = await subscriptions.getPeriod(currentPeriodId)
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

    context('when using an ERC20 for the fee token', () => {
      let feeToken

      before('create controller and fee token', async () => {
        controller = await buildHelper().deploy()
        feeToken = await ERC20.new('Subscriptions Fee Token', 'SFT', 18)
      })

      beforeEach('create subscriptions module', async () => {
        subscriptions = await CourtSubscriptions.new(controller.address, PERIOD_DURATION, feeToken.address, FEE_AMOUNT, GOVERNOR_SHARE_PCT)
        await controller.setSubscriptions(subscriptions.address)
      })

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

              const currentPeriodId = await subscriptions.getCurrentPeriodId()
              const { collectedFees } = await subscriptions.getPeriod(currentPeriodId)

              const receipt = await subscriptions.donate(amount, { from })
              assertAmountOfEvents(receipt, SUBSCRIPTIONS_EVENTS.FEES_DONATED)

              const currentSubscriptionsBalance = await feeToken.balanceOf(subscriptions.address)
              assertBn(currentSubscriptionsBalance, previousSubscriptionsBalance.add(amount), 'subscriptions balances do not match')

              const currentPayerBalance = await feeToken.balanceOf(from)
              assertBn(currentPayerBalance, previousPayerBalance.sub(amount), 'payer balances do not match')

              const { collectedFees: newCollectedFees } = await subscriptions.getPeriod(currentPeriodId)
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
})
