const { bn, bigExp } = require('../helpers/numbers')
const { assertRevert } = require('../helpers/assertThrow')
const { assertAmountOfEvents, assertEvent } = require('../helpers/assertEvent')

const CourtSubscriptions = artifacts.require('CourtSubscriptions')
const SubscriptionsOwner = artifacts.require('SubscriptionsOwnerMock')
const JurorsRegistry = artifacts.require('JurorsRegistry')
const ERC20 = artifacts.require('ERC20Mock')

contract('CourtSubscriptions', ([_, payer, subscriber]) => {
  let subscriptions, subscriptionsOwner, jurorsRegistry, feeToken

  const PCT_BASE = bn(10000)
  const FEE_AMOUNT = bigExp(10, 18)
  const PREPAYMENT_PERIODS = 15
  const RESUME_PRE_PAID_PERIODS = 10
  const PERIOD_DURATION = 24 * 30           // 30 days, assuming terms are 1h
  const GOVERNOR_SHARE_PCT = bn(100)        // 100‱ = 1%
  const LATE_PAYMENT_PENALTY_PCT = bn(1000) // 1000‱ = 10%

  const penaltyFees = (n, pct) => n.mul(pct.add(PCT_BASE)).div(PCT_BASE)

  beforeEach('create base contracts', async () => {
    subscriptions = await CourtSubscriptions.new()
    subscriptionsOwner = await SubscriptionsOwner.new(subscriptions.address)
    jurorsRegistry = await JurorsRegistry.new()
    feeToken = await ERC20.new('Subscriptions Fee Token', 'SFT', 18)
  })

  describe('pause/resume', () => {
    beforeEach('initialize subscriptions', async () => {
      await subscriptions.init(subscriptionsOwner.address, jurorsRegistry.address, PERIOD_DURATION, feeToken.address, FEE_AMOUNT, PREPAYMENT_PERIODS, RESUME_PRE_PAID_PERIODS, LATE_PAYMENT_PENALTY_PCT, GOVERNOR_SHARE_PCT)
      await subscriptionsOwner.mockSetTerm(PERIOD_DURATION)
    })

    beforeEach('mint fee tokens and subscribe', async () => {
      const balance = FEE_AMOUNT.mul(bn(10000))
      await feeToken.generateTokens(payer, balance)
      await feeToken.approve(subscriptions.address, balance, { from: payer })
      await subscriptions.payFees(subscriber, 1, { from: payer })
    })

    const itIsUpToDate = (resumePaidPeriods) => {
      it('is up-to-date', async () => {
        await subscriptions.payFees(subscriber, resumePaidPeriods, { from: payer })

        assert.isTrue(await subscriptions.isUpToDate(subscriber), 'subscriber should be up-to-date')
      })

      it('is not paused', async () => {
        await subscriptions.payFees(subscriber, resumePaidPeriods, { from: payer })
        const { subscribed, paused, previousDelayedPeriods } = await subscriptions.getSubscriber(subscriber)

        assert.isTrue(subscribed, 'subscriber should be subscribed')
        assert.isFalse(paused, 'subscriber should not be paused')
        assert.equal(previousDelayedPeriods.toString(), 0, 'previous delayed periods does not match')
      })
    }

    const itComputesLastAndDelayedPeriodsCorrectly = (resumePaidPeriods, expectedMovedPeriods, expectedDelayedPeriods) => {
      it('computes last period id correctly', async () => {
        const currentPeriodId = (await subscriptions.getCurrentPeriodId()).toNumber()
        const expectedLastPeriodId = currentPeriodId + expectedMovedPeriods

        const { newLastPeriodId } = await subscriptions.getPayFeesDetails(subscriber, resumePaidPeriods)
        assert.equal(newLastPeriodId.toString(), expectedLastPeriodId, 'new last period id does not match')

        await subscriptions.payFees(subscriber, resumePaidPeriods, { from: payer })
        const { lastPaymentPeriodId } = await subscriptions.getSubscriber(subscriber)
        assert.equal(lastPaymentPeriodId.toString(), expectedLastPeriodId, 'new last period id does not match')
      })

      it('computes number of delayed periods correctly', async () => {
        const previousDelayedPeriods = await subscriptions.getDelayedPeriods(subscriber)

        await subscriptions.payFees(subscriber, resumePaidPeriods, { from: payer })

        const currentDelayedPeriods = await subscriptions.getDelayedPeriods(subscriber)
        assert.equal(currentDelayedPeriods.toString(), previousDelayedPeriods.sub(bn(expectedDelayedPeriods)).toString(), 'number of delayed periods does not match')
      })
    }

    const itPaysNormalFees = (resumePaidPeriods, expectedRegularPeriods, expectedDelayedPeriods) => {
      const expectedRegularFees = FEE_AMOUNT.mul(bn(expectedRegularPeriods))
      const expectedDelayedFees = penaltyFees(FEE_AMOUNT.mul(bn(expectedDelayedPeriods)), LATE_PAYMENT_PENALTY_PCT)
      const expectedTotalPaidFees = expectedRegularFees.add(expectedDelayedFees)
      const expectedGovernorFees = GOVERNOR_SHARE_PCT.mul(expectedTotalPaidFees).div(PCT_BASE)

      it('pays the requested periods subscriptions', async () => {
        const previousPayerBalance = await feeToken.balanceOf(payer)
        const previousSubscriptionsBalance = await feeToken.balanceOf(subscriptions.address)

        const { amountToPay } = await subscriptions.getPayFeesDetails(subscriber, resumePaidPeriods)
        assert.equal(amountToPay.toString(), expectedTotalPaidFees.toString(), 'amount to be paid does not match')

        await subscriptions.payFees(subscriber, resumePaidPeriods, { from: payer })

        const currentSubscriptionsBalance = await feeToken.balanceOf(subscriptions.address)
        assert.equal(currentSubscriptionsBalance.toString(), previousSubscriptionsBalance.add(expectedTotalPaidFees).toString(), 'subscriptions balances do not match')

        const currentPayerBalance = await feeToken.balanceOf(payer)
        assert.equal(currentPayerBalance.toString(), previousPayerBalance.sub(expectedTotalPaidFees).toString(), 'payer balances do not match')
      })

      it('pays the governor fees', async () => {
        const { newLastPeriodId } = await subscriptions.getPayFeesDetails(subscriber, resumePaidPeriods)
        const previousGovernorFees = await subscriptions.accumulatedGovernorFees()

        const receipt = await subscriptions.payFees(subscriber, resumePaidPeriods, { from: payer })

        const currentGovernorFees = await subscriptions.accumulatedGovernorFees()
        assert.equal(currentGovernorFees.toString(), previousGovernorFees.add(expectedGovernorFees).toString(), 'governor fees do not match')

        const expectedCollectedFees = expectedTotalPaidFees.sub(expectedGovernorFees)
        assertAmountOfEvents(receipt, 'FeesPaid')
        assertEvent(receipt, 'FeesPaid', { subscriber, periods: resumePaidPeriods, newLastPeriodId, collectedFees: expectedCollectedFees, governorFee: expectedGovernorFees })
      })
    }

    const itPaysResumingFees = (resumePaidPeriods, expectedRegularPeriods, expectedDelayedPeriods) => {
      const expectedRegularFees = FEE_AMOUNT.mul(bn(expectedRegularPeriods))
      const expectedResumeFees = FEE_AMOUNT.mul(bn(RESUME_PRE_PAID_PERIODS))
      const expectedDelayedFees = penaltyFees(FEE_AMOUNT.mul(bn(expectedDelayedPeriods)), LATE_PAYMENT_PENALTY_PCT)
      const expectedTotalPaidFees = expectedRegularFees.add(expectedDelayedFees).add(expectedResumeFees)
      const expectedGovernorFees = GOVERNOR_SHARE_PCT.mul(expectedTotalPaidFees).div(PCT_BASE)

      it('pays the requested periods subscriptions', async () => {
        const previousPayerBalance = await feeToken.balanceOf(payer)
        const previousSubscriptionsBalance = await feeToken.balanceOf(subscriptions.address)

        const { amountToPay } = await subscriptions.getPayFeesDetails(subscriber, resumePaidPeriods)
        assert.equal(amountToPay.toString(), expectedTotalPaidFees.toString(), 'amount to be paid does not match')

        await subscriptions.payFees(subscriber, resumePaidPeriods, { from: payer })

        const currentSubscriptionsBalance = await feeToken.balanceOf(subscriptions.address)
        assert.equal(currentSubscriptionsBalance.toString(), previousSubscriptionsBalance.add(expectedTotalPaidFees).toString(), 'subscriptions balances do not match')

        const currentPayerBalance = await feeToken.balanceOf(payer)
        assert.equal(currentPayerBalance.toString(), previousPayerBalance.sub(expectedTotalPaidFees).toString(), 'payer balances do not match')
      })

      it('pays the governor fees', async () => {
        const { newLastPeriodId } = await subscriptions.getPayFeesDetails(subscriber, resumePaidPeriods)
        const previousGovernorFees = await subscriptions.accumulatedGovernorFees()

        const receipt = await subscriptions.payFees(subscriber, resumePaidPeriods, { from: payer })

        const currentGovernorFees = await subscriptions.accumulatedGovernorFees()
        assert.equal(currentGovernorFees.toString(), previousGovernorFees.add(expectedGovernorFees).toString(), 'governor fees do not match')

        const expectedCollectedFees = expectedTotalPaidFees.sub(expectedGovernorFees)
        assertAmountOfEvents(receipt, 'FeesPaid')
        assertEvent(receipt, 'FeesPaid', { subscriber, periods: resumePaidPeriods, newLastPeriodId, collectedFees: expectedCollectedFees, governorFee: expectedGovernorFees })
      })
    }

    context('when the subscriber is up-to-date and has paid some periods in advance', () => {
      const prePaidPeriods = 3

      beforeEach('pay and pause', async () => {
        await subscriptions.payFees(subscriber, prePaidPeriods, { from: payer })
        await subscriptions.pause({ from: subscriber })

        const { paused, previousDelayedPeriods } = await subscriptions.getSubscriber(subscriber)
        assert.isTrue(paused, 'subscriber should be paused')
        assert.equal(previousDelayedPeriods.toString(), 0, 'delayed periods does not match')
      })

      context('when the current period has not passed', () => {
        const resumePaidPeriods = 5
        const expectedMovedPeriods = resumePaidPeriods + prePaidPeriods
        const expectedRegularPeriods = resumePaidPeriods
        const expectedDelayedPeriods = 0

        itIsUpToDate(resumePaidPeriods)
        itComputesLastAndDelayedPeriodsCorrectly(resumePaidPeriods, expectedMovedPeriods, expectedDelayedPeriods)
        itPaysNormalFees(resumePaidPeriods, expectedRegularPeriods, expectedDelayedPeriods)
      })

      context('when the current period has passed', () => {
        const resumePaidPeriods = 5
        const expectedMovedPeriods = resumePaidPeriods + prePaidPeriods - 1
        const expectedRegularPeriods = resumePaidPeriods
        const expectedDelayedPeriods = 0

        beforeEach('advance 1 period', async () => {
          await subscriptionsOwner.mockIncreaseTerms(PERIOD_DURATION)
        })

        itIsUpToDate(resumePaidPeriods)
        itComputesLastAndDelayedPeriodsCorrectly(resumePaidPeriods, expectedMovedPeriods, expectedDelayedPeriods)
        itPaysNormalFees(resumePaidPeriods, expectedRegularPeriods, expectedDelayedPeriods)
      })

      context('when the current period has passed up-to the pre-paid periods', () => {
        const resumePaidPeriods = 5
        const expectedMovedPeriods = resumePaidPeriods
        const expectedRegularPeriods = resumePaidPeriods
        const expectedDelayedPeriods = 0

        beforeEach('advance up-to the pre-paid periods', async () => {
          await subscriptionsOwner.mockIncreaseTerms(PERIOD_DURATION * prePaidPeriods)
        })

        itIsUpToDate(resumePaidPeriods)
        itComputesLastAndDelayedPeriodsCorrectly(resumePaidPeriods, expectedMovedPeriods, expectedDelayedPeriods)
        itPaysNormalFees(resumePaidPeriods, expectedRegularPeriods, expectedDelayedPeriods)
      })

      context('when the current period has passed the pre-paid periods by one period', () => {
        const overduePeriods = 1
        const resumePaidPeriods = 5
        const expectedMovedPeriods = resumePaidPeriods - 1
        const expectedRegularPeriods = resumePaidPeriods
        const expectedDelayedPeriods = 0

        beforeEach('pass the pre-paid periods', async () => {
          await subscriptionsOwner.mockIncreaseTerms(PERIOD_DURATION * (prePaidPeriods + overduePeriods))
        })

        itIsUpToDate(resumePaidPeriods)
        itComputesLastAndDelayedPeriodsCorrectly(resumePaidPeriods, expectedMovedPeriods, expectedDelayedPeriods)
        itPaysNormalFees(resumePaidPeriods, expectedRegularPeriods, expectedDelayedPeriods)
      })

      context('when the current period has passed the pre-paid periods by more than one period', () => {
        const overduePeriods = 2

        beforeEach('pass the pre-paid periods', async () => {
          await subscriptionsOwner.mockIncreaseTerms(PERIOD_DURATION * (prePaidPeriods + overduePeriods))
        })

        context('when paying less than the corresponding pre-paid periods', () => {
          const resumePaidPeriods = RESUME_PRE_PAID_PERIODS - 1

          it('reverts', async () => {
            await assertRevert(subscriptions.payFees(subscriber, resumePaidPeriods, { from: payer }), 'CS_LOW_RESUME_PERIODS_PAYMENT')
          })
        })

        context('when paying the corresponding pre-paid periods', () => {
          const resumePaidPeriods = RESUME_PRE_PAID_PERIODS
          const expectedMovedPeriods = resumePaidPeriods - 1
          const expectedRegularPeriods = 0
          const expectedDelayedPeriods = 0

          itIsUpToDate(resumePaidPeriods)
          itComputesLastAndDelayedPeriodsCorrectly(resumePaidPeriods, expectedMovedPeriods, expectedDelayedPeriods)
          itPaysResumingFees(resumePaidPeriods, expectedRegularPeriods, expectedDelayedPeriods)
        })

        context('when paying the more than the corresponding pre-paid periods', () => {
          const resumePaidPeriods = RESUME_PRE_PAID_PERIODS + 1
          const expectedMovedPeriods = resumePaidPeriods - 1
          const expectedRegularPeriods = 1
          const expectedDelayedPeriods = 0

          itIsUpToDate(resumePaidPeriods)
          itComputesLastAndDelayedPeriodsCorrectly(resumePaidPeriods, expectedMovedPeriods, expectedDelayedPeriods)
          itPaysResumingFees(resumePaidPeriods, expectedRegularPeriods, expectedDelayedPeriods)
        })
      })
    })

    context('when the subscriber is up-to-date and has not paid periods in advance', () => {
      beforeEach('pause', async () => {
        await subscriptions.pause({ from: subscriber })

        const { paused, previousDelayedPeriods } = await subscriptions.getSubscriber(subscriber)
        assert.isTrue(paused, 'subscriber should be paused')
        assert.equal(previousDelayedPeriods.toString(), 0, 'delayed periods does not match')
      })

      context('when the current period has not passed', () => {
        const resumePaidPeriods = 5
        const expectedMovedPeriods = resumePaidPeriods
        const expectedRegularPeriods = resumePaidPeriods
        const expectedDelayedPeriods = 0

        itIsUpToDate(resumePaidPeriods)
        itComputesLastAndDelayedPeriodsCorrectly(resumePaidPeriods, expectedMovedPeriods, expectedDelayedPeriods)
        itPaysNormalFees(resumePaidPeriods, expectedRegularPeriods, expectedDelayedPeriods)
      })

      context('when the current period has passed', () => {
        const overduePeriods = 1
        const resumePaidPeriods = 5
        const expectedMovedPeriods = resumePaidPeriods - 1
        const expectedRegularPeriods = resumePaidPeriods
        const expectedDelayedPeriods = 0

        beforeEach('advance 1 period', async () => {
          await subscriptionsOwner.mockIncreaseTerms(PERIOD_DURATION * overduePeriods)
        })

        itIsUpToDate(resumePaidPeriods)
        itComputesLastAndDelayedPeriodsCorrectly(resumePaidPeriods, expectedMovedPeriods, expectedDelayedPeriods)
        itPaysNormalFees(resumePaidPeriods, expectedRegularPeriods, expectedDelayedPeriods)
      })

      context('when the current period has passed by more than one period', () => {
        const overduePeriods = 2

        beforeEach('pass the pre-paid periods', async () => {
          await subscriptionsOwner.mockIncreaseTerms(PERIOD_DURATION * overduePeriods)
        })

        context('when paying less than the corresponding pre-paid periods', () => {
          const resumePaidPeriods = RESUME_PRE_PAID_PERIODS - 1

          it('reverts', async () => {
            await assertRevert(subscriptions.payFees(subscriber, resumePaidPeriods, { from: payer }), 'CS_LOW_RESUME_PERIODS_PAYMENT')
          })
        })

        context('when paying the corresponding pre-paid periods', () => {
          const resumePaidPeriods = RESUME_PRE_PAID_PERIODS
          const expectedMovedPeriods = resumePaidPeriods - 1
          const expectedRegularPeriods = 0
          const expectedDelayedPeriods = 0

          itIsUpToDate(resumePaidPeriods)
          itComputesLastAndDelayedPeriodsCorrectly(resumePaidPeriods, expectedMovedPeriods, expectedDelayedPeriods)
          itPaysResumingFees(resumePaidPeriods, expectedRegularPeriods, expectedDelayedPeriods)
        })

        context('when paying the more than the corresponding pre-paid periods', () => {
          const resumePaidPeriods = RESUME_PRE_PAID_PERIODS + 1
          const expectedMovedPeriods = resumePaidPeriods - 1
          const expectedRegularPeriods = 1
          const expectedDelayedPeriods = 0

          itIsUpToDate(resumePaidPeriods)
          itComputesLastAndDelayedPeriodsCorrectly(resumePaidPeriods, expectedMovedPeriods, expectedDelayedPeriods)
          itPaysResumingFees(resumePaidPeriods, expectedRegularPeriods, expectedDelayedPeriods)
        })
      })
    })

    context('when the subscriber has one overdue period', () => {
      const overduePeriods = 1
      const resumePaidPeriods = 5
      const expectedMovedPeriods = resumePaidPeriods - 1
      const expectedRegularPeriods = resumePaidPeriods
      const expectedDelayedPeriods = 0

      beforeEach('advance overdue periods and pause', async () => {
        await subscriptionsOwner.mockIncreaseTerms(PERIOD_DURATION * overduePeriods)
        await subscriptions.pause({ from: subscriber })

        const { paused, previousDelayedPeriods } = await subscriptions.getSubscriber(subscriber)
        assert.isTrue(paused, 'subscriber should be paused')
        assert.equal(previousDelayedPeriods.toString(), 0, 'delayed periods does not match')
      })

      itIsUpToDate(resumePaidPeriods)
      itComputesLastAndDelayedPeriodsCorrectly(resumePaidPeriods, expectedMovedPeriods, expectedDelayedPeriods)
      itPaysNormalFees(resumePaidPeriods, expectedRegularPeriods, expectedDelayedPeriods)
    })

    context('when the subscriber has more than one overdue period', () => {
      const delayedPeriods = 2
      const overduePeriods = delayedPeriods + 1

      beforeEach('advance overdue periods and pause', async () => {
        await subscriptionsOwner.mockIncreaseTerms(PERIOD_DURATION * overduePeriods)
        await subscriptions.pause({ from: subscriber })

        const { paused, previousDelayedPeriods } = await subscriptions.getSubscriber(subscriber)
        assert.isTrue(paused, 'subscriber should be paused')
        assert.equal(previousDelayedPeriods.toString(), delayedPeriods, 'delayed periods does not match')
      })

      context('when paying less than the corresponding pre-paid periods', () => {
        const resumePaidPeriods = RESUME_PRE_PAID_PERIODS - 1

        it('reverts', async () => {
          await assertRevert(subscriptions.payFees(subscriber, resumePaidPeriods, { from: payer }), 'CS_LOW_RESUME_PERIODS_PAYMENT')
        })
      })

      context('when paying the corresponding pre-paid periods but not the delayed periods', () => {
        const resumePaidPeriods = RESUME_PRE_PAID_PERIODS

        it('reverts', async () => {
          await assertRevert(subscriptions.payFees(subscriber, resumePaidPeriods, { from: payer }), 'CS_LOW_RESUME_PERIODS_PAYMENT')
        })
      })

      context('when paying the corresponding pre-paid and delayed periods', () => {
        const resumePaidPeriods = RESUME_PRE_PAID_PERIODS + delayedPeriods
        const expectedMovedPeriods = resumePaidPeriods - 1
        const expectedRegularPeriods = 0
        const expectedDelayedPeriods = delayedPeriods

        itIsUpToDate(resumePaidPeriods)
        itComputesLastAndDelayedPeriodsCorrectly(resumePaidPeriods, expectedMovedPeriods, expectedDelayedPeriods)
        itPaysResumingFees(resumePaidPeriods, expectedRegularPeriods, expectedDelayedPeriods)
      })

      context('when paying the more than the corresponding pre-paid and delayed periods', () => {
        const resumePaidPeriods = RESUME_PRE_PAID_PERIODS + delayedPeriods + 1
        const expectedMovedPeriods = resumePaidPeriods - 1
        const expectedRegularPeriods = 1
        const expectedDelayedPeriods = delayedPeriods

        itIsUpToDate(resumePaidPeriods)
        itComputesLastAndDelayedPeriodsCorrectly(resumePaidPeriods, expectedMovedPeriods, expectedDelayedPeriods)
        itPaysResumingFees(resumePaidPeriods, expectedRegularPeriods, expectedDelayedPeriods)
      })
    })
  })
})
