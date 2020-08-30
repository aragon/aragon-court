const { assertBn } = require('../helpers/asserts/assertBn')
const { bn, bigExp } = require('../helpers/lib/numbers')
const { buildHelper } = require('../helpers/wrappers/court')(web3, artifacts)
const { assertRevert } = require('../helpers/asserts/assertThrow')
const { ACTIVATE_DATA } = require('../helpers/utils/jurors')
const { padLeft, toHex } = require('web3-utils')
const { SUBSCRIPTIONS_ERRORS } = require('../helpers/utils/errors')
const { SUBSCRIPTIONS_EVENTS } = require('../helpers/utils/events')
const { assertAmountOfEvents, assertEvent } = require('../helpers/asserts/assertEvent')

const CourtSubscriptions = artifacts.require('CourtSubscriptions')
const JurorsRegistry = artifacts.require('JurorsRegistry')
const DisputeManager = artifacts.require('DisputeManagerMockForRegistry')
const ERC20 = artifacts.require('ERC20Mock')

contract('CourtSubscriptions', ([_, payer, jurorPeriod0Term1, jurorPeriod0Term3, jurorMidPeriod1]) => {
  let controller, subscriptions, jurorsRegistry, feeToken, jurorToken

  const PCT_BASE = bn(10000)
  const FEE_AMOUNT = bigExp(10, 18)
  const PERIOD_DURATION = 24 * 30           // 30 days, assuming terms are 1h
  const GOVERNOR_SHARE_PCT = bn(100)        // 100‱ = 1%

  const MIN_JURORS_ACTIVE_TOKENS = bigExp(100, 18)
  const TOTAL_ACTIVE_BALANCE_LIMIT = bigExp(100e6, 18)

  beforeEach('create base contracts', async () => {
    controller = await buildHelper().deploy({ minActiveBalance: MIN_JURORS_ACTIVE_TOKENS })
    feeToken = await ERC20.new('Subscriptions Fee Token', 'SFT', 18)
    jurorToken = await ERC20.new('AN Jurors Token', 'ANJ', 18)

    subscriptions = await CourtSubscriptions.new(controller.address, PERIOD_DURATION, feeToken.address)
    await controller.setSubscriptions(subscriptions.address)

    jurorsRegistry = await JurorsRegistry.new(controller.address, jurorToken.address, TOTAL_ACTIVE_BALANCE_LIMIT)
    await controller.setJurorsRegistry(jurorsRegistry.address)

    const disputeManager = await DisputeManager.new(controller.address)
    await controller.setDisputeManager(disputeManager.address)
  })

  describe('claimFees', () => {
    context('when there were some jurors active', () => {
      const jurorPeriod0Term1Balance = MIN_JURORS_ACTIVE_TOKENS
      const jurorPeriod0Term3Balance = MIN_JURORS_ACTIVE_TOKENS.mul(bn(2))
      const jurorMidPeriod1Balance = MIN_JURORS_ACTIVE_TOKENS.mul(bn(3))

      beforeEach('activate jurors', async () => {
        await controller.mockSetTerm(0) // tokens are activated for the next term
        await jurorToken.generateTokens(jurorPeriod0Term1, jurorPeriod0Term1Balance)
        await jurorToken.approveAndCall(jurorsRegistry.address, jurorPeriod0Term1Balance, ACTIVATE_DATA, { from: jurorPeriod0Term1 })

        await controller.mockSetTerm(2) // tokens are activated for the next term
        await jurorToken.generateTokens(jurorPeriod0Term3, jurorPeriod0Term3Balance)
        await jurorToken.approveAndCall(jurorsRegistry.address, jurorPeriod0Term3Balance, ACTIVATE_DATA, { from: jurorPeriod0Term3 })

        await controller.mockSetTerm(PERIOD_DURATION * 1.5 - 1)
        await jurorToken.generateTokens(jurorMidPeriod1, jurorMidPeriod1Balance)
        await jurorToken.approveAndCall(jurorsRegistry.address, jurorMidPeriod1Balance, ACTIVATE_DATA, { from: jurorMidPeriod1 })
      })

      context('when there were some subscriptions', () => {
        const totalFees = FEE_AMOUNT
        const collectedFeesPeriod0 = totalFees

        beforeEach('donate subscriptions', async () => {
          await feeToken.generateTokens(payer, totalFees)
          await feeToken.transfer(subscriptions.address, totalFees, { from: payer })

          await controller.mockSetTerm(PERIOD_DURATION + 1)
        })

        context('when requesting a past period', () => {
          const periodId = 0

          context('when the checkpoint used is at term #1', () => {
            const expectedTotalActiveBalance = jurorPeriod0Term1Balance

            beforeEach('mock term randomness', async () => {
              const randomness = padLeft(toHex(PERIOD_DURATION), 64)
              await controller.mockSetTermRandomness(randomness)
            })

            it('computes total active balance correctly', async () => {
              const { periodBalanceCheckpoint, totalActiveBalance, donatedFees } = await subscriptions.getPeriodBalanceDetails(periodId)

              assertBn(periodBalanceCheckpoint, 1, 'checkpoint does not match')
              assertBn(totalActiveBalance, expectedTotalActiveBalance, 'total active balance does not match')
              assertBn(donatedFees, totalFees, 'donated fees does not match')
            })

            context('when the claiming juror was active at that term', async () => {
              const juror = jurorPeriod0Term1
              const expectedShareFees = collectedFeesPeriod0

              it('estimates juror share correctly', async () => {
                const { feeToken: tokenAddress, jurorShare } = await subscriptions.getJurorShare(juror)

                console.log((await subscriptions.getCurrentPeriodId()).toString())

                assert.equal(tokenAddress, feeToken.address, 'fee token address does not match')
                assertBn(jurorShare, totalFees, 'juror share fees does not match')
              })

              it('transfers share fees to the juror', async () => {
                const previousBalance = await feeToken.balanceOf(juror)

                await subscriptions.claimFees({ from: juror })

                const currentBalance = await feeToken.balanceOf(juror)
                assertBn(previousBalance.add(expectedShareFees), currentBalance, 'juror balance does not match')
                assert.isTrue(await subscriptions.hasJurorClaimed(juror))
              })

              it('emits an event', async () => {
                const receipt = await subscriptions.claimFees({ from: juror })

                assertAmountOfEvents(receipt, SUBSCRIPTIONS_EVENTS.FEES_CLAIMED)
                assertEvent(receipt, SUBSCRIPTIONS_EVENTS.FEES_CLAIMED, {
                  juror,
                  periodId,
                  jurorShare: expectedShareFees
                })
              })
            })

            context('when the claiming juror was not active yet', async () => {
              const juror = jurorPeriod0Term3

              it('estimates juror share correctly', async () => {
                const { feeToken: tokenAddress, jurorShare } = await subscriptions.getJurorShare(juror)

                assert.equal(tokenAddress, feeToken.address, 'fee token address does not match')
                assertBn(jurorShare, 0, 'juror share fees does not match')
              })

              it('reverts', async () => {
                await assertRevert(subscriptions.claimFees({ from: juror }), SUBSCRIPTIONS_ERRORS.JUROR_NOTHING_TO_CLAIM)
              })
            })
          })

          context('when the checkpoint used is at term #3', () => {
            const expectedTotalActiveBalance = jurorPeriod0Term1Balance.add(jurorPeriod0Term3Balance)

            beforeEach('mock term randomness', async () => {
              const randomness = padLeft(toHex(PERIOD_DURATION + 2), 64)
              await controller.mockSetTermRandomness(randomness)
            })

            it('computes total active balance correctly', async () => {
              const { periodBalanceCheckpoint, totalActiveBalance, donatedFees } = await subscriptions.getPeriodBalanceDetails(periodId)

              assertBn(periodBalanceCheckpoint, 3, 'checkpoint does not match')
              assertBn(totalActiveBalance, expectedTotalActiveBalance, 'total active balance does not match')
              assertBn(donatedFees, totalFees, 'donated fees does not match')
            })

            context('when the claiming juror was active before that term', async () => {
              const juror = jurorPeriod0Term1
              const expectedShareFees = collectedFeesPeriod0.mul(jurorPeriod0Term1Balance).div(expectedTotalActiveBalance)

              it('estimates juror share correctly', async () => {
                const { feeToken: tokenAddress, jurorShare } = await subscriptions.getJurorShare(juror)

                assert.equal(tokenAddress, feeToken.address, 'fee token address does not match')
                assertBn(jurorShare, expectedShareFees, 'juror share fees does not match')
              })

              it('transfers share fees to the juror', async () => {
                const previousBalance = await feeToken.balanceOf(juror)

                await subscriptions.claimFees({ from: juror })

                const currentBalance = await feeToken.balanceOf(juror)
                assertBn(previousBalance.add(expectedShareFees), currentBalance, 'juror balance does not match')
                assert.isTrue(await subscriptions.hasJurorClaimed(juror))
              })

              it('emits an event', async () => {
                const receipt = await subscriptions.claimFees({ from: juror })

                assertAmountOfEvents(receipt, SUBSCRIPTIONS_EVENTS.FEES_CLAIMED)
                assertEvent(receipt, SUBSCRIPTIONS_EVENTS.FEES_CLAIMED, {
                  juror,
                  periodId,
                  jurorShare: expectedShareFees
                })
              })
            })

            context('when the claiming juror was active at that term', async () => {
              const juror = jurorPeriod0Term3
              const expectedShareFees = collectedFeesPeriod0.mul(jurorPeriod0Term3Balance).div(expectedTotalActiveBalance)

              it('estimates juror share correctly', async () => {
                const { feeToken: tokenAddress, jurorShare } = await subscriptions.getJurorShare(juror)

                assert.equal(tokenAddress, feeToken.address, 'fee token address does not match')
                assertBn(jurorShare, expectedShareFees, 'juror share fees does not match')
              })

              it('transfers share fees to the juror', async () => {
                const previousBalance = await feeToken.balanceOf(juror)

                await subscriptions.claimFees({ from: juror })

                const currentBalance = await feeToken.balanceOf(juror)
                assertBn(previousBalance.add(expectedShareFees), currentBalance, 'juror balance does not match')
                assert.isTrue(await subscriptions.hasJurorClaimed(juror))
              })

              it('emits an event', async () => {
                const receipt = await subscriptions.claimFees({ from: juror })

                assertAmountOfEvents(receipt, SUBSCRIPTIONS_EVENTS.FEES_CLAIMED)
                assertEvent(receipt, SUBSCRIPTIONS_EVENTS.FEES_CLAIMED, {
                  juror,
                  periodId,
                  jurorShare: expectedShareFees
                })
              })
            })
          })
        })
      })

      it('reverts when requesting before period 1 has begun', async () => {
        await controller.mockSetTerm(1)
        await assertRevert(subscriptions.claimFees({ from: jurorPeriod0Term1 }), SUBSCRIPTIONS_ERRORS.NON_PAST_PERIOD)
      })

      it('reverts when juror has nothing to claim', async () => {
        await controller.mockSetTerm(PERIOD_DURATION + 1)
        await assertRevert(subscriptions.claimFees({ from: jurorPeriod0Term1 }), SUBSCRIPTIONS_ERRORS.JUROR_NOTHING_TO_CLAIM)
      })
    })
  })
})
