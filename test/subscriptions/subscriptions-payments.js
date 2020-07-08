const { assertBn } = require('../helpers/asserts/assertBn')
const { bn, bigExp } = require('../helpers/lib/numbers')
const { buildHelper } = require('../helpers/wrappers/court')(web3, artifacts)
const { assertRevert } = require('../helpers/asserts/assertThrow')
const { SUBSCRIPTIONS_ERRORS } = require('../helpers/utils/errors')
const { SUBSCRIPTIONS_EVENTS } = require('../helpers/utils/events')
const { getWeiBalance, getGasConsumed } = require('../helpers/lib/web3-utils')(web3)
const { assertAmountOfEvents, assertEvent } = require('../helpers/asserts/assertEvent')

const CourtSubscriptions = artifacts.require('CourtSubscriptions')
const ERC20 = artifacts.require('ERC20Mock')

contract('CourtSubscriptions', ([_, governor, payer, subscriber, anotherSubscriber]) => {
  let controller, subscriptions

  const PCT_BASE = bn(10000)
  const FEE_AMOUNT = bigExp(1, 18)
  const PERIOD_DURATION = 24 * 30           // 30 days, assuming terms are 1h
  const GOVERNOR_SHARE_PCT = bn(100)        // 100‱ = 1%
  const ETH_TOKEN = '0x0000000000000000000000000000000000000000'

  const getAccumulatedGovernorFees = async () => {
    const currentPeriodId = await subscriptions.getCurrentPeriodId()
    const period = await subscriptions.getPeriod(currentPeriodId)
    return period['accumulatedGovernorFees']
  }

  describe('payFees', () => {
    const data = '0x12345678abcdef'

    context('when the fee token is ETH', () => {
      const feeToken = ETH_TOKEN

      before('create controller', async () => {
        controller = await buildHelper().deploy({ configGovernor: governor })
      })

      beforeEach('create subscriptions module', async () => {
        subscriptions = await CourtSubscriptions.new(controller.address, PERIOD_DURATION, feeToken, FEE_AMOUNT, GOVERNOR_SHARE_PCT)
        await controller.setSubscriptions(subscriptions.address)
      })

      context('when the court has not started yet', () => {
        it('reverts', async () => {
          await assertRevert(subscriptions.payFees(subscriber, data), SUBSCRIPTIONS_ERRORS.COURT_HAS_NOT_STARTED)
        })
      })

      context('when the court has already started', () => {
        beforeEach('move terms to reach period #0', async () => {
          await controller.mockSetTerm(PERIOD_DURATION)
        })

        context('when the sender has enough balance', () => {
          const from = payer
          const value = FEE_AMOUNT

          const itHandleSubscriptionsSuccessfully = () => {
            it('estimates the owed fees to pay', async () => {
              const currentPeriodId = await subscriptions.getCurrentPeriodId()
              const { amountToPay, newLastPeriodId } = await subscriptions.getOwedFeesDetails(subscriber)

              assertBn(amountToPay, FEE_AMOUNT, 'amount to be paid does not match')
              assertBn(newLastPeriodId, currentPeriodId, 'new last period ID does not match')
            })

            it('pays the subscription', async () => {
              const previousPayerBalance = await getWeiBalance(from)
              const previousSubscriptionsBalance = await getWeiBalance(subscriptions.address)

              const receipt = await subscriptions.payFees(subscriber, data, { from, value })

              const currentSubscriptionsBalance = await getWeiBalance(subscriptions.address)
              assertBn(currentSubscriptionsBalance, previousSubscriptionsBalance.add(FEE_AMOUNT), 'subscriptions balances do not match')

              const gasCost = await getGasConsumed(receipt)
              const currentPayerBalance = await getWeiBalance(from)
              assertBn(currentPayerBalance, previousPayerBalance.sub(FEE_AMOUNT).sub(gasCost), 'payer balances do not match')
            })

            it('pays the governor fees', async () => {
              const previousGovernorFees = await getAccumulatedGovernorFees()
              const expectedGovernorFees = GOVERNOR_SHARE_PCT.mul(FEE_AMOUNT).div(PCT_BASE)

              await subscriptions.payFees(subscriber, data, { from, value })

              const currentGovernorFees = await getAccumulatedGovernorFees()
              assertBn(currentGovernorFees, previousGovernorFees.add(expectedGovernorFees), 'governor fees do not match')
            })

            it('emits an event', async () => {
              const receipt = await subscriptions.payFees(subscriber, data, { from, value })

              assertAmountOfEvents(receipt, SUBSCRIPTIONS_EVENTS.FEES_PAID)
              assertEvent(receipt, SUBSCRIPTIONS_EVENTS.FEES_PAID, { subscriber, feeToken: feeToken, feeAmount: FEE_AMOUNT, data })
            })
          }

          context('when the subscriber was not subscribed yet', () => {
            itHandleSubscriptionsSuccessfully()
          })

          context('when the subscriber was already subscribed', () => {
            beforeEach('subscribe', async () => {
              await subscriptions.payFees(subscriber, data, { from, value: FEE_AMOUNT })
            })

            itHandleSubscriptionsSuccessfully()
          })
        })

        context('when the sender does not have enough balance', () => {
          const value = FEE_AMOUNT.sub(bn(1))

          it('reverts', async () => {
            await assertRevert(subscriptions.payFees(subscriber, data, { value }), SUBSCRIPTIONS_ERRORS.ETH_DEPOSIT_FAILED)
          })
        })
      })
    })

    context('when the fee token is an ERC20', () => {
      let feeToken

      before('create controller', async () => {
        controller = await buildHelper().deploy({ configGovernor: governor })
      })

      before('deploy fee token', async () => {
        feeToken = await ERC20.new('Subscriptions Fee Token', 'SFT', 18)
      })

      beforeEach('create subscriptions module', async () => {
        subscriptions = await CourtSubscriptions.new(controller.address, PERIOD_DURATION, feeToken.address, FEE_AMOUNT, GOVERNOR_SHARE_PCT)
        await controller.setSubscriptions(subscriptions.address)
      })

      context('when the court has not started yet', () => {
        it('reverts', async () => {
          await assertRevert(subscriptions.payFees(subscriber, data), SUBSCRIPTIONS_ERRORS.COURT_HAS_NOT_STARTED)
        })
      })

      context('when the court has already started', () => {
        beforeEach('move terms to reach period #0', async () => {
          await controller.mockSetTerm(PERIOD_DURATION)
        })

        context('when the sender has enough balance', () => {
          const from = payer

          beforeEach('mint fee tokens', async () => {
            await feeToken.generateTokens(from, FEE_AMOUNT)
            await feeToken.approve(subscriptions.address, FEE_AMOUNT, { from })
          })

          const itHandleSubscriptionsSuccessfully = () => {
            it('estimates the owed fees to pay', async () => {
              const currentPeriodId = await subscriptions.getCurrentPeriodId()
              const { amountToPay, newLastPeriodId } = await subscriptions.getOwedFeesDetails(subscriber)

              assertBn(amountToPay, FEE_AMOUNT, 'amount to be paid does not match')
              assertBn(newLastPeriodId, currentPeriodId, 'new last period ID does not match')
            })

            it('pays the subscription', async () => {
              const previousPayerBalance = await feeToken.balanceOf(from)
              const previousSubscriptionsBalance = await feeToken.balanceOf(subscriptions.address)

              await subscriptions.payFees(subscriber, data, { from })

              const currentSubscriptionsBalance = await feeToken.balanceOf(subscriptions.address)
              assertBn(currentSubscriptionsBalance, previousSubscriptionsBalance.add(FEE_AMOUNT), 'subscriptions balances do not match')

              const currentPayerBalance = await feeToken.balanceOf(from)
              assertBn(currentPayerBalance, previousPayerBalance.sub(FEE_AMOUNT), 'payer balances do not match')
            })

            it('pays the governor fees', async () => {
              const previousGovernorFees = await getAccumulatedGovernorFees()
              const expectedGovernorFees = GOVERNOR_SHARE_PCT.mul(FEE_AMOUNT).div(PCT_BASE)

              await subscriptions.payFees(subscriber, data, { from })

              const currentGovernorFees = await getAccumulatedGovernorFees()
              assertBn(currentGovernorFees, previousGovernorFees.add(expectedGovernorFees), 'governor fees do not match')
            })

            it('emits an event', async () => {
              const receipt = await subscriptions.payFees(subscriber, data, { from })

              assertAmountOfEvents(receipt, SUBSCRIPTIONS_EVENTS.FEES_PAID)
              assertEvent(receipt, SUBSCRIPTIONS_EVENTS.FEES_PAID, { subscriber, feeToken: feeToken.address, feeAmount: FEE_AMOUNT, data })
            })
          }

          context('when the subscriber was not subscribed yet', () => {
            itHandleSubscriptionsSuccessfully()
          })

          context('when the subscriber was already subscribed', () => {
            beforeEach('subscribe', async () => {
              await subscriptions.payFees(subscriber, data, { from })
              await feeToken.generateTokens(from, FEE_AMOUNT)
              await feeToken.approve(subscriptions.address, FEE_AMOUNT, { from })
            })

            itHandleSubscriptionsSuccessfully()
          })
        })

        context('when the sender does not have enough balance', () => {
          it('reverts', async () => {
            await assertRevert(subscriptions.payFees(subscriber, data), SUBSCRIPTIONS_ERRORS.TOKEN_DEPOSIT_FAILED)
          })
        })
      })
    })
  })

  const transferFeesToGovernor = async (transferFunction, isLast = true, sameCurrentToken = true) => {
    const transferFeesToGovernorCall = async () => {
      let gweiUsedByGovernor = bn(0)

      if (transferFunction === 'transferFeesToGovernor') {
        const currentPeriodId = await subscriptions.getCurrentPeriodId()
        if (!isLast) {
          if (!sameCurrentToken) {
            const newFeeToken = await ERC20.new('New Subscriptions Fee Token', 'NSFT', 18)
            const governorBalanceBefore = await getWeiBalance(governor)
            await subscriptions.setFeeToken(newFeeToken.address, bn(1), { from: governor })
            const governorBalanceAfter = await getWeiBalance(governor)
            gweiUsedByGovernor = governorBalanceBefore.sub(governorBalanceAfter)
          }
          await controller.mockIncreaseTime(PERIOD_DURATION)
        }
        return { promise: subscriptions[transferFunction](currentPeriodId), gweiUsedByGovernor }
      } else {
        return { promise: subscriptions[transferFunction](), gweiUsedByGovernor }
      }
    }

    const transferFeesToGovernorOnlyCall = async () => (await transferFeesToGovernorCall()).promise

    before('create controller and move terms to reach period #0', async () => {
      controller = await buildHelper().deploy({ configGovernor: governor })
      await controller.mockSetTerm(PERIOD_DURATION)
    })

    context('when the fee token is an ERC20', () => {
      let feeToken

      before('deploy fee token', async () => {
        feeToken = await ERC20.new('Subscriptions Fee Token', 'SFT', 18)
      })

      beforeEach('create subscriptions module', async () => {
        subscriptions = await CourtSubscriptions.new(controller.address, PERIOD_DURATION, feeToken.address, FEE_AMOUNT, GOVERNOR_SHARE_PCT)
        await controller.setSubscriptions(subscriptions.address)
      })

      context('when there are no accumulated fees', () => {
        it('reverts', async () => {
          await assertRevert(transferFeesToGovernorOnlyCall(), SUBSCRIPTIONS_ERRORS.GOVERNOR_SHARE_FEES_ZERO)
        })
      })

      context('when there are some accumulated fees', () => {
        beforeEach('pay many subscriptions', async () => {
          const balance = FEE_AMOUNT.mul(bn(4))
          await feeToken.generateTokens(payer, balance)
          await feeToken.approve(subscriptions.address, balance, { from: payer })

          await controller.mockSetTerm(PERIOD_DURATION)
          await subscriptions.payFees(subscriber, '0x1a', { from: payer })
          await subscriptions.payFees(anotherSubscriber, '0x2a', { from: payer })

          await controller.mockIncreaseTerms(PERIOD_DURATION * 3)
          await subscriptions.payFees(subscriber, '0x1b', { from: payer })
          await subscriptions.payFees(anotherSubscriber, '0x2b', { from: payer })
        })

        it('transfers the fees to the governor', async () => {
          const previousAccumulatedFees = await getAccumulatedGovernorFees()
          const previousGovernorBalance = await feeToken.balanceOf(governor)

          await transferFeesToGovernorOnlyCall()

          const currentGovernorBalance = await feeToken.balanceOf(governor)
          assertBn(previousGovernorBalance.add(previousAccumulatedFees), currentGovernorBalance, 'governor shares do not match')

          const currentAccumulatedFees = await getAccumulatedGovernorFees()
          assertBn(currentAccumulatedFees, 0, 'governor shares do not match')
        })

        it('emits an event', async () => {
          const previousAccumulatedFees = await getAccumulatedGovernorFees()
          const receipt = await transferFeesToGovernorOnlyCall()

          assertAmountOfEvents(receipt, SUBSCRIPTIONS_EVENTS.GOVERNOR_FEES_TRANSFERRED)
          assertEvent(receipt, SUBSCRIPTIONS_EVENTS.GOVERNOR_FEES_TRANSFERRED, { feeToken: feeToken.address, amount: previousAccumulatedFees })
        })
      })
    })

    context('when the fee token is ETH', () => {
      const feeToken = ETH_TOKEN

      beforeEach('create subscriptions module', async () => {
        subscriptions = await CourtSubscriptions.new(controller.address, PERIOD_DURATION, feeToken, FEE_AMOUNT, GOVERNOR_SHARE_PCT)
        await controller.setSubscriptions(subscriptions.address)
      })

      context('when there are no accumulated fees', () => {
        it('reverts', async () => {
          await assertRevert(transferFeesToGovernorOnlyCall(), SUBSCRIPTIONS_ERRORS.GOVERNOR_SHARE_FEES_ZERO)
        })
      })

      context('when there are some accumulated fees', () => {
        beforeEach('pay many subscriptions', async () => {
          await controller.mockSetTerm(PERIOD_DURATION)
          await subscriptions.payFees(subscriber, '0x1a', { from: payer, value: FEE_AMOUNT })
          await subscriptions.payFees(anotherSubscriber, '0x2a', { from: payer, value: FEE_AMOUNT })

          await controller.mockIncreaseTerms(PERIOD_DURATION * 3)
          await subscriptions.payFees(subscriber, '0x1b', { from: payer, value: FEE_AMOUNT })
          await subscriptions.payFees(anotherSubscriber, '0x2b', { from: payer, value: FEE_AMOUNT })
        })

        it('transfers the fees to the governor', async () => {
          const previousAccumulatedFees = await getAccumulatedGovernorFees()
          const previousGovernorBalance = await getWeiBalance(governor)

          const transferFeesToGovernorCallResult = await transferFeesToGovernorCall()
          await transferFeesToGovernorCallResult.promise

          const currentGovernorBalance = await getWeiBalance(governor)
          assertBn(previousGovernorBalance.add(previousAccumulatedFees).sub(transferFeesToGovernorCallResult.gweiUsedByGovernor), currentGovernorBalance, 'governor shares do not match')

          const currentAccumulatedFees = await getAccumulatedGovernorFees()
          assertBn(currentAccumulatedFees, 0, 'governor shares do not match')
        })

        it('emits an event', async () => {
          const previousAccumulatedFees = await getAccumulatedGovernorFees()
          const receipt = await transferFeesToGovernorOnlyCall()

          assertAmountOfEvents(receipt, SUBSCRIPTIONS_EVENTS.GOVERNOR_FEES_TRANSFERRED)
          assertEvent(receipt, SUBSCRIPTIONS_EVENTS.GOVERNOR_FEES_TRANSFERRED, { feeToken: feeToken, amount: previousAccumulatedFees })
        })
      })
    })
  }

  describe('transferLastPeriodFeesToGovernor', () => {
    transferFeesToGovernor('transferLastPeriodFeesToGovernor')
  })

  describe('transferFeesToGovernor for last period', () => {
    transferFeesToGovernor('transferFeesToGovernor', true)
  })

  describe('transferFeesToGovernor for previous period', () => {
    context('when the current token has changed', () => {
      transferFeesToGovernor('transferFeesToGovernor', false, false)
    })

    context('when the current token hasn’t changed', () => {
      transferFeesToGovernor('transferFeesToGovernor', false, true)
    })
  })

  describe('isUpToDate', () => {
    const itIsUpToDate = () => {
      it('is up to date', async () => {
        assert.isTrue(await subscriptions.isUpToDate(subscriber), 'subscriber is not up to date')
      })
    }

    context('when the given token address is an ERC20', async () => {
      let feeToken

      before('create controller', async () => {
        controller = await buildHelper().deploy({ configGovernor: governor })
      })

      before('deploy new fee token', async () => {
        feeToken = await ERC20.new('New Fee Token', 'NFT', 18)
      })

      beforeEach('create subscriptions module', async () => {
        subscriptions = await CourtSubscriptions.new(controller.address, PERIOD_DURATION, feeToken.address, FEE_AMOUNT, GOVERNOR_SHARE_PCT)
        await controller.setSubscriptions(subscriptions.address)
      })

      context('when the court has not started yet', () => {
        itIsUpToDate()
      })

      context('when the court has already started', () => {
        beforeEach('move terms to reach period #0', async () => {
          await controller.mockSetTerm(PERIOD_DURATION)
        })

        context('when the subscriber was not subscribed before', () => {
          itIsUpToDate()
        })

        context('when the subscriber was already subscribed', () => {
          beforeEach('subscribe', async () => {
            await feeToken.generateTokens(payer, FEE_AMOUNT)
            await feeToken.approve(subscriptions.address, FEE_AMOUNT, { from: payer })
            await subscriptions.payFees(subscriber, '0x', { from: payer })
          })

          context('when the subscriber was subscribed for the current period', () => {
            itIsUpToDate()
          })

          context('when the subscriber was not subscribed for the current period', () => {
            beforeEach('advance one period', async () => {
              await controller.mockIncreaseTerms(PERIOD_DURATION)
            })

            itIsUpToDate()
          })
        })
      })
    })

    context('when the given token address is ETH', async () => {
      const feeToken = ETH_TOKEN

      before('create controller', async () => {
        controller = await buildHelper().deploy({ configGovernor: governor })
      })

      beforeEach('create subscriptions module', async () => {
        subscriptions = await CourtSubscriptions.new(controller.address, PERIOD_DURATION, feeToken, FEE_AMOUNT, GOVERNOR_SHARE_PCT)
        await controller.setSubscriptions(subscriptions.address)
      })

      context('when the court has not started yet', () => {
        itIsUpToDate()
      })

      context('when the court has already started', () => {
        beforeEach('move terms to reach period #0', async () => {
          await controller.mockSetTerm(PERIOD_DURATION)
        })

        context('when the subscriber was not subscribed before', () => {
          itIsUpToDate()
        })

        context('when the subscriber was already subscribed', () => {
          beforeEach('subscribe', async () => {
            await subscriptions.payFees(subscriber, '0x', { from: payer, value: FEE_AMOUNT })
          })

          context('when the subscriber was subscribed for the current period', () => {
            itIsUpToDate()
          })

          context('when the subscriber was not subscribed for the current period', () => {
            beforeEach('advance one period', async () => {
              await controller.mockIncreaseTerms(PERIOD_DURATION)
            })

            itIsUpToDate()
          })
        })
      })
    })
  })
})
