const { assertBn } = require('../helpers/asserts/assertBn')
const { bn, bigExp } = require('../helpers/lib/numbers')
const { buildHelper } = require('../helpers/wrappers/controller')(web3, artifacts)
const { assertRevert } = require('../helpers/asserts/assertThrow')
const { CONTROLLED_ERRORS, SUBSCRIPTIONS_ERRORS } = require('../helpers/utils/errors')

const CourtSubscriptions = artifacts.require('CourtSubscriptions')
const ERC20 = artifacts.require('ERC20Mock')

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

contract('CourtSubscriptions', ([_, someone]) => {
  let controller, feeToken

  const FEE_AMOUNT = bigExp(10, 18)
  const PREPAYMENT_PERIODS = 12
  const RESUME_PRE_PAID_PERIODS = 10
  const PERIOD_DURATION = 24 * 30           // 30 days, assuming terms are 1h
  const GOVERNOR_SHARE_PCT = bn(100)        // 100‱ = 1%
  const LATE_PAYMENT_PENALTY_PCT = bn(1000) // 1000‱ = 10%

  beforeEach('create base contracts', async () => {
    controller = await buildHelper().deploy()
    feeToken = await ERC20.new('Subscriptions Fee Token', 'SFT', 18)
  })

  describe('constructor', () => {
    context('when the initialization succeeds', () => {
      it('initializes subscriptions correctly', async () => {
        const subscriptions = await CourtSubscriptions.new(controller.address, PERIOD_DURATION, feeToken.address, FEE_AMOUNT, PREPAYMENT_PERIODS, RESUME_PRE_PAID_PERIODS, LATE_PAYMENT_PENALTY_PCT, GOVERNOR_SHARE_PCT)

        assert.equal(await subscriptions.getController(), controller.address, 'subscriptions controller does not match')
        assert.equal(await subscriptions.periodDuration(), PERIOD_DURATION, 'subscriptions duration does not match')
        assert.equal(await subscriptions.currentFeeToken(), feeToken.address, 'fee token does not match')
        assertBn((await subscriptions.currentFeeAmount()), FEE_AMOUNT, 'fee amount does not match')
        assertBn((await subscriptions.prePaymentPeriods()), PREPAYMENT_PERIODS, 'pre payment periods does not match')
        assertBn((await subscriptions.latePaymentPenaltyPct()), LATE_PAYMENT_PENALTY_PCT, 'late payments penalty pct does not match')
        assertBn((await subscriptions.governorSharePct()), GOVERNOR_SHARE_PCT, 'governor share pct does not match')
      })
    })

    context('initialization fails', () => {
      context('when the given controller is the zero address', () => {
        const controllerAddress = ZERO_ADDRESS

        it('reverts', async () => {
          await assertRevert(CourtSubscriptions.new(controllerAddress, PERIOD_DURATION, feeToken.address, FEE_AMOUNT, PREPAYMENT_PERIODS, RESUME_PRE_PAID_PERIODS, LATE_PAYMENT_PENALTY_PCT, GOVERNOR_SHARE_PCT), CONTROLLED_ERRORS.CONTROLLER_NOT_CONTRACT)
        })
      })

      context('when the given controller is not a contract address', () => {
        const controllerAddress = someone

        it('reverts', async () => {
          await assertRevert(CourtSubscriptions.new(controllerAddress, PERIOD_DURATION, feeToken.address, FEE_AMOUNT, PREPAYMENT_PERIODS, RESUME_PRE_PAID_PERIODS, LATE_PAYMENT_PENALTY_PCT, GOVERNOR_SHARE_PCT), CONTROLLED_ERRORS.CONTROLLER_NOT_CONTRACT)
        })
      })

      context('when the given period duration is zero', () => {
        const periodDuration = 0

        it('reverts', async () => {
          await assertRevert(CourtSubscriptions.new(controller.address, periodDuration, feeToken.address, FEE_AMOUNT, PREPAYMENT_PERIODS, RESUME_PRE_PAID_PERIODS, LATE_PAYMENT_PENALTY_PCT, GOVERNOR_SHARE_PCT), SUBSCRIPTIONS_ERRORS.PERIOD_DURATION_ZERO)
        })
      })

      context('when the given fee token address is the zero address', () => {
        const feeTokenAddress = ZERO_ADDRESS

        it('reverts', async () => {
          await assertRevert(CourtSubscriptions.new(controller.address, PERIOD_DURATION, feeTokenAddress, FEE_AMOUNT, PREPAYMENT_PERIODS, RESUME_PRE_PAID_PERIODS, LATE_PAYMENT_PENALTY_PCT, GOVERNOR_SHARE_PCT), SUBSCRIPTIONS_ERRORS.FEE_TOKEN_NOT_CONTRACT)
        })
      })

      context('when the given fee token address is not a contract address', () => {
        const feeTokenAddress = someone

        it('reverts', async () => {
          await assertRevert(CourtSubscriptions.new(controller.address, PERIOD_DURATION, feeTokenAddress, FEE_AMOUNT, PREPAYMENT_PERIODS, RESUME_PRE_PAID_PERIODS, LATE_PAYMENT_PENALTY_PCT, GOVERNOR_SHARE_PCT), SUBSCRIPTIONS_ERRORS.FEE_TOKEN_NOT_CONTRACT)
        })
      })

      context('when the given fee amount is zero', () => {
        const feeAmount = 0

        it('reverts', async () => {
          await assertRevert(CourtSubscriptions.new(controller.address, PERIOD_DURATION, feeToken.address, feeAmount, PREPAYMENT_PERIODS, RESUME_PRE_PAID_PERIODS, LATE_PAYMENT_PENALTY_PCT, GOVERNOR_SHARE_PCT), SUBSCRIPTIONS_ERRORS.FEE_AMOUNT_ZERO)
        })
      })

      context('when the given pre payment periods number is zero', () => {
        const prePaymentPeriods = 0

        it('reverts', async () => {
          await assertRevert(CourtSubscriptions.new(controller.address, PERIOD_DURATION, feeToken.address, FEE_AMOUNT, prePaymentPeriods, RESUME_PRE_PAID_PERIODS, LATE_PAYMENT_PENALTY_PCT, GOVERNOR_SHARE_PCT), SUBSCRIPTIONS_ERRORS.PREPAYMENT_PERIODS_ZERO)
        })
      })

      context('when the given governor share is above 100%', () => {
        const governorSharePct = bn(10001)

        it('reverts', async () => {
          await assertRevert(CourtSubscriptions.new(controller.address, PERIOD_DURATION, feeToken.address, FEE_AMOUNT, PREPAYMENT_PERIODS, RESUME_PRE_PAID_PERIODS, LATE_PAYMENT_PENALTY_PCT, governorSharePct), SUBSCRIPTIONS_ERRORS.OVERRATED_GOVERNOR_SHARE_PCT)
        })
      })

      context('when the given resume pre-paid periods is above the pre-payment periods', () => {
        const resumePrePaidPeriods = PREPAYMENT_PERIODS + 1

        it('reverts', async () => {
          await assertRevert(CourtSubscriptions.new(controller.address, PERIOD_DURATION, feeToken.address, FEE_AMOUNT, PREPAYMENT_PERIODS, resumePrePaidPeriods, LATE_PAYMENT_PENALTY_PCT, GOVERNOR_SHARE_PCT), SUBSCRIPTIONS_ERRORS.RESUME_PRE_PAID_PERIODS_BIG)
        })
      })
    })
  })
})
