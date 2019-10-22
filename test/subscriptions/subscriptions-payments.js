const { bn, bigExp } = require('../helpers/numbers')
const { assertRevert } = require('../helpers/assertThrow')
const { ONE_DAY, NEXT_WEEK } = require('../helpers/time')
const { assertAmountOfEvents, assertEvent } = require('../helpers/assertEvent')

const CourtSubscriptions = artifacts.require('CourtSubscriptions')
const Controller = artifacts.require('ControllerMock')
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

  beforeEach('create base contracts', async () => {
    controller = await Controller.new(ONE_DAY, NEXT_WEEK, { from: governor })
    feeToken = await ERC20.new('Subscriptions Fee Token', 'SFT', 18)

    subscriptions = await CourtSubscriptions.new(controller.address, PERIOD_DURATION, feeToken.address, FEE_AMOUNT, PREPAYMENT_PERIODS, RESUME_PRE_PAID_PERIODS, LATE_PAYMENT_PENALTY_PCT, GOVERNOR_SHARE_PCT)
    await controller.setSubscriptions(subscriptions.address)
  })

  describe('payFees', () => {
    context('when the number of periods is greater than zero', () => {
      const periods = 10

      context('when the court has not started yet', () => {
        it('reverts', async () => {
          await assertRevert(subscriptions.payFees(subscriber, periods), 'MATH_SUB_UNDERFLOW')
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
            const expectedDelayedFees = FEE_AMOUNT.mul(bn(expectedDelayedPeriods)).mul(LATE_PAYMENT_PENALTY_PCT.add(PCT_BASE)).div(PCT_BASE)
            const expectedTotalPaidFees = expectedRegularFees.add(expectedDelayedFees)
            const expectedGovernorFees = GOVERNOR_SHARE_PCT.mul(expectedTotalPaidFees).div(PCT_BASE)

            it('estimates last period id correctly', async () => {
              const currentPeriodId = (await subscriptions.getCurrentPeriodId()).toNumber()
              const expectedLastPeriodId = currentPeriodId + expectedMovedPeriods
              const { newLastPeriodId } = await subscriptions.getPayFeesDetails(subscriber, periods)

              assert.equal(newLastPeriodId.toString(), expectedLastPeriodId, 'new last period id does not match')
            })

            it('computes number of delayed periods correctly', async () => {
              const previousDelayedPeriods = await subscriptions.getDelayedPeriods(subscriber)

              await subscriptions.payFees(subscriber, periods, { from })

              const currentDelayedPeriods = await subscriptions.getDelayedPeriods(subscriber)
              assert.equal(currentDelayedPeriods.toString(), previousDelayedPeriods.sub(bn(expectedDelayedPeriods)).toString(), 'number of delayed periods does not match')
            })

            it('subscribes the requested periods', async () => {
              const previousDelayedPeriods = await subscriptions.getDelayedPeriods(subscriber)

              await subscriptions.payFees(subscriber, periods, { from })

              assert.equal(await subscriptions.isUpToDate(subscriber), periods > previousDelayedPeriods, 'subscriber up-to-date does not match')
            })

            it('pays the requested periods subscriptions', async () => {
              const previousPayerBalance = await feeToken.balanceOf(from)
              const previousSubscriptionsBalance = await feeToken.balanceOf(subscriptions.address)

              const { amountToPay } = await subscriptions.getPayFeesDetails(subscriber, periods)
              assert.equal(amountToPay.toString(), expectedTotalPaidFees.toString(), 'amount to be paid does not match')

              await subscriptions.payFees(subscriber, periods, { from })

              const currentSubscriptionsBalance = await feeToken.balanceOf(subscriptions.address)
              assert.equal(currentSubscriptionsBalance.toString(), previousSubscriptionsBalance.add(expectedTotalPaidFees).toString(), 'subscriptions balances do not match')

              const currentPayerBalance = await feeToken.balanceOf(from)
              assert.equal(currentPayerBalance.toString(), previousPayerBalance.sub(expectedTotalPaidFees).toString(), 'payer balances do not match')
            })

            it('pays the governor fees', async () => {
              const { newLastPeriodId } = await subscriptions.getPayFeesDetails(subscriber, periods)
              const previousGovernorFees = await subscriptions.accumulatedGovernorFees()

              const receipt = await subscriptions.payFees(subscriber, periods, { from })

              const currentGovernorFees = await subscriptions.accumulatedGovernorFees()
              assert.equal(currentGovernorFees.toString(), previousGovernorFees.add(expectedGovernorFees).toString(), 'governor fees do not match')

              const expectedCollectedFees = expectedTotalPaidFees.sub(expectedGovernorFees)
              assertAmountOfEvents(receipt, 'FeesPaid')
              assertEvent(receipt, 'FeesPaid', { subscriber, periods, newLastPeriodId, collectedFees: expectedCollectedFees, governorFee: expectedGovernorFees })
            })
          }

          context('when the subscriber was not subscribed yet', () => {
            const expectedMovedPeriods = periods - 1
            const expectedRegularPeriods = periods
            const expectedDelayedPeriods = 0

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
                await assertRevert(subscriptions.payFees(subscriber, periods, { from }), 'CS_PAYING_TOO_MANY_PERIODS')
              })
            })
          })

          context('when the subscriber was already subscribed', () => {
            beforeEach('subscribe', async () => {
              await subscriptions.payFees(subscriber, 1, { from })
            })

            context('when the subscriber has paid some periods in advance', () => {
              const prePaidPeriods = 3
              const previousPaidPeriods = 1 + prePaidPeriods
              const expectedMovedPeriods = periods + prePaidPeriods
              const expectedRegularPeriods = periods
              const expectedDelayedPeriods = 0

              beforeEach('subscribe', async () => {
                await subscriptions.payFees(subscriber, prePaidPeriods, { from })
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
                  await assertRevert(subscriptions.payFees(subscriber, periods, { from }), 'CS_PAYING_TOO_MANY_PERIODS')
                })
              })
            })

            context('when the subscriber is up-to-date and has not pre-paid any periods', () => {
              const previousPaidPeriods = 1
              const expectedMovedPeriods = periods
              const expectedRegularPeriods = periods
              const expectedDelayedPeriods = 0

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
                  await assertRevert(subscriptions.payFees(subscriber, periods, { from }), 'CS_PAYING_TOO_MANY_PERIODS')
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
                    await assertRevert(subscriptions.payFees(subscriber, periods, { from }), 'CS_PAYING_TOO_MANY_PERIODS')
                  })
                })
              })
            })
          })
        })

        context('when the sender does not have enough balance', () => {
          it('reverts', async () => {
            await assertRevert(subscriptions.payFees(subscriber, 1), 'CS_TOKEN_TRANSFER_FAILED')
          })
        })
      })
    })

    context('when the number of periods is zero', () => {
      const periods = 0

      it('reverts', async () => {
        await assertRevert(subscriptions.payFees(subscriber, periods), 'CS_PAYING_ZERO_PERIODS')
      })
    })
  })

  describe('transferFeesToGovernor', () => {
    context('when there are no accumulated fees', () => {
      it('reverts', async () => {
        await assertRevert(subscriptions.transferFeesToGovernor(), 'CS_GOVERNOR_SHARE_FEES_ZERO')
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
        assert.equal(previousGovernorBalance.add(previousAccumulatedFees).toString(), currentGovernorBalance.toString(), 'governor shares do not match')

        const currentAccumulatedFees = await subscriptions.accumulatedGovernorFees()
        assert.equal(currentAccumulatedFees.toString(), 0, 'governor shares do not match')
      })

      it('emits an event', async () => {
        const previousAccumulatedFees = await subscriptions.accumulatedGovernorFees()
        const receipt = await subscriptions.transferFeesToGovernor()

        assertAmountOfEvents(receipt, 'GovernorFeesTransferred')
        assertEvent(receipt, 'GovernorFeesTransferred', { amount: previousAccumulatedFees })
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
