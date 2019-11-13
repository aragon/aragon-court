const { assertBn } = require('../helpers/asserts/assertBn')
const { bn, bigExp } = require('../helpers/lib/numbers')
const { buildHelper } = require('../helpers/wrappers/controller')(web3, artifacts)
const { assertRevert } = require('../helpers/asserts/assertThrow')
const { SUBSCRIPTIONS_ERRORS } = require('../helpers/utils/errors')
const { SUBSCRIPTIONS_EVENTS } = require('../helpers/utils/events')
const { assertAmountOfEvents, assertEvent } = require('../helpers/asserts/assertEvent')

const CourtSubscriptions = artifacts.require('CourtSubscriptions')
const ERC20 = artifacts.require('ERC20Mock')

contract('CourtSubscriptions', ([_, governor, payer, subscriber, anotherSubscriber]) => {
  let controller, subscriptions, feeToken

  const PCT_BASE = bn(10000)
  const FEE_AMOUNT = bigExp(10, 18)
  const PREPAYMENT_PERIODS = 5
  const RESUME_PRE_PAID_PERIODS = 1
  const PERIOD_DURATION = 24 * 30           // 30 days, assuming terms are 1h
  const GOVERNOR_SHARE_PCT = bn(100)        // 100‱ = 1%
  const LATE_PAYMENT_PENALTY_PCT = bn(1000) // 1000‱ = 10%

  const penaltyFees = (n, pct) => n.mul(pct.add(PCT_BASE)).div(PCT_BASE)

  beforeEach('create base contracts', async () => {
    controller = await buildHelper().deploy({ configGovernor: governor })
    feeToken = await ERC20.new('Subscriptions Fee Token', 'SFT', 18)

    subscriptions = await CourtSubscriptions.new(controller.address, PERIOD_DURATION, feeToken.address, FEE_AMOUNT, PREPAYMENT_PERIODS, RESUME_PRE_PAID_PERIODS, LATE_PAYMENT_PENALTY_PCT, GOVERNOR_SHARE_PCT)
    await controller.setSubscriptions(subscriptions.address)
  })

  describe('payFees', () => {
    context('when the number of periods is greater than zero', () => {
      const periods = 10

      context('when the court has not started yet', () => {
        it('reverts', async () => {
          await assertRevert(subscriptions.payFees(subscriber, periods), SUBSCRIPTIONS_ERRORS.COURT_HAS_NOT_STARTED)
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

          const itHandleSubscriptionsSuccessfully = (expectedMovedPeriods, expectedRegularPeriods, expectedDelayedPeriods) => {
            const expectedRegularFees = FEE_AMOUNT.mul(bn(expectedRegularPeriods))
            const expectedDelayedFees = penaltyFees(FEE_AMOUNT.mul(bn(expectedDelayedPeriods)), LATE_PAYMENT_PENALTY_PCT)
            const expectedTotalPaidFees = expectedRegularFees.add(expectedDelayedFees)
            const expectedGovernorFees = GOVERNOR_SHARE_PCT.mul(expectedTotalPaidFees).div(PCT_BASE)

            it('estimates last period id correctly', async () => {
              const currentPeriodId = (await subscriptions.getCurrentPeriodId()).toNumber()
              const expectedLastPeriodId = currentPeriodId + expectedMovedPeriods
              const { newLastPeriodId } = await subscriptions.getPayFeesDetails(subscriber, periods)

              assertBn(newLastPeriodId, expectedLastPeriodId, 'new last period id does not match')
            })

            it('computes number of delayed periods correctly', async () => {
              const previousDelayedPeriods = await subscriptions.getDelayedPeriods(subscriber)

              await subscriptions.payFees(subscriber, periods, { from })

              const currentDelayedPeriods = await subscriptions.getDelayedPeriods(subscriber)
              assertBn(currentDelayedPeriods, previousDelayedPeriods.sub(bn(expectedDelayedPeriods)), 'number of delayed periods does not match')
            })

            it('subscribes the requested periods', async () => {
              const previousDelayedPeriods = await subscriptions.getDelayedPeriods(subscriber)

              await subscriptions.payFees(subscriber, periods, { from })

              assert.equal(await subscriptions.isUpToDate(subscriber), periods > previousDelayedPeriods, 'subscriber up-to-date does not match')
            })

            it('updates the number of owed periods correctly', async () => {
              const { amountToPay: previousAmountToPay } = await subscriptions.getOwedFeesDetails(subscriber)

              await subscriptions.payFees(subscriber, periods, { from })

              const { amountToPay: currentAmountToPay } = await subscriptions.getOwedFeesDetails(subscriber)
              const expectedCurrentAmountToPay = expectedTotalPaidFees.gt(previousAmountToPay) ? 0 : previousAmountToPay.sub(expectedTotalPaidFees)
              assertBn(currentAmountToPay, expectedCurrentAmountToPay, 'amount to pay does not match')
            })

            it('pays the requested periods subscriptions', async () => {
              const previousPayerBalance = await feeToken.balanceOf(from)
              const previousSubscriptionsBalance = await feeToken.balanceOf(subscriptions.address)

              const { amountToPay } = await subscriptions.getPayFeesDetails(subscriber, periods)
              assertBn(amountToPay, expectedTotalPaidFees, 'amount to be paid does not match')

              await subscriptions.payFees(subscriber, periods, { from })

              const currentSubscriptionsBalance = await feeToken.balanceOf(subscriptions.address)
              assertBn(currentSubscriptionsBalance, previousSubscriptionsBalance.add(expectedTotalPaidFees), 'subscriptions balances do not match')

              const currentPayerBalance = await feeToken.balanceOf(from)
              assertBn(currentPayerBalance, previousPayerBalance.sub(expectedTotalPaidFees), 'payer balances do not match')
            })

            it('pays the governor fees', async () => {
              const { newLastPeriodId } = await subscriptions.getPayFeesDetails(subscriber, periods)
              const previousGovernorFees = await subscriptions.accumulatedGovernorFees()

              const receipt = await subscriptions.payFees(subscriber, periods, { from })

              const currentGovernorFees = await subscriptions.accumulatedGovernorFees()
              assertBn(currentGovernorFees, previousGovernorFees.add(expectedGovernorFees), 'governor fees do not match')

              const expectedCollectedFees = expectedTotalPaidFees.sub(expectedGovernorFees)
              assertAmountOfEvents(receipt, SUBSCRIPTIONS_EVENTS.FEES_PAID)
              assertEvent(receipt, SUBSCRIPTIONS_EVENTS.FEES_PAID, { subscriber, periods, newLastPeriodId, collectedFees: expectedCollectedFees, governorFee: expectedGovernorFees })
            })
          }

          context('when the subscriber was not subscribed yet', () => {
            const expectedMovedPeriods = periods - 1
            const expectedRegularPeriods = periods
            const expectedDelayedPeriods = 0

            it('owes the current period', async () => {
              const { amountToPay, newLastPeriodId } = await subscriptions.getOwedFeesDetails(subscriber)

              assertBn(newLastPeriodId, 0, 'last period does not match')
              assertBn(amountToPay, FEE_AMOUNT, 'amount to pay does not match')
            })

            context('when the number of pre-payment periods is not reached', () => {
              beforeEach('set number of pre-payment periods', async () => {
                await subscriptions.setPrePaymentPeriods(periods + 1, { from: governor })
              })

              itHandleSubscriptionsSuccessfully(expectedMovedPeriods, expectedRegularPeriods, expectedDelayedPeriods)
            })

            context('when the number of pre-payment periods is reached', () => {
              beforeEach('set number of pre-payment periods', async () => {
                await subscriptions.setPrePaymentPeriods(periods, { from: governor })
              })

              itHandleSubscriptionsSuccessfully(expectedMovedPeriods, expectedRegularPeriods, expectedDelayedPeriods)
            })

            context('when the number of pre-payment periods is exceeded', () => {
              beforeEach('set number of pre-payment periods', async () => {
                await subscriptions.setPrePaymentPeriods(periods - 1, { from: governor })
              })

              it('reverts', async () => {
                await assertRevert(subscriptions.payFees(subscriber, periods, { from }), SUBSCRIPTIONS_ERRORS.PAYING_TOO_MANY_PERIODS)
              })
            })
          })

          context('when the subscriber was already subscribed', () => {
            beforeEach('subscribe', async () => {
              await subscriptions.payFees(subscriber, 1, { from })
            })

            context('when the subscriber was not paused', () => {
              context('when the subscriber has paid some periods in advance', () => {
                const prePaidPeriods = 3
                const previousPaidPeriods = 1 + prePaidPeriods
                const expectedMovedPeriods = periods + prePaidPeriods
                const expectedRegularPeriods = periods
                const expectedDelayedPeriods = 0

                beforeEach('subscribe', async () => {
                  await subscriptions.payFees(subscriber, prePaidPeriods, { from })
                })

                it('does not owe periods', async () => {
                  const { amountToPay, newLastPeriodId } = await subscriptions.getOwedFeesDetails(subscriber)

                  assertBn(newLastPeriodId, prePaidPeriods, 'last period does not match')
                  assertBn(amountToPay, 0, 'amount to pay does not match')
                })

                context('when the number of pre-payment periods is not reached', () => {
                  beforeEach('set number of pre-payment periods', async () => {
                    await subscriptions.setPrePaymentPeriods(periods + previousPaidPeriods + 1, { from: governor })
                  })

                  itHandleSubscriptionsSuccessfully(expectedMovedPeriods, expectedRegularPeriods, expectedDelayedPeriods)
                })

                context('when the number of pre-payment periods is reached', () => {
                  beforeEach('set number of pre-payment periods', async () => {
                    await subscriptions.setPrePaymentPeriods(periods + previousPaidPeriods, { from: governor })
                  })

                  itHandleSubscriptionsSuccessfully(expectedMovedPeriods, expectedRegularPeriods, expectedDelayedPeriods)
                })

                context('when the number of pre-payment periods is exceeded', () => {
                  beforeEach('set number of pre-payment periods', async () => {
                    await subscriptions.setPrePaymentPeriods(periods + previousPaidPeriods - 1, { from: governor })
                  })

                  it('reverts', async () => {
                    await assertRevert(subscriptions.payFees(subscriber, periods, { from }), SUBSCRIPTIONS_ERRORS.PAYING_TOO_MANY_PERIODS)
                  })
                })
              })

              context('when the subscriber is up-to-date and has not pre-paid any periods', () => {
                const previousPaidPeriods = 1
                const expectedMovedPeriods = periods
                const expectedRegularPeriods = periods
                const expectedDelayedPeriods = 0

                it('does not owe periods', async () => {
                  const { amountToPay, newLastPeriodId } = await subscriptions.getOwedFeesDetails(subscriber)

                  assertBn(newLastPeriodId, 0, 'last period does not match')
                  assertBn(amountToPay, 0, 'amount to pay does not match')
                })

                context('when the number of pre-payment periods is not reached', () => {
                  beforeEach('set number of pre-payment periods', async () => {
                    await subscriptions.setPrePaymentPeriods(periods + previousPaidPeriods + 1, { from: governor })
                  })

                  itHandleSubscriptionsSuccessfully(expectedMovedPeriods, expectedRegularPeriods, expectedDelayedPeriods)
                })

                context('when the number of pre-payment periods is reached', () => {
                  beforeEach('set number of pre-payment periods', async () => {
                    await subscriptions.setPrePaymentPeriods(periods + previousPaidPeriods, { from: governor })
                  })

                  itHandleSubscriptionsSuccessfully(expectedMovedPeriods, expectedRegularPeriods, expectedDelayedPeriods)
                })

                context('when the number of pre-payment periods is exceeded', () => {
                  beforeEach('set number of pre-payment periods', async () => {
                    await subscriptions.setPrePaymentPeriods(periods + previousPaidPeriods - 1, { from: governor })
                  })

                  it('reverts', async () => {
                    await assertRevert(subscriptions.payFees(subscriber, periods, { from }), SUBSCRIPTIONS_ERRORS.PAYING_TOO_MANY_PERIODS)
                  })
                })
              })

              context('when the subscriber has some overdue periods', () => {
                context('when the given number of periods is lower than the number of overdue periods', () => {
                  const overduePeriods = periods + 2

                  const expectedMovedPeriods = -2
                  const expectedRegularPeriods = 0
                  const expectedDelayedPeriods = periods

                  beforeEach('advance periods', async () => {
                    await controller.mockIncreaseTerms(PERIOD_DURATION * overduePeriods)
                  })

                  it('ows some periods', async () => {
                    const { amountToPay, newLastPeriodId } = await subscriptions.getOwedFeesDetails(subscriber)

                    assertBn(newLastPeriodId, overduePeriods, 'last period does not match')

                    const expectedAmountToPay = penaltyFees(FEE_AMOUNT.mul(bn(11)), LATE_PAYMENT_PENALTY_PCT).add(FEE_AMOUNT)
                    assertBn(amountToPay, expectedAmountToPay, 'amount to pay does not match')
                  })

                  itHandleSubscriptionsSuccessfully(expectedMovedPeriods, expectedRegularPeriods, expectedDelayedPeriods)
                })

                context('when the given number of periods is equal to the number of overdue periods', () => {
                  const overduePeriods = periods

                  const expectedMovedPeriods = 0
                  const expectedRegularPeriods = 1 // the current term is not considered delayed if it is not paid yet
                  const expectedDelayedPeriods = periods - 1

                  beforeEach('advance periods', async () => {
                    await controller.mockIncreaseTerms(PERIOD_DURATION * overduePeriods)
                  })

                  it('ows some periods', async () => {
                    const { amountToPay, newLastPeriodId } = await subscriptions.getOwedFeesDetails(subscriber)

                    assertBn(newLastPeriodId, overduePeriods, 'last period does not match')

                    const expectedAmountToPay = penaltyFees(FEE_AMOUNT.mul(bn(9)), LATE_PAYMENT_PENALTY_PCT).add(FEE_AMOUNT)
                    assertBn(amountToPay, expectedAmountToPay, 'amount to pay does not match')
                  })

                  itHandleSubscriptionsSuccessfully(expectedMovedPeriods, expectedRegularPeriods, expectedDelayedPeriods)
                })

                context('when the given number of periods is greater than the number of overdue periods', () => {
                  const overduePeriods = periods - 2

                  const expectedMovedPeriods = 2
                  const expectedRegularPeriods = 3 // the current term is not considered delayed if it is not paid yet
                  const expectedDelayedPeriods = periods - 3

                  beforeEach('advance periods', async () => {
                    await controller.mockIncreaseTerms(PERIOD_DURATION * overduePeriods)
                  })

                  it('ows some periods', async () => {
                    const { amountToPay, newLastPeriodId } = await subscriptions.getOwedFeesDetails(subscriber)

                    assertBn(newLastPeriodId, overduePeriods, 'last period does not match')

                    const expectedAmountToPay = penaltyFees(FEE_AMOUNT.mul(bn(7)), LATE_PAYMENT_PENALTY_PCT).add(FEE_AMOUNT)
                    assertBn(amountToPay, expectedAmountToPay, 'amount to pay does not match')
                  })

                  context('when the number of pre-payment periods is not reached', () => {
                    beforeEach('set number of pre-payment periods', async () => {
                      await subscriptions.setPrePaymentPeriods(periods - overduePeriods + 2, { from: governor })
                    })

                    itHandleSubscriptionsSuccessfully(expectedMovedPeriods, expectedRegularPeriods, expectedDelayedPeriods)
                  })

                  context('when the number of pre-payment periods is reached', () => {
                    beforeEach('set number of pre-payment periods', async () => {
                      await subscriptions.setPrePaymentPeriods(periods - overduePeriods + 1, { from: governor })
                    })

                    itHandleSubscriptionsSuccessfully(expectedMovedPeriods, expectedRegularPeriods, expectedDelayedPeriods)
                  })

                  context('when the number of pre-payment periods is exceeded', () => {
                    beforeEach('set number of pre-payment periods', async () => {
                      await subscriptions.setPrePaymentPeriods(periods - overduePeriods, { from: governor })
                    })

                    it('reverts', async () => {
                      await assertRevert(subscriptions.payFees(subscriber, periods, { from }), SUBSCRIPTIONS_ERRORS.PAYING_TOO_MANY_PERIODS)
                    })
                  })
                })
              })
            })

            context('when the subscriber was paused', () => {
              beforeEach('pause', async () => {
                await subscriptions.pause({ from: subscriber })
              })

              it('reverts', async () => {
                await assertRevert(subscriptions.payFees(subscriber, periods, { from }), SUBSCRIPTIONS_ERRORS.SUBSCRIPTION_PAUSED)
              })
            })
          })
        })

        context('when the sender does not have enough balance', () => {
          it('reverts', async () => {
            await assertRevert(subscriptions.payFees(subscriber, 1), SUBSCRIPTIONS_ERRORS.TOKEN_TRANSFER_FAILED)
          })
        })
      })
    })

    context('when the number of periods is zero', () => {
      const periods = 0

      it('reverts', async () => {
        await assertRevert(subscriptions.payFees(subscriber, periods), SUBSCRIPTIONS_ERRORS.PAYING_ZERO_PERIODS)
      })
    })
  })

  describe('transferFeesToGovernor', () => {
    context('when there are no accumulated fees', () => {
      it('reverts', async () => {
        await assertRevert(subscriptions.transferFeesToGovernor(), SUBSCRIPTIONS_ERRORS.GOVERNOR_SHARE_FEES_ZERO)
      })
    })

    context('when there are some accumulated fees', () => {
      beforeEach('pay many subscriptions', async () => {
        const balance = FEE_AMOUNT.mul(bn(1000000))
        await feeToken.generateTokens(payer, balance)
        await feeToken.approve(subscriptions.address, balance, { from: payer })

        await controller.mockSetTerm(PERIOD_DURATION)
        await subscriptions.payFees(subscriber, 5, { from: payer })
        await subscriptions.payFees(anotherSubscriber, 2, { from: payer })

        await controller.mockIncreaseTerms(PERIOD_DURATION * 3)
        await subscriptions.payFees(subscriber, 1, { from: payer })
        await subscriptions.payFees(anotherSubscriber, 4, { from: payer })
      })

      it('transfers the fees to the governor', async () => {
        const previousAccumulatedFees = await subscriptions.accumulatedGovernorFees()
        const previousGovernorBalance = await feeToken.balanceOf(governor)

        await subscriptions.transferFeesToGovernor()

        const currentGovernorBalance = await feeToken.balanceOf(governor)
        assertBn(previousGovernorBalance.add(previousAccumulatedFees), currentGovernorBalance, 'governor shares do not match')

        const currentAccumulatedFees = await subscriptions.accumulatedGovernorFees()
        assertBn(currentAccumulatedFees, 0, 'governor shares do not match')
      })

      it('emits an event', async () => {
        const previousAccumulatedFees = await subscriptions.accumulatedGovernorFees()
        const receipt = await subscriptions.transferFeesToGovernor()

        assertAmountOfEvents(receipt, SUBSCRIPTIONS_EVENTS.GOVERNOR_FEES_TRANSFERRED)
        assertEvent(receipt, SUBSCRIPTIONS_EVENTS.GOVERNOR_FEES_TRANSFERRED, { amount: previousAccumulatedFees })
      })
    })
  })

  describe('isUpToDate', () => {
    context('when the subscriber was already subscribed', () => {
      const paidPeriods = bn(1)
      const paidAmount = FEE_AMOUNT

      beforeEach('subscribe', async () => {
        await controller.mockSetTerm(PERIOD_DURATION)
        await feeToken.generateTokens(subscriber, paidAmount)
        await feeToken.approve(subscriptions.address, paidAmount, { from: subscriber })
        await subscriptions.payFees(subscriber, paidPeriods, { from: subscriber })
      })

      context('when the subscriber has paid the current period', () => {
        it('returns true', async () => {
          assert.isTrue(await subscriptions.isUpToDate(subscriber))
        })
      })

      context('when the subscriber has not paid the current period', () => {
        beforeEach('advance one period', async () => {
          await controller.mockIncreaseTerms(PERIOD_DURATION)
        })

        it('returns false', async () => {
          assert.isFalse(await subscriptions.isUpToDate(subscriber))
        })
      })
    })

    context('when the subscriber was not subscribed yet', () => {
      it('returns false', async () => {
        assert.isFalse(await subscriptions.isUpToDate(subscriber))
      })
    })
  })
})
