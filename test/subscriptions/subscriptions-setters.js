const { assertBn } = require('../helpers/asserts/assertBn')
const { bn, bigExp } = require('../helpers/lib/numbers')
const { buildHelper } = require('../helpers/wrappers/court')(web3, artifacts)
const { assertRevert } = require('../helpers/asserts/assertThrow')
const { SUBSCRIPTIONS_EVENTS } = require('../helpers/utils/events')
const { assertEvent, assertAmountOfEvents } = require('../helpers/asserts/assertEvent')
const { CONTROLLED_ERRORS, SUBSCRIPTIONS_ERRORS } = require('../helpers/utils/errors')

const CourtSubscriptions = artifacts.require('CourtSubscriptions')
const ERC20 = artifacts.require('ERC20Mock')

contract('CourtSubscriptions', ([_, governor, someone, something, subscriber]) => {
  let controller, subscriptions, feeToken

  const FEE_AMOUNT = bigExp(1, 18)
  const PERIOD_DURATION = 24 * 30           // 30 days, assuming terms are 1h
  const GOVERNOR_SHARE_PCT = bn(100)        // 100‱ = 1%
  const ETH_TOKEN = '0x0000000000000000000000000000000000000000'

  before('create base contracts', async () => {
    controller = await buildHelper().deploy({ configGovernor: governor })
    feeToken = await ERC20.new('Subscriptions Fee Token', 'SFT', 18)
  })

  beforeEach('create subscriptions module', async () => {
    subscriptions = await CourtSubscriptions.new(controller.address, PERIOD_DURATION, feeToken.address, FEE_AMOUNT, GOVERNOR_SHARE_PCT)
    await controller.setSubscriptions(subscriptions.address)
  })

  describe('setFeeAmount', () => {
    context('when the sender is the governor', async () => {
      const from = governor

      context('when the given value is greater than zero', async () => {
        const newFeeAmount = bn(500)

        it('updates the subscriptions fee amount', async () => {
          await subscriptions.setFeeAmount(newFeeAmount, { from })

          assertBn((await subscriptions.currentFeeAmount()), newFeeAmount, 'subscription fee amount does not match')
        })

        it('emits an event', async () => {
          const previousFeeAmount = await subscriptions.currentFeeAmount()

          const receipt = await subscriptions.setFeeAmount(newFeeAmount, { from })

          assertAmountOfEvents(receipt, SUBSCRIPTIONS_EVENTS.FEE_AMOUNT_CHANGED)
          assertEvent(receipt, SUBSCRIPTIONS_EVENTS.FEE_AMOUNT_CHANGED, { previousFeeAmount, currentFeeAmount: newFeeAmount })
        })
      })

      context('when the given value is zero', async () => {
        const newFeeAmount = bn(0)

        it('reverts', async () => {
          await assertRevert(subscriptions.setFeeAmount(newFeeAmount, { from }), SUBSCRIPTIONS_ERRORS.FEE_AMOUNT_ZERO)
        })
      })
    })

    context('when the sender is not the governor', async () => {
      const from = someone

      it('reverts', async () => {
        await assertRevert(subscriptions.setFeeAmount(FEE_AMOUNT, { from }), CONTROLLED_ERRORS.SENDER_NOT_CONFIG_GOVERNOR)
      })
    })
  })

  describe('setFeeToken', () => {
    context('when the sender is the governor', async () => {
      const from = governor

      context('when the given token address is an ERC20', async () => {
        let newFeeToken

        beforeEach('deploy new fee token', async () => {
          newFeeToken = await ERC20.new('New Fee Token', 'NFT', 18)
        })

        context('when the given fee amount is greater than zero', async () => {
          const newFeeAmount = bigExp(99, 18)

          const itUpdatesFeeTokenAndAmount = () => {
            it('updates the current fee token address and amount', async () => {
              await subscriptions.setFeeToken(newFeeToken.address, newFeeAmount, { from })

              assert.equal(await subscriptions.currentFeeToken(), newFeeToken.address, 'fee token does not match')
              assertBn((await subscriptions.currentFeeAmount()), newFeeAmount, 'fee amount does not match')
            })

            it('emits an event', async () => {
              const previousFeeToken = await subscriptions.currentFeeToken()
              const previousFeeAmount = await subscriptions.currentFeeAmount()

              const receipt = await subscriptions.setFeeToken(newFeeToken.address, newFeeAmount, { from })

              assertAmountOfEvents(receipt, SUBSCRIPTIONS_EVENTS.FEE_TOKEN_CHANGED)
              assertEvent(receipt, SUBSCRIPTIONS_EVENTS.FEE_TOKEN_CHANGED, { previousFeeToken, currentFeeToken: newFeeToken.address })

              assertAmountOfEvents(receipt, SUBSCRIPTIONS_EVENTS.FEE_AMOUNT_CHANGED)
              assertEvent(receipt, SUBSCRIPTIONS_EVENTS.FEE_AMOUNT_CHANGED, { previousFeeAmount, currentFeeAmount: newFeeAmount })
            })
          }

          context('when there were none governor fees accumulated', async () => {
            itUpdatesFeeTokenAndAmount()
          })

          context('when there were some governor fees accumulated', async () => {
            const paidSubscriptions = bn(2)
            const paidAmount = FEE_AMOUNT.mul(paidSubscriptions)
            const governorFees = GOVERNOR_SHARE_PCT.mul(paidAmount).div(bn(10000))

            beforeEach('pay some subscriptions', async () => {
              await controller.mockSetTerm(PERIOD_DURATION)
              await feeToken.generateTokens(subscriber, paidAmount)
              await feeToken.approve(subscriptions.address, paidAmount, { from: subscriber })

              for (let i = 0; i < paidSubscriptions.toNumber(); i++) {
                await subscriptions.payFees(subscriber, '0x', { from: subscriber })
              }
            })

            itUpdatesFeeTokenAndAmount()

            it('transfers the accumulated fees to the governor', async () => {
              const previousGovernorBalance = await feeToken.balanceOf(governor)

              await subscriptions.setFeeToken(newFeeToken.address, newFeeAmount, { from })

              const currentGovernorBalance = await feeToken.balanceOf(governor)
              assertBn(previousGovernorBalance.add(governorFees), currentGovernorBalance, 'governor shares do not match')
            })

            it('emits a governor share fees transferred event', async () => {
              const receipt = await subscriptions.setFeeToken(newFeeToken.address, newFeeAmount, { from })

              assertAmountOfEvents(receipt, SUBSCRIPTIONS_EVENTS.GOVERNOR_FEES_TRANSFERRED)
              assertEvent(receipt, SUBSCRIPTIONS_EVENTS.GOVERNOR_FEES_TRANSFERRED, { amount: governorFees })
            })
          })
        })

        context('when the given fee amount is zero', async () => {
          const newFeeAmount = bn(0)

          it('reverts', async () => {
            await assertRevert(subscriptions.setFeeToken(newFeeToken.address, newFeeAmount, { from }), SUBSCRIPTIONS_ERRORS.FEE_AMOUNT_ZERO)
          })
        })
      })

      context('when the given token address is ETH', async () => {
        let newFeeToken = ETH_TOKEN

        context('when the given fee amount is greater than zero', async () => {
          const newFeeAmount = bigExp(9, 18)

          const itUpdatesFeeTokenAndAmount = () => {
            it('updates the current fee token address and amount', async () => {
              await subscriptions.setFeeToken(newFeeToken, newFeeAmount, { from })

              assert.equal(await subscriptions.currentFeeToken(), newFeeToken, 'fee token does not match')
              assertBn((await subscriptions.currentFeeAmount()), newFeeAmount, 'fee amount does not match')
            })

            it('emits an event', async () => {
              const previousFeeToken = await subscriptions.currentFeeToken()
              const previousFeeAmount = await subscriptions.currentFeeAmount()

              const receipt = await subscriptions.setFeeToken(newFeeToken, newFeeAmount, { from })

              assertAmountOfEvents(receipt, SUBSCRIPTIONS_EVENTS.FEE_TOKEN_CHANGED)
              assertEvent(receipt, SUBSCRIPTIONS_EVENTS.FEE_TOKEN_CHANGED, { previousFeeToken, currentFeeToken: newFeeToken })

              assertAmountOfEvents(receipt, SUBSCRIPTIONS_EVENTS.FEE_AMOUNT_CHANGED)
              assertEvent(receipt, SUBSCRIPTIONS_EVENTS.FEE_AMOUNT_CHANGED, { previousFeeAmount, currentFeeAmount: newFeeAmount })
            })
          }

          context('when there were none governor fees accumulated', async () => {
            itUpdatesFeeTokenAndAmount()
          })

          context('when there were some governor fees accumulated', async () => {
            const paidSubscriptions = bn(2)
            const paidAmount = FEE_AMOUNT.mul(paidSubscriptions)
            const governorFees = GOVERNOR_SHARE_PCT.mul(paidAmount).div(bn(10000))

            beforeEach('pay some subscriptions', async () => {
              await controller.mockSetTerm(PERIOD_DURATION)
              await feeToken.generateTokens(subscriber, paidAmount)
              await feeToken.approve(subscriptions.address, paidAmount, { from: subscriber })

              for (let i = 0; i < paidSubscriptions.toNumber(); i++) {
                await subscriptions.payFees(subscriber, '0x', { from: subscriber })
              }
            })

            itUpdatesFeeTokenAndAmount()

            it('transfers the accumulated fees to the governor', async () => {
              const previousGovernorBalance = await feeToken.balanceOf(governor)

              await subscriptions.setFeeToken(newFeeToken, newFeeAmount, { from })

              const currentGovernorBalance = await feeToken.balanceOf(governor)
              assertBn(previousGovernorBalance.add(governorFees), currentGovernorBalance, 'governor shares do not match')
            })

            it('emits a governor share fees transferred event', async () => {
              const receipt = await subscriptions.setFeeToken(newFeeToken, newFeeAmount, { from })

              assertAmountOfEvents(receipt, SUBSCRIPTIONS_EVENTS.GOVERNOR_FEES_TRANSFERRED)
              assertEvent(receipt, SUBSCRIPTIONS_EVENTS.GOVERNOR_FEES_TRANSFERRED, { amount: governorFees })
            })
          })
        })

        context('when the given fee amount is zero', async () => {
          const newFeeAmount = bn(0)

          it('reverts', async () => {
            await assertRevert(subscriptions.setFeeToken(newFeeToken, newFeeAmount, { from }), SUBSCRIPTIONS_ERRORS.FEE_AMOUNT_ZERO)
          })
        })
      })

      context('when the given token address is not a contract', async () => {
        const newFeeTokenAddress = something

        it('reverts', async () => {
          await assertRevert(subscriptions.setFeeToken(newFeeTokenAddress, FEE_AMOUNT, { from }), SUBSCRIPTIONS_ERRORS.FEE_TOKEN_NOT_CONTRACT)
        })
      })
    })

    context('when the sender is not the governor', async () => {
      const from = someone

      it('reverts', async () => {
        await assertRevert(subscriptions.setFeeToken(ETH_TOKEN, FEE_AMOUNT, { from }), CONTROLLED_ERRORS.SENDER_NOT_CONFIG_GOVERNOR)
      })
    })
  })

  describe('setGovernorSharePct', () => {
    context('when the sender is the governor', async () => {
      const from = governor

      const itUpdatesTheGovernorSharePct = newGovernorSharePct => {
        it('updates the governor share pct', async () => {
          await subscriptions.setGovernorSharePct(newGovernorSharePct, { from })

          assertBn((await subscriptions.governorSharePct()), newGovernorSharePct, 'governor share pct does not match')
        })

        it('emits an event', async () => {
          const previousGovernorSharePct = await subscriptions.governorSharePct()

          const receipt = await subscriptions.setGovernorSharePct(newGovernorSharePct, { from })

          assertAmountOfEvents(receipt, SUBSCRIPTIONS_EVENTS.GOVERNOR_SHARE_PCT_CHANGED)
          assertEvent(receipt, SUBSCRIPTIONS_EVENTS.GOVERNOR_SHARE_PCT_CHANGED, { previousGovernorSharePct, currentGovernorSharePct: newGovernorSharePct })
        })
      }

      context('when the given value is zero', async () => {
        const newGovernorSharePct = bn(0)

        itUpdatesTheGovernorSharePct(newGovernorSharePct)
      })

      context('when the given value is not greater than 10,000', async () => {
        const newGovernorSharePct = bn(500)

        itUpdatesTheGovernorSharePct(newGovernorSharePct)
      })

      context('when the given value is greater than 10,000', async () => {
        const newGovernorSharePct = bn(10001)

        it('reverts', async () => {
          await assertRevert(subscriptions.setGovernorSharePct(newGovernorSharePct, { from }), SUBSCRIPTIONS_ERRORS.OVERRATED_GOVERNOR_SHARE_PCT)
        })
      })
    })

    context('when the sender is not the governor', async () => {
      const from = someone

      it('reverts', async () => {
        await assertRevert(subscriptions.setGovernorSharePct(GOVERNOR_SHARE_PCT, { from }), CONTROLLED_ERRORS.SENDER_NOT_CONFIG_GOVERNOR)
      })
    })
  })
})
