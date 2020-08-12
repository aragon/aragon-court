const { bn, bigExp } = require('@aragon/contract-helpers-test')
const { assertBn, assertRevert, assertAmountOfEvents, assertEvent } = require('@aragon/contract-helpers-test/src/asserts')

const { buildHelper } = require('../helpers/wrappers/court')
const { SUBSCRIPTIONS_ERRORS } = require('../helpers/utils/errors')
const { SUBSCRIPTIONS_EVENTS } = require('../helpers/utils/events')

const CourtSubscriptions = artifacts.require('CourtSubscriptions')
const ERC20 = artifacts.require('ERC20Mock')

contract('CourtSubscriptions', ([_, governor, payer]) => {
  let controller, subscriptions

  const PERIOD_DURATION = 24 * 30           // 30 days, assuming terms are 1h
  const GOVERNOR_SHARE_PCT = bn(100)        // 100‱ = 1%

  before('create controller and move terms to reach period #0', async () => {
    controller = await buildHelper().deploy({ configGovernor: governor })
    await controller.mockSetTerm(PERIOD_DURATION)
  })

  const getAccumulatedGovernorFees = async () => {
    const currentPeriodId = await subscriptions.getCurrentPeriodId()
    const period = await subscriptions.getPeriod(currentPeriodId)
    return period['accumulatedGovernorFees']
  }

  const transferFeesToGovernor = async (transferFunction, isLast = true, sameCurrentToken = true) => {
    const transferFeesToGovernorCall = async () => {
      if (transferFunction === 'transferFeesToGovernor') {
        const currentPeriodId = await subscriptions.getCurrentPeriodId()
        if (!isLast) {
          if (!sameCurrentToken) {
            const newFeeToken = await ERC20.new('New Subscriptions Fee Token', 'NSFT', 18)
            await subscriptions.setFeeToken(newFeeToken.address, { from: governor })
          }
          await controller.mockIncreaseTime(PERIOD_DURATION)
        }
        return subscriptions[transferFunction](currentPeriodId)
      } else {
        return subscriptions[transferFunction]()
      }
    }

    context('when the fee token is an ERC20', () => {
      let feeToken

      before('deploy fee token', async () => {
        feeToken = await ERC20.new('Subscriptions Fee Token', 'SFT', 18)
      })

      beforeEach('create subscriptions module', async () => {
        subscriptions = await CourtSubscriptions.new(controller.address, PERIOD_DURATION, feeToken.address, GOVERNOR_SHARE_PCT)
        await controller.setSubscriptions(subscriptions.address)
      })

      context('when there are no accumulated fees', () => {
        it('reverts', async () => {
          await assertRevert(transferFeesToGovernorCall(), SUBSCRIPTIONS_ERRORS.GOVERNOR_SHARE_FEES_ZERO)
        })
      })

      context('when there are some accumulated fees', () => {
        beforeEach('pay some app fees', async () => {
          const feeAmount = bigExp(15, 18)
          const balance = feeAmount.mul(bn(4))
          await feeToken.generateTokens(payer, balance)
          await feeToken.approve(subscriptions.address, balance, { from: payer })
          await subscriptions.setAppFee('0x1234', feeToken.address, feeAmount, { from: governor })

          await controller.mockSetTerm(PERIOD_DURATION)
          await subscriptions.payAppFees('0x1234', '0x1a', { from: payer })
          await subscriptions.payAppFees('0x1234', '0x2a', { from: payer })

          await controller.mockIncreaseTerms(PERIOD_DURATION * 3)
          await subscriptions.payAppFees('0x1234', '0x1b', { from: payer })
          await subscriptions.payAppFees('0x1234', '0x2b', { from: payer })
        })

        it('transfers the fees to the governor', async () => {
          const previousAccumulatedFees = await getAccumulatedGovernorFees()
          const previousGovernorBalance = await feeToken.balanceOf(governor)

          await transferFeesToGovernorCall()

          const currentGovernorBalance = await feeToken.balanceOf(governor)
          assertBn(previousGovernorBalance.add(previousAccumulatedFees), currentGovernorBalance, 'governor shares do not match')

          const currentAccumulatedFees = await getAccumulatedGovernorFees()
          assertBn(currentAccumulatedFees, 0, 'governor shares do not match')
        })

        it('emits an event', async () => {
          const previousAccumulatedFees = await getAccumulatedGovernorFees()
          const receipt = await transferFeesToGovernorCall()

          assertAmountOfEvents(receipt, SUBSCRIPTIONS_EVENTS.GOVERNOR_FEES_TRANSFERRED)
          assertEvent(receipt, SUBSCRIPTIONS_EVENTS.GOVERNOR_FEES_TRANSFERRED, { feeToken: feeToken.address, amount: previousAccumulatedFees })
        })
      })
    })
  }

  describe('transferCurrentPeriodFeesToGovernor', () => {
    transferFeesToGovernor('transferCurrentPeriodFeesToGovernor')
  })

  describe('transferFeesToGovernor', () => {
    context('for the last period', () => {
      transferFeesToGovernor('transferFeesToGovernor', true)
    })

    context('for a past period', () => {
      context('when the current token has changed', () => {
        transferFeesToGovernor('transferFeesToGovernor', false, false)
      })

      context('when the current token hasn’t changed', () => {
        transferFeesToGovernor('transferFeesToGovernor', false, true)
      })
    })
  })
})
