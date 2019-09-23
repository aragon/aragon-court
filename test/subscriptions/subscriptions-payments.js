const { bn, bigExp } = require('../helpers/numbers')
const { assertRevert } = require('../helpers/assertThrow')
const { assertAmountOfEvents, assertEvent } = require('../helpers/assertEvent')

const CourtSubscriptions = artifacts.require('CourtSubscriptions')
const SubscriptionsOwner = artifacts.require('SubscriptionsOwnerMock')
const JurorsRegistry = artifacts.require('JurorsRegistry')
const ERC20 = artifacts.require('ERC20Mock')

contract('CourtSubscriptions', ([_, payer, subscriber, anotherSubscriber]) => {
  let subscriptions, subscriptionsOwner, jurorsRegistry, feeToken

  const PCT_BASE = bn(10000)
  const FEE_AMOUNT = bigExp(10, 18)
  const PREPAYMENT_PERIODS = 12
  const PERIOD_DURATION = 24 * 30           // 30 days, assuming terms are 1h
  const GOVERNOR_SHARE_PCT = bn(100)        // 100‱ = 1%
  const LATE_PAYMENT_PENALTY_PCT = bn(1000) // 1000‱ = 10%

  beforeEach('create base contracts', async () => {
    subscriptions = await CourtSubscriptions.new()
    subscriptionsOwner = await SubscriptionsOwner.new(subscriptions.address)
    jurorsRegistry = await JurorsRegistry.new()
    feeToken = await ERC20.new('Subscriptions Fee Token', 'SFT', 18)
  })

  describe('payFees', () => {
    context('when the subscriptions was already initialized', () => {
      beforeEach('initialize subscriptions', async () => {
        await subscriptions.init(subscriptionsOwner.address, jurorsRegistry.address, PERIOD_DURATION, feeToken.address, FEE_AMOUNT, PREPAYMENT_PERIODS, LATE_PAYMENT_PENALTY_PCT, GOVERNOR_SHARE_PCT)
      })

      context('when the number of periods is greater than zero', () => {
        const periods = 10

        context('when the court has not started yet', () => {
          it('reverts', async () => {
            await assertRevert(subscriptions.payFees(subscriber, periods), 'MATH_SUB_UNDERFLOW')
          })
        })

        context('when the court has already started', () => {
          beforeEach('move terms to reach period #0', async () => {
            await subscriptionsOwner.mockSetTerm(PERIOD_DURATION)
          })

          context('when the sender has enough balance', () => {
            const from = payer

            beforeEach('mint fee tokens', async () => {
              const balance = FEE_AMOUNT.mul(bn(10000))
              await feeToken.generateTokens(from, balance)
              await feeToken.approve(subscriptions.address, balance, { from })
            })

            const itHandleSubscriptionsSuccessfully = (previousPaidPeriods, previousDelayedPeriods, expectedDelayedPeriods) => {
              const regularPeriods = periods > previousDelayedPeriods ? periods - previousDelayedPeriods : 0
              const regularPeriodsFees = FEE_AMOUNT.mul(bn(regularPeriods))

              const delayedPeriods = periods > previousDelayedPeriods ? previousDelayedPeriods : periods
              const delayedPeriodsFees = FEE_AMOUNT.mul(bn(delayedPeriods)).mul(LATE_PAYMENT_PENALTY_PCT.add(PCT_BASE)).div(PCT_BASE)

              const paidAmount = regularPeriodsFees.add(delayedPeriodsFees)
              const governorFees = GOVERNOR_SHARE_PCT.mul(paidAmount).div(PCT_BASE)

              it('estimates last period id correctly', async () => {
                const previousPeriodId = (await subscriptions.getCurrentPeriodId()).toNumber()
                const expectedLastPeriodId = previousPeriodId + previousPaidPeriods - previousDelayedPeriods + periods - 1

                const { newLastPeriodId } = await subscriptions.getPayFeesDetails(subscriber, periods)

                assert.equal(newLastPeriodId.toString(), expectedLastPeriodId.toString(), 'new last period id does not match')
              })

              it('computes number of delayed periods correctly', async () => {
                const delayedPeriods = await subscriptions.getDelayedPeriods(subscriber)

                assert.equal(delayedPeriods.toString(), previousDelayedPeriods, 'number of delayed periods does not match')
              })

              it('subscribes the requested periods', async () => {
                await subscriptions.payFees(subscriber, periods, { from })
                assert.equal(await subscriptions.isUpToDate(subscriber), periods > previousDelayedPeriods, 'subscriber up-to-date does not match')
                assert.equal((await subscriptions.getDelayedPeriods(subscriber)).toString(), expectedDelayedPeriods, 'delayed periods does not match')
              })

              it('pays the requested periods subscriptions', async () => {
                const previousPayerBalance = await feeToken.balanceOf(from)
                const previousSubscriptionsBalance = await feeToken.balanceOf(subscriptions.address)

                const { amountToPay } = await subscriptions.getPayFeesDetails(subscriber, periods)
                assert.equal(amountToPay.toString(), paidAmount.toString(), 'amount to be paid does not match')

                await subscriptions.payFees(subscriber, periods, { from })

                const currentSubscriptionsBalance = await feeToken.balanceOf(subscriptions.address)
                assert.equal(previousSubscriptionsBalance.add(paidAmount).toString(), currentSubscriptionsBalance.toString(), 'subscriptions balances do not match')

                const currentPayerBalance = await feeToken.balanceOf(from)
                assert.equal(previousPayerBalance.sub(paidAmount).toString(), currentPayerBalance.toString(), 'payer balances do not match')
              })

              it('pays the governor fees', async () => {
                const previousGovernorFees = await subscriptions.accumulatedGovernorFees()

                await subscriptions.payFees(subscriber, periods, { from })

                const currentGovernorFees = await subscriptions.accumulatedGovernorFees()
                assert.equal(previousGovernorFees.add(governorFees).toString(), currentGovernorFees.toString(), 'governor fees do not match')
              })

              it('emits a governor share fees transferred event', async () => {
                const { newLastPeriodId } = await subscriptions.getPayFeesDetails(subscriber, periods)
                const receipt = await subscriptions.payFees(subscriber, periods, { from })

                assertAmountOfEvents(receipt, 'FeesPaid')
                assertEvent(receipt, 'FeesPaid', { subscriber, periods, newLastPeriodId, collectedFees: paidAmount.sub(governorFees), governorFee: governorFees })
              })
            }

            context('when the subscriber was not subscribed yet', () => {
              const previousPaidPeriods = 0
              const previousDelayedPeriods = 0
              const expectedDelayedPeriods = 0

              context('when the number of pre-payment periods is not reached', () => {
                beforeEach('set number of pre-payment periods', async () => {
                  await subscriptionsOwner.setPrePaymentPeriods(periods + 1)
                })

                itHandleSubscriptionsSuccessfully(previousPaidPeriods, previousDelayedPeriods, expectedDelayedPeriods)
              })

              context('when the number of pre-payment periods is reached', () => {
                beforeEach('set number of pre-payment periods', async () => {
                  await subscriptionsOwner.setPrePaymentPeriods(periods)
                })

                itHandleSubscriptionsSuccessfully(previousPaidPeriods, previousDelayedPeriods, expectedDelayedPeriods)
              })

              context('when the number of pre-payment periods is exceeded', () => {
                beforeEach('set number of pre-payment periods', async () => {
                  await subscriptionsOwner.setPrePaymentPeriods(periods - 1)
                })

                it('reverts', async () => {
                  await assertRevert(subscriptions.payFees(subscriber, periods, { from }), 'SUB_TOO_MANY_PERIODS')
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
                const previousDelayedPeriods = 0
                const expectedDelayedPeriods = 0

                beforeEach('subscribe', async () => {
                  await subscriptions.payFees(subscriber, prePaidPeriods, { from })
                })

                context('when the number of pre-payment periods is not reached', () => {
                  beforeEach('set number of pre-payment periods', async () => {
                    await subscriptionsOwner.setPrePaymentPeriods(periods + previousPaidPeriods + 1)
                  })

                  itHandleSubscriptionsSuccessfully(previousPaidPeriods, previousDelayedPeriods, expectedDelayedPeriods)
                })

                context('when the number of pre-payment periods is reached', () => {
                  beforeEach('set number of pre-payment periods', async () => {
                    await subscriptionsOwner.setPrePaymentPeriods(periods + previousPaidPeriods)
                  })

                  itHandleSubscriptionsSuccessfully(previousPaidPeriods, previousDelayedPeriods, expectedDelayedPeriods)
                })

                context('when the number of pre-payment periods is exceeded', () => {
                  beforeEach('set number of pre-payment periods', async () => {
                    await subscriptionsOwner.setPrePaymentPeriods(periods + previousPaidPeriods - 1)
                  })

                  it('reverts', async () => {
                    await assertRevert(subscriptions.payFees(subscriber, periods, { from }), 'SUB_TOO_MANY_PERIODS')
                  })
                })
              })

              context('when the subscriber is up-to-date and has not pre-paid any periods', () => {
                const previousPaidPeriods = 1
                const previousDelayedPeriods = 0
                const expectedDelayedPeriods = 0

                context('when the number of pre-payment periods is not reached', () => {
                  beforeEach('set number of pre-payment periods', async () => {
                    await subscriptionsOwner.setPrePaymentPeriods(periods + previousPaidPeriods + 1)
                  })

                  itHandleSubscriptionsSuccessfully(previousPaidPeriods, previousDelayedPeriods, expectedDelayedPeriods)
                })

                context('when the number of pre-payment periods is reached', () => {
                  beforeEach('set number of pre-payment periods', async () => {
                    await subscriptionsOwner.setPrePaymentPeriods(periods + previousPaidPeriods)
                  })

                  itHandleSubscriptionsSuccessfully(previousPaidPeriods, previousDelayedPeriods, expectedDelayedPeriods)
                })

                context('when the number of pre-payment periods is exceeded', () => {
                  beforeEach('set number of pre-payment periods', async () => {
                    await subscriptionsOwner.setPrePaymentPeriods(periods + previousPaidPeriods - 1)
                  })

                  it('reverts', async () => {
                    await assertRevert(subscriptions.payFees(subscriber, periods, { from }), 'SUB_TOO_MANY_PERIODS')
                  })
                })
              })

              context('when the subscriber has some delayed periods', () => {
                const previousPaidPeriods = 0

                context('when the given number of periods is lower than the number of delayed periods', () => {
                  const previousDelayedPeriods = periods + 2
                  const expectedDelayedPeriods = 2

                  beforeEach('advance periods', async () => {
                    await subscriptionsOwner.mockIncreaseTerms(PERIOD_DURATION * (previousDelayedPeriods + 1))
                  })

                  itHandleSubscriptionsSuccessfully(previousPaidPeriods, previousDelayedPeriods, expectedDelayedPeriods)
                })

                context('when the given number of periods is equal to the number of delayed periods', () => {
                  const previousDelayedPeriods = periods
                  const expectedDelayedPeriods = 0

                  beforeEach('advance periods', async () => {
                    await subscriptionsOwner.mockIncreaseTerms(PERIOD_DURATION * (previousDelayedPeriods + 1))
                  })

                  itHandleSubscriptionsSuccessfully(previousPaidPeriods, previousDelayedPeriods, expectedDelayedPeriods)
                })

                context('when the given number of periods is greater than the number of delayed periods', () => {
                  const previousDelayedPeriods = periods - 2
                  const expectedDelayedPeriods = 0

                  beforeEach('advance periods', async () => {
                    await subscriptionsOwner.mockIncreaseTerms(PERIOD_DURATION * (previousDelayedPeriods + 1))
                  })

                  context('when the number of pre-payment periods is not reached', () => {
                    beforeEach('set number of pre-payment periods', async () => {
                      await subscriptionsOwner.setPrePaymentPeriods(periods - previousDelayedPeriods + 1)
                    })

                    itHandleSubscriptionsSuccessfully(previousPaidPeriods, previousDelayedPeriods, expectedDelayedPeriods)
                  })

                  context('when the number of pre-payment periods is reached', () => {
                    beforeEach('set number of pre-payment periods', async () => {
                      await subscriptionsOwner.setPrePaymentPeriods(periods - previousDelayedPeriods)
                    })

                    itHandleSubscriptionsSuccessfully(previousPaidPeriods, previousDelayedPeriods, expectedDelayedPeriods)
                  })

                  context('when the number of pre-payment periods is exceeded', () => {
                    beforeEach('set number of pre-payment periods', async () => {
                      await subscriptionsOwner.setPrePaymentPeriods(periods - previousDelayedPeriods - 1)
                    })

                    it('reverts', async () => {
                      await assertRevert(subscriptions.payFees(subscriber, periods, { from }), 'SUB_TOO_MANY_PERIODS')
                    })
                  })
                })
              })
            })
          })

          context('when the sender does not have enough balance', () => {
            it('reverts', async () => {
              await assertRevert(subscriptions.payFees(subscriber, periods), 'SUB_TOKEN_TRANSFER_FAILED')
            })
          })
        })
      })

      context('when the number of periods is zero', () => {
        const periods = 0

        it('reverts', async () => {
          await assertRevert(subscriptions.payFees(subscriber, periods), 'SUB_PAY_ZERO_PERIODS')
        })
      })
    })

    context('when the subscriptions is not initialized', () => {
      const periods = 10

      it('reverts', async () => {
        await assertRevert(subscriptions.payFees(subscriber, periods), '')
      })
    })
  })

  describe('transferFeesToGovernor', () => {
    context('when the subscriptions was already initialized', () => {
      beforeEach('initialize subscriptions', async () => {
        await subscriptions.init(subscriptionsOwner.address, jurorsRegistry.address, PERIOD_DURATION, feeToken.address, FEE_AMOUNT, PREPAYMENT_PERIODS, LATE_PAYMENT_PENALTY_PCT, GOVERNOR_SHARE_PCT)
      })

      context('when there are no accumulated fees', () => {
        it('reverts', async () => {
          await assertRevert(subscriptions.transferFeesToGovernor(), 'SUB_ZERO_TRANSFER')
        })
      })

      context('when there are some accumulated fees', () => {
        beforeEach('pay many subscriptions', async () => {
          const balance = FEE_AMOUNT.mul(bn(1000000))
          await feeToken.generateTokens(payer, balance)
          await feeToken.approve(subscriptions.address, balance, { from: payer })

          await subscriptionsOwner.mockSetTerm(PERIOD_DURATION)
          await subscriptions.payFees(subscriber, 5, { from: payer })
          await subscriptions.payFees(anotherSubscriber, 2, { from: payer })

          await subscriptionsOwner.mockIncreaseTerms(PERIOD_DURATION * 3)
          await subscriptions.payFees(subscriber, 1, { from: payer })
          await subscriptions.payFees(anotherSubscriber, 4, { from: payer })
        })

        it('transfers the fees to the governor', async () => {
          const previousAccumulatedFees = await subscriptions.accumulatedGovernorFees()
          const previousGovernorBalance = await feeToken.balanceOf(subscriptionsOwner.address)

          await subscriptions.transferFeesToGovernor()

          const currentGovernorBalance = await feeToken.balanceOf(subscriptionsOwner.address)
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

    context('when the subscriptions is not initialized', () => {
      it('reverts', async () => {
        await assertRevert(subscriptions.transferFeesToGovernor(), 'SUB_ZERO_TRANSFER')
      })
    })
  })

  describe('isUpToDate', () => {
    context('when the subscriptions was already initialized', () => {
      beforeEach('initialize subscriptions', async () => {
        await subscriptions.init(subscriptionsOwner.address, jurorsRegistry.address, PERIOD_DURATION, feeToken.address, FEE_AMOUNT, PREPAYMENT_PERIODS, LATE_PAYMENT_PENALTY_PCT, GOVERNOR_SHARE_PCT)
      })

      context('when the subscriber was already subscribed', () => {
        const paidPeriods = bn(1)
        const paidAmount = FEE_AMOUNT

        beforeEach('subscribe', async () => {
          await subscriptionsOwner.mockSetTerm(PERIOD_DURATION)
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
            await subscriptionsOwner.mockIncreaseTerms(PERIOD_DURATION)
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

    context('when the subscriptions is not initialized', () => {
      it('returns false', async () => {
        assert.isFalse(await subscriptions.isUpToDate(subscriber))
      })
    })
  })
})
