const { bn, bigExp } = require('../helpers/numbers')
const { assertRevert } = require('../helpers/assertThrow')

const CourtSubscriptions = artifacts.require('CourtSubscriptions')
const SubscriptionsOwner = artifacts.require('SubscriptionsOwnerMock')
const JurorsRegistry = artifacts.require('JurorsRegistry')
const ERC20 = artifacts.require('ERC20Mock')

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

contract('CourtSubscriptions', ([_, something]) => {
  let subscriptions, subscriptionsOwner, jurorsRegistry, feeToken

  const FEE_AMOUNT = bigExp(10, 18)
  const PREPAYMENT_PERIODS = 12
  const RESUME_PRE_PAID_PERIODS = 10
  const PERIOD_DURATION = 24 * 30           // 30 days, assuming terms are 1h
  const GOVERNOR_SHARE_PCT = bn(100)        // 100‱ = 1%
  const LATE_PAYMENT_PENALTY_PCT = bn(1000) // 1000‱ = 10%

  beforeEach('create base contracts', async () => {
    subscriptions = await CourtSubscriptions.new()
    subscriptionsOwner = await SubscriptionsOwner.new(subscriptions.address)
    jurorsRegistry = await JurorsRegistry.new()
    feeToken = await ERC20.new('Subscriptions Fee Token', 'SFT', 18)
  })

  describe('init', () => {
    context('when the subscriptions is not initialized', () => {
      context('when the initialization succeeds', () => {
        it('is initialized', async () => {
          await subscriptions.init(subscriptionsOwner.address, jurorsRegistry.address, PERIOD_DURATION, feeToken.address, FEE_AMOUNT, PREPAYMENT_PERIODS, RESUME_PRE_PAID_PERIODS, LATE_PAYMENT_PENALTY_PCT, GOVERNOR_SHARE_PCT)

          assert.isTrue(await subscriptions.hasInitialized(), 'subscriptions is not initialized')
        })

        it('sets initial config correctly', async () => {
          await subscriptions.init(subscriptionsOwner.address, jurorsRegistry.address, PERIOD_DURATION, feeToken.address, FEE_AMOUNT, PREPAYMENT_PERIODS, RESUME_PRE_PAID_PERIODS, LATE_PAYMENT_PENALTY_PCT, GOVERNOR_SHARE_PCT)

          assert.equal(await subscriptions.getOwner(), subscriptionsOwner.address, 'subscriptions owner does not match')
          assert.equal(await subscriptions.currentFeeToken(), feeToken.address, 'fee token does not match')
          assert.equal((await subscriptions.currentFeeAmount()).toString(), FEE_AMOUNT.toString(), 'fee amount does not match')
          assert.equal((await subscriptions.prePaymentPeriods()).toString(), PREPAYMENT_PERIODS.toString(), 'pre payment periods does not match')
          assert.equal((await subscriptions.latePaymentPenaltyPct()).toString(), LATE_PAYMENT_PENALTY_PCT.toString(), 'late payments penalty pct does not match')
          assert.equal((await subscriptions.governorSharePct()).toString(), GOVERNOR_SHARE_PCT.toString(), 'governor share pct does not match')

          // TODO: implement
          // assert.equal(await subscriptions.jurorsRegistry(), jurorsRegistry.address, 'subscriptions owner does not match')
          // assert.equal(await subscriptions.periodDuration(), PERIOD_DURATION, 'subscriptions owner does not match')
        })
      })

      context('initialization fails', () => {
        // TODO: currently, we are initializing all the court dependencies from the court constructor
        context.skip('when the given owner is the zero address', () => {
          const owner = ZERO_ADDRESS

          it('reverts', async () => {
            await assertRevert(subscriptions.init(owner, jurorsRegistry.address, PERIOD_DURATION, feeToken.address, FEE_AMOUNT, PREPAYMENT_PERIODS, RESUME_PRE_PAID_PERIODS, LATE_PAYMENT_PENALTY_PCT, GOVERNOR_SHARE_PCT), 'CS_FEE_TOKEN_NOT_CONTRACT')
          })
        })

        // TODO: currently, we are initializing all the court dependencies from the court constructor
        context.skip('when the given owner is not a contract address', () => {
          const owner = something

          it('reverts', async () => {
            await assertRevert(subscriptions.init(owner, jurorsRegistry.address, PERIOD_DURATION, feeToken.address, FEE_AMOUNT, PREPAYMENT_PERIODS, RESUME_PRE_PAID_PERIODS, LATE_PAYMENT_PENALTY_PCT, GOVERNOR_SHARE_PCT), 'CS_FEE_TOKEN_NOT_CONTRACT')
          })
        })

        context('when the given jurors registry is the zero address', () => {
          const jurorsRegistryAddress = ZERO_ADDRESS

          it('reverts', async () => {
            await assertRevert(subscriptions.init(subscriptionsOwner.address, jurorsRegistryAddress, PERIOD_DURATION, feeToken.address, FEE_AMOUNT, PREPAYMENT_PERIODS, RESUME_PRE_PAID_PERIODS, LATE_PAYMENT_PENALTY_PCT, GOVERNOR_SHARE_PCT), 'CS_REGISTRY_NOT_CONTRACT')
          })
        })

        context('when the given owner is not a contract address', () => {
          const jurorsRegistryAddress = something

          it('reverts', async () => {
            await assertRevert(subscriptions.init(subscriptionsOwner.address, jurorsRegistryAddress, PERIOD_DURATION, feeToken.address, FEE_AMOUNT, PREPAYMENT_PERIODS, RESUME_PRE_PAID_PERIODS, LATE_PAYMENT_PENALTY_PCT, GOVERNOR_SHARE_PCT), 'CS_REGISTRY_NOT_CONTRACT')
          })
        })

        context('when the given period duration is zero', () => {
          const periodDuration = 0

          it('reverts', async () => {
            await assertRevert(subscriptions.init(subscriptionsOwner.address, jurorsRegistry.address, periodDuration, feeToken.address, FEE_AMOUNT, PREPAYMENT_PERIODS, RESUME_PRE_PAID_PERIODS, LATE_PAYMENT_PENALTY_PCT, GOVERNOR_SHARE_PCT), 'CS_PERIOD_DURATION_ZERO')
          })
        })

        context('when the given fee token address is the zero address', () => {
          const feeTokenAddress = ZERO_ADDRESS

          it('reverts', async () => {
            await assertRevert(subscriptions.init(subscriptionsOwner.address, jurorsRegistry.address, PERIOD_DURATION, feeTokenAddress, FEE_AMOUNT, PREPAYMENT_PERIODS, RESUME_PRE_PAID_PERIODS, LATE_PAYMENT_PENALTY_PCT, GOVERNOR_SHARE_PCT), 'CS_FEE_TOKEN_NOT_CONTRACT')
          })
        })

        context('when the given fee token address is not a contract address', () => {
          const feeTokenAddress = something

          it('reverts', async () => {
            await assertRevert(subscriptions.init(subscriptionsOwner.address, jurorsRegistry.address, PERIOD_DURATION, feeTokenAddress, FEE_AMOUNT, PREPAYMENT_PERIODS, RESUME_PRE_PAID_PERIODS, LATE_PAYMENT_PENALTY_PCT, GOVERNOR_SHARE_PCT), 'CS_FEE_TOKEN_NOT_CONTRACT')
          })
        })

        context('when the given fee amount is zero', () => {
          const feeAmount = 0

          it('reverts', async () => {
            await assertRevert(subscriptions.init(subscriptionsOwner.address, jurorsRegistry.address, PERIOD_DURATION, feeToken.address, feeAmount, PREPAYMENT_PERIODS, RESUME_PRE_PAID_PERIODS, LATE_PAYMENT_PENALTY_PCT, GOVERNOR_SHARE_PCT), 'CS_FEE_AMOUNT_ZERO')
          })
        })

        context('when the given pre payment periods number is zero', () => {
          const prePaymentPeriods = 0

          it('reverts', async () => {
            await assertRevert(subscriptions.init(subscriptionsOwner.address, jurorsRegistry.address, PERIOD_DURATION, feeToken.address, FEE_AMOUNT, prePaymentPeriods, RESUME_PRE_PAID_PERIODS, LATE_PAYMENT_PENALTY_PCT, GOVERNOR_SHARE_PCT), 'CS_PREPAYMENT_PERIODS_ZERO')
          })
        })

        context('when the given governor share is above 100%', () => {
          const governorSharePct = bn(10001)

          it('reverts', async () => {
            await assertRevert(subscriptions.init(subscriptionsOwner.address, jurorsRegistry.address, PERIOD_DURATION, feeToken.address, FEE_AMOUNT, PREPAYMENT_PERIODS, RESUME_PRE_PAID_PERIODS, LATE_PAYMENT_PENALTY_PCT, governorSharePct), 'CS_OVERRATED_GOVERNOR_SHARE_PCT')
          })
        })

        context('when the given resume pre-paid periods is above the pre-payment periods', () => {
          const resumePrePaidPeriods = PREPAYMENT_PERIODS + 1

          it('reverts', async () => {
            await assertRevert(subscriptions.init(subscriptionsOwner.address, jurorsRegistry.address, PERIOD_DURATION, feeToken.address, FEE_AMOUNT, PREPAYMENT_PERIODS, resumePrePaidPeriods, LATE_PAYMENT_PENALTY_PCT, GOVERNOR_SHARE_PCT), 'CS_RESUME_PRE_PAID_PERIODS_BIG')
          })
        })
      })
    })

    context('when the subscriptions was already initialized', () => {
      beforeEach('initialize subscriptions', async () => {
        await subscriptions.init(subscriptionsOwner.address, jurorsRegistry.address, PERIOD_DURATION, feeToken.address, FEE_AMOUNT, PREPAYMENT_PERIODS, RESUME_PRE_PAID_PERIODS, LATE_PAYMENT_PENALTY_PCT, GOVERNOR_SHARE_PCT)
      })

      it('reverts', async () => {
        await assertRevert(subscriptions.init(subscriptionsOwner.address, jurorsRegistry.address, PERIOD_DURATION, feeToken.address, FEE_AMOUNT, PREPAYMENT_PERIODS, RESUME_PRE_PAID_PERIODS, LATE_PAYMENT_PENALTY_PCT, GOVERNOR_SHARE_PCT), 'INIT_ALREADY_INITIALIZED')
      })
    })
  })
})
