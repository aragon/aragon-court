const { buildHelper } = require('../helpers/controller')(web3, artifacts)
const { assertRevert } = require('../helpers/assertThrow')
const { assertBn, bn, bigExp } = require('../helpers/numbers')
const { assertEvent, assertAmountOfEvents } = require('../helpers/assertEvent')

const CourtSubscriptions = artifacts.require('CourtSubscriptions')
const ERC20 = artifacts.require('ERC20Mock')

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

contract('CourtSubscriptions', ([_, governor, someone, something, subscriber]) => {
  let controller, subscriptions, feeToken

  const FEE_AMOUNT = bigExp(10, 18)
  const PREPAYMENT_PERIODS = 12
  const RESUME_PRE_PAID_PERIODS = 10
  const PERIOD_DURATION = 24 * 30           // 30 days, assuming terms are 1h
  const GOVERNOR_SHARE_PCT = bn(100)        // 100‱ = 1%
  const LATE_PAYMENT_PENALTY_PCT = bn(1000) // 1000‱ = 10%

  beforeEach('create base contracts', async () => {
    controller = await buildHelper().deploy({ configGovernor: governor })
    feeToken = await ERC20.new('Subscriptions Fee Token', 'SFT', 18)

    subscriptions = await CourtSubscriptions.new(controller.address, PERIOD_DURATION, feeToken.address, FEE_AMOUNT, PREPAYMENT_PERIODS, RESUME_PRE_PAID_PERIODS, LATE_PAYMENT_PENALTY_PCT, GOVERNOR_SHARE_PCT)
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

          assertAmountOfEvents(receipt, 'FeeAmountChanged')
          assertEvent(receipt, 'FeeAmountChanged', { previousFeeAmount, currentFeeAmount: newFeeAmount })
        })
      })

      context('when the given value is zero', async () => {
        const newFeeAmount = bn(0)

        it('reverts', async () => {
          await assertRevert(subscriptions.setFeeAmount(newFeeAmount, { from }), 'CS_FEE_AMOUNT_ZERO')
        })
      })
    })

    context('when the sender is not the governor', async () => {
      const from = someone

      it('reverts', async () => {
        await assertRevert(subscriptions.setFeeAmount(FEE_AMOUNT, { from }), 'CTD_SENDER_NOT_CONFIG_GOVERNOR')
      })
    })
  })

  describe('setFeeToken', () => {
    context('when the sender is the governor', async () => {
      const from = governor

      context('when the given token address is a contract', async () => {
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

              assertAmountOfEvents(receipt, 'FeeTokenChanged')
              assertEvent(receipt, 'FeeTokenChanged', { previousFeeToken, currentFeeToken: newFeeToken.address })

              assertAmountOfEvents(receipt, 'FeeAmountChanged')
              assertEvent(receipt, 'FeeAmountChanged', { previousFeeAmount, currentFeeAmount: newFeeAmount })
            })
          }

          context('when there were none governor fees accumulated', async () => {
            itUpdatesFeeTokenAndAmount()
          })

          context('when there were some governor fees accumulated', async () => {
            const paidPeriods = bn(2)
            const paidAmount = FEE_AMOUNT.mul(paidPeriods)
            const governorFees = GOVERNOR_SHARE_PCT.mul(paidAmount).div(bn(10000))

            beforeEach('pay some subscriptions', async () => {
              await controller.mockSetTerm(PERIOD_DURATION)
              await feeToken.generateTokens(subscriber, paidAmount)
              await feeToken.approve(subscriptions.address, paidAmount, { from: subscriber })
              await subscriptions.payFees(subscriber, paidPeriods, { from: subscriber })
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

              assertAmountOfEvents(receipt, 'GovernorFeesTransferred')
              assertEvent(receipt, 'GovernorFeesTransferred', { amount: governorFees })
            })
          })
        })

        context('when the given fee amount is zero', async () => {
          const newFeeAmount = bn(0)

          it('reverts', async () => {
            await assertRevert(subscriptions.setFeeToken(newFeeToken.address, newFeeAmount, { from }), 'CS_FEE_AMOUNT_ZERO')
          })
        })
      })

      context('when the given token address is not a contract', async () => {
        const newFeeTokenAddress = something

        it('reverts', async () => {
          await assertRevert(subscriptions.setFeeToken(newFeeTokenAddress, FEE_AMOUNT, { from }), 'CS_FEE_TOKEN_NOT_CONTRACT')
        })
      })

      context('when the given token address is the zero address', async () => {
        const newFeeTokenAddress = ZERO_ADDRESS

        it('reverts', async () => {
          await assertRevert(subscriptions.setFeeToken(newFeeTokenAddress, FEE_AMOUNT, { from }), 'CS_FEE_TOKEN_NOT_CONTRACT')
        })
      })
    })

    context('when the sender is not the governor', async () => {
      const from = someone

      it('reverts', async () => {
        await assertRevert(subscriptions.setFeeToken(feeToken.address, FEE_AMOUNT, { from }), 'CTD_SENDER_NOT_CONFIG_GOVERNOR')
      })
    })
  })

  describe('setPrePaymentPeriods', () => {
    context('when the sender is the governor', async () => {
      const from = governor

      const itUpdatesThePrePaymentPeriods = newPrePaymentPeriods => {
        it('updates the pre payment periods number', async () => {
          await subscriptions.setPrePaymentPeriods(newPrePaymentPeriods, { from })

          assertBn((await subscriptions.prePaymentPeriods()), newPrePaymentPeriods, 'pre payment periods does not match')
        })

        it('emits an event', async () => {
          const previousPrePaymentPeriods = await subscriptions.prePaymentPeriods()

          const receipt = await subscriptions.setPrePaymentPeriods(newPrePaymentPeriods, { from })

          assertAmountOfEvents(receipt, 'PrePaymentPeriodsChanged')
          assertEvent(receipt, 'PrePaymentPeriodsChanged', { previousPrePaymentPeriods, currentPrePaymentPeriods: newPrePaymentPeriods })
        })
      }

      context('when the given value is greater than zero', async () => {
        const newPrePaymentPeriods = bn(10)

        itUpdatesThePrePaymentPeriods(newPrePaymentPeriods)
      })

      context('when the given value is equal to the resume pre-paid periods', async () => {
        const newPrePaymentPeriods = RESUME_PRE_PAID_PERIODS

        itUpdatesThePrePaymentPeriods(newPrePaymentPeriods)
      })

      context('when the given value is above the resume pre-paid periods', async () => {
        const newPrePaymentPeriods = RESUME_PRE_PAID_PERIODS + 1

        itUpdatesThePrePaymentPeriods(newPrePaymentPeriods)
      })

      context('when the given value is zero', async () => {
        const newPrePaymentPeriods = bn(0)

        it('reverts', async () => {
          await assertRevert(subscriptions.setPrePaymentPeriods(newPrePaymentPeriods, { from }), 'CS_PREPAYMENT_PERIODS_ZERO')
        })
      })

      context('when the given value is above the resume pre-paid periods', async () => {
        const newPrePaymentPeriods = RESUME_PRE_PAID_PERIODS - 1

        it('reverts', async () => {
          await assertRevert(subscriptions.setPrePaymentPeriods(newPrePaymentPeriods, { from }), 'CS_RESUME_PRE_PAID_PERIODS_BIG')
        })
      })
    })

    context('when the sender is not the governor', async () => {
      const from = someone

      it('reverts', async () => {
        await assertRevert(subscriptions.setPrePaymentPeriods(PREPAYMENT_PERIODS, { from }), 'CTD_SENDER_NOT_CONFIG_GOVERNOR')
      })
    })
  })

  describe('setLatePaymentPenaltyPct', () => {
    context('when the sender is the governor', async () => {
      const from = governor

      const itUpdatesTheLatePaymentsPenalty = newLatePaymentPenaltyPct => {
        it('updates the late payments penalty pct', async () => {
          await subscriptions.setLatePaymentPenaltyPct(newLatePaymentPenaltyPct, { from })

          assertBn((await subscriptions.latePaymentPenaltyPct()), newLatePaymentPenaltyPct, 'late payments penalty does not match')
        })

        it('emits an event', async () => {
          const previousLatePaymentPenaltyPct = await subscriptions.latePaymentPenaltyPct()

          const receipt = await subscriptions.setLatePaymentPenaltyPct(newLatePaymentPenaltyPct, { from })

          assertAmountOfEvents(receipt, 'LatePaymentPenaltyPctChanged')
          assertEvent(receipt, 'LatePaymentPenaltyPctChanged', { previousLatePaymentPenaltyPct, currentLatePaymentPenaltyPct: newLatePaymentPenaltyPct })
        })
      }

      context('when the given value is zero', async () => {
        const newLatePaymentPenaltyPct = bn(0)

        itUpdatesTheLatePaymentsPenalty(newLatePaymentPenaltyPct)
      })

      context('when the given value is not greater than 10,000', async () => {
        const newLatePaymentPenaltyPct = bn(500)

        itUpdatesTheLatePaymentsPenalty(newLatePaymentPenaltyPct)
      })

      context('when the given value is greater than 10,000', async () => {
        const newLatePaymentPenaltyPct = bn(10001)

        itUpdatesTheLatePaymentsPenalty(newLatePaymentPenaltyPct)
      })
    })

    context('when the sender is not the governor', async () => {
      const from = someone

      it('reverts', async () => {
        await assertRevert(subscriptions.setLatePaymentPenaltyPct(LATE_PAYMENT_PENALTY_PCT, { from }), 'CTD_SENDER_NOT_CONFIG_GOVERNOR')
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

          assertAmountOfEvents(receipt, 'GovernorSharePctChanged')
          assertEvent(receipt, 'GovernorSharePctChanged', { previousGovernorSharePct, currentGovernorSharePct: newGovernorSharePct })
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
          await assertRevert(subscriptions.setGovernorSharePct(newGovernorSharePct, { from }), 'CS_OVERRATED_GOVERNOR_SHARE_PCT')
        })
      })
    })

    context('when the sender is not the governor', async () => {
      const from = someone

      it('reverts', async () => {
        await assertRevert(subscriptions.setGovernorSharePct(GOVERNOR_SHARE_PCT, { from }), 'CTD_SENDER_NOT_CONFIG_GOVERNOR')
      })
    })
  })

  describe('setResumePrePaidPeriods', () => {
    context('when the sender is the governor', async () => {
      const from = governor

      const itUpdatesTheResumePenalties = (newResumePrePaidPeriods) => {
        it('updates the resume penalties', async () => {
          await subscriptions.setResumePrePaidPeriods(newResumePrePaidPeriods, { from })

          assertBn((await subscriptions.resumePrePaidPeriods()), newResumePrePaidPeriods, 'resume pre-paid periods does not match')
        })

        it('emits an event', async () => {
          const previousResumePrePaidPeriods = await subscriptions.resumePrePaidPeriods()

          const receipt = await subscriptions.setResumePrePaidPeriods(newResumePrePaidPeriods, { from })

          assertAmountOfEvents(receipt, 'ResumePenaltiesChanged')
          assertEvent(receipt, 'ResumePenaltiesChanged', { previousResumePrePaidPeriods, currentResumePrePaidPeriods: newResumePrePaidPeriods })
        })
      }

      context('when the given values is zero', async () => {
        const newResumePrePaidPeriods = bn(0)

        itUpdatesTheResumePenalties(newResumePrePaidPeriods)
      })

      context('when the given resume pre-paid periods is below the pre-payment periods', async () => {
        const newResumePrePaidPeriods = PREPAYMENT_PERIODS - 1

        itUpdatesTheResumePenalties(newResumePrePaidPeriods)
      })

      context('when the given resume pre-paid periods is equal to the pre-payment periods', async () => {
        const newResumePrePaidPeriods = PREPAYMENT_PERIODS

        itUpdatesTheResumePenalties(newResumePrePaidPeriods)
      })

      context('when the given pre-paid periods is greater than the pre-payment periods', async () => {
        const newResumePrePaidPeriods = PREPAYMENT_PERIODS + 1

        it('reverts', async () => {
          await assertRevert(subscriptions.setResumePrePaidPeriods(newResumePrePaidPeriods, { from }), 'CS_RESUME_PRE_PAID_PERIODS_BIG')
        })
      })
    })

    context('when the sender is not the governor', async () => {
      const from = someone

      it('reverts', async () => {
        await assertRevert(subscriptions.setResumePrePaidPeriods(RESUME_PRE_PAID_PERIODS, { from }), 'CTD_SENDER_NOT_CONFIG_GOVERNOR')
      })
    })
  })
})
