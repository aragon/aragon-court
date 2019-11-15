const { assertBn } = require('../helpers/asserts/assertBn')
const { bn, bigExp } = require('../helpers/lib/numbers')
const { buildHelper } = require('../helpers/wrappers/court')(web3, artifacts)
const { assertRevert } = require('../helpers/asserts/assertThrow')
const { REGISTRY_EVENTS } = require('../helpers/utils/events')
const { REGISTRY_ERRORS } = require('../helpers/utils/errors')
const { assertEvent, assertAmountOfEvents } = require('../helpers/asserts/assertEvent')

const JurorsRegistry = artifacts.require('JurorsRegistry')
const DisputeManager = artifacts.require('DisputeManagerMockForRegistry')
const ERC20 = artifacts.require('ERC20Mock')

contract('JurorsRegistry', ([_, juror]) => {
  let controller, registry, disputeManager, ANJ

  const MIN_ACTIVE_AMOUNT = bigExp(100, 18)
  const TOTAL_ACTIVE_BALANCE_LIMIT = bigExp(100e6, 18)

  beforeEach('create base contracts', async () => {
    controller = await buildHelper().deploy({ minActiveBalance: MIN_ACTIVE_AMOUNT })

    ANJ = await ERC20.new('ANJ Token', 'ANJ', 18)
    registry = await JurorsRegistry.new(controller.address, ANJ.address, TOTAL_ACTIVE_BALANCE_LIMIT)
    await controller.setJurorsRegistry(registry.address)

    disputeManager = await DisputeManager.new(controller.address)
    await controller.setDisputeManager(disputeManager.address)
  })

  describe('activate', () => {
    const from = juror

    context('when the juror has not staked some tokens yet', () => {
      context('when the given amount is zero', () => {
        const amount = bn(0)

        it('reverts', async () => {
          await assertRevert(registry.activate(amount, { from }), REGISTRY_ERRORS.INVALID_ZERO_AMOUNT)
        })
      })

      context('when the given amount is lower than the minimum active value', () => {
        const amount = MIN_ACTIVE_AMOUNT.sub(bn(1))

        it('reverts', async () => {
          await assertRevert(registry.activate(amount, { from }), REGISTRY_ERRORS.INVALID_ACTIVATION_AMOUNT)
        })
      })

      context('when the given amount is greater than the minimum active value', () => {
        const amount = MIN_ACTIVE_AMOUNT.mul(bn(2))

        it('reverts', async () => {
          await assertRevert(registry.activate(amount, { from }), REGISTRY_ERRORS.INVALID_ACTIVATION_AMOUNT)
        })
      })
    })

    context('when the juror has already staked some tokens', () => {
      const maxPossibleBalance = TOTAL_ACTIVE_BALANCE_LIMIT

      beforeEach('stake some tokens', async () => {
        await ANJ.generateTokens(from, maxPossibleBalance)
        await ANJ.approveAndCall(registry.address, maxPossibleBalance, '0x', { from })
      })

      const itHandlesActivationProperlyFor = (requestedAmount, expectedAmount = requestedAmount, deactivationAmount = bn(0)) => {
        it('adds the requested amount to the active balance of the juror and removes it from the available balance', async () => {
          const { active: previousActiveBalance, available: previousAvailableBalance, locked: previousLockedBalance, pendingDeactivation: previousDeactivationBalance } = await registry.balanceOf(juror)

          await registry.activate(requestedAmount, { from })

          const { active: currentActiveBalance, available: currentAvailableBalance, locked: currentLockedBalance, pendingDeactivation: currentDeactivationBalance } = await registry.balanceOf(juror)
          assertBn(previousLockedBalance, currentLockedBalance, 'locked balances do not match')
          assertBn(previousAvailableBalance.sub(expectedAmount.sub(deactivationAmount)), currentAvailableBalance, 'available balances do not match')

          assertBn(previousActiveBalance.add(expectedAmount), currentActiveBalance, 'active balances do not match')
          assertBn(previousDeactivationBalance.sub(deactivationAmount), currentDeactivationBalance, 'deactivation balances do not match')
        })

        it('does not affect the active balance of the current term', async () => {
          const termId = await controller.getLastEnsuredTermId()
          const currentTermPreviousBalance = await registry.activeBalanceOfAt(juror, termId)

          await registry.activate(requestedAmount, { from })

          const currentTermCurrentBalance = await registry.activeBalanceOfAt(juror, termId)
          assertBn(currentTermPreviousBalance, currentTermCurrentBalance, 'current term active balances do not match')
        })

        it('increments the unlocked balance of the juror', async () => {
          const previousUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(juror)

          await registry.activate(requestedAmount, { from })

          await controller.mockIncreaseTerm()
          const currentUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(juror)
          assertBn(previousUnlockedActiveBalance.add(expectedAmount), currentUnlockedActiveBalance, 'unlocked balances do not match')
        })

        it('does not affect the staked balances', async () => {
          const previousTotalStake = await registry.totalStaked()
          const previousJurorStake = await registry.totalStakedFor(juror)

          await registry.activate(requestedAmount, { from })

          const currentTotalStake = await registry.totalStaked()
          assertBn(previousTotalStake, currentTotalStake, 'total stake amounts do not match')

          const currentJurorStake = await registry.totalStakedFor(juror)
          assertBn(previousJurorStake, currentJurorStake, 'juror stake amounts do not match')
        })

        it('does not affect the token balances', async () => {
          const previousJurorBalance = await ANJ.balanceOf(from)
          const previousRegistryBalance = await ANJ.balanceOf(registry.address)

          await registry.activate(requestedAmount, { from })

          const currentSenderBalance = await ANJ.balanceOf(from)
          assertBn(previousJurorBalance, currentSenderBalance, 'juror balances do not match')

          const currentRegistryBalance = await ANJ.balanceOf(registry.address)
          assertBn(previousRegistryBalance, currentRegistryBalance, 'registry balances do not match')
        })

        it('emits an activation event', async () => {
          const termId = await controller.getLastEnsuredTermId()

          const receipt = await registry.activate(requestedAmount, { from })

          assertAmountOfEvents(receipt, REGISTRY_EVENTS.JUROR_ACTIVATED)
          assertEvent(receipt, REGISTRY_EVENTS.JUROR_ACTIVATED, { juror, fromTermId: termId.add(bn(1)), amount: expectedAmount })
        })

        if (deactivationAmount.eq(bn(0))) {
          it('emits one available balance changed events', async () => {
            const receipt = await registry.activate(requestedAmount, { from })

            assertAmountOfEvents(receipt, REGISTRY_EVENTS.JUROR_AVAILABLE_BALANCE_CHANGED)
            assertEvent(receipt, REGISTRY_EVENTS.JUROR_AVAILABLE_BALANCE_CHANGED, { juror, amount: expectedAmount, positive: false })
          })
        } else {
          it('emits two available balance changed events', async () => {
            const receipt = await registry.activate(requestedAmount, { from })

            assertAmountOfEvents(receipt, REGISTRY_EVENTS.JUROR_AVAILABLE_BALANCE_CHANGED, 2)
            assertEvent(receipt, REGISTRY_EVENTS.JUROR_AVAILABLE_BALANCE_CHANGED, { juror, amount: deactivationAmount, positive: true }, 0)
            assertEvent(receipt, REGISTRY_EVENTS.JUROR_AVAILABLE_BALANCE_CHANGED, { juror, amount: expectedAmount, positive: false }, 1)
          })

          it('emits a deactivation processed event', async () => {
            const termId = await controller.getLastEnsuredTermId()

            const receipt = await registry.activate(requestedAmount, { from })

            assertAmountOfEvents(receipt, REGISTRY_EVENTS.JUROR_DEACTIVATION_PROCESSED)
            assertEvent(receipt, REGISTRY_EVENTS.JUROR_DEACTIVATION_PROCESSED, { juror, amount: deactivationAmount, availableTermId: 1, processedTermId: termId })
          })
        }
      }

      context('when the juror did not activate any tokens yet', () => {
        const itCreatesAnIdForTheJuror = amount => {
          it('creates an id for the given juror', async () => {
            await registry.activate(amount, { from })

            const jurorId = await registry.getJurorId(from)
            assertBn(jurorId, 1, 'juror id does not match')
          })
        }

        context('when the given amount is zero', () => {
          const amount = bn(0)

          itCreatesAnIdForTheJuror(amount)
          itHandlesActivationProperlyFor(amount, maxPossibleBalance)
        })

        context('when the given amount is lower than the minimum active value', () => {
          const amount = MIN_ACTIVE_AMOUNT.sub(bn(1))

          it('reverts', async () => {
            await assertRevert(registry.activate(amount, { from }), REGISTRY_ERRORS.ACTIVE_BALANCE_BELOW_MIN)
          })
        })

        context('when the given amount is greater than the minimum active value without exceeding the limit', () => {
          const amount = MIN_ACTIVE_AMOUNT.add(bn(1))

          itCreatesAnIdForTheJuror(amount)
          itHandlesActivationProperlyFor(amount)
        })

        context('when the given amount is greater than the minimum active value and exceeds the limit', () => {
          const amount = maxPossibleBalance.add(bn(1))

          it('reverts', async () => {
            // max possible balance was already allowed, allowing one more token
            await ANJ.generateTokens(from, 1)
            await ANJ.approveAndCall(registry.address, 1, '0x', { from })

            await assertRevert(registry.activate(amount, { from }), REGISTRY_ERRORS.TOTAL_ACTIVE_BALANCE_EXCEEDED)
          })
        })
      })

      context('when the juror has already activated some tokens', () => {
        const activeBalance = MIN_ACTIVE_AMOUNT

        beforeEach('activate some tokens', async () => {
          await registry.activate(activeBalance, { from })
        })

        context('when the juror does not have a deactivation request', () => {
          context('when the given amount is zero', () => {
            const amount = bn(0)
            const expectedAmount = maxPossibleBalance.sub(activeBalance)

            context('when the juror was not slashed and reaches the minimum active amount of tokens', () => {
              beforeEach('increase term', async () => {
                await controller.mockIncreaseTerm()
              })

              itHandlesActivationProperlyFor(amount, expectedAmount)
            })

            context('when the juror was slashed and reaches the minimum active amount of tokens', () => {
              beforeEach('slash juror', async () => {
                await disputeManager.collect(juror, bigExp(1, 18))
                await controller.mockIncreaseTerm()
              })

              itHandlesActivationProperlyFor(amount, expectedAmount)
            })

            context('when the juror was slashed and does not reach the minimum active amount of tokens', () => {
              beforeEach('slash juror', async () => {
                await disputeManager.collect(juror, activeBalance)
                await registry.unstake(maxPossibleBalance.sub(activeBalance).sub(bn(1)), '0x', { from })
              })

              it('reverts', async () => {
                await assertRevert(registry.activate(amount, { from }), REGISTRY_ERRORS.ACTIVE_BALANCE_BELOW_MIN)
              })
            })
          })

          context('when the given amount is greater than zero', () => {
            const amount = bigExp(2, 18)

            context('when the juror was not slashed and reaches the minimum active amount of tokens', () => {
              beforeEach('increase term', async () => {
                await controller.mockIncreaseTerm()
              })

              itHandlesActivationProperlyFor(amount)
            })

            context('when the juror was slashed and reaches the minimum active amount of tokens', () => {
              beforeEach('slash juror', async () => {
                await disputeManager.collect(juror, amount)
                await controller.mockIncreaseTerm()
              })

              itHandlesActivationProperlyFor(amount)
            })

            context('when the juror was slashed and does not reach the minimum active amount of tokens', () => {
              beforeEach('slash juror', async () => {
                await disputeManager.collect(juror, activeBalance)
              })

              it('reverts', async () => {
                await assertRevert(registry.activate(amount, { from }), REGISTRY_ERRORS.ACTIVE_BALANCE_BELOW_MIN)
              })
            })
          })
        })

        context('when the juror has a full deactivation request', () => {
          const deactivationAmount = activeBalance

          beforeEach('deactivate tokens', async () => {
            await registry.deactivate(activeBalance, { from })
          })

          context('when the deactivation request is for the next term', () => {
            const currentAvailableBalance = maxPossibleBalance.sub(deactivationAmount)

            context('when the given amount is zero', () => {
              const amount = bn(0)

              itHandlesActivationProperlyFor(amount, currentAvailableBalance)
            })

            context('when the given amount is greater than the available balance', () => {
              const amount = currentAvailableBalance.add(bn(1))

              it('reverts', async () => {
                await assertRevert(registry.activate(amount, { from }), REGISTRY_ERRORS.INVALID_ACTIVATION_AMOUNT)
              })
            })

            context('when the future active amount will be lower than the minimum active value', () => {
              const amount = MIN_ACTIVE_AMOUNT.sub(bn(1))

              it('reverts', async () => {
                await assertRevert(registry.activate(amount, { from }), REGISTRY_ERRORS.ACTIVE_BALANCE_BELOW_MIN)
              })
            })

            context('when the future active amount will be greater than the minimum active value', () => {
              const amount = MIN_ACTIVE_AMOUNT

              itHandlesActivationProperlyFor(amount)
            })
          })

          context('when the deactivation request is for the current term', () => {
            const currentAvailableBalance = maxPossibleBalance.sub(activeBalance).add(deactivationAmount)

            beforeEach('increment term', async () => {
              await controller.mockIncreaseTerm()
            })

            context('when the given amount is zero', () => {
              const amount = bn(0)

              itHandlesActivationProperlyFor(amount, currentAvailableBalance, deactivationAmount)
            })

            context('when the given amount is greater than the available balance', () => {
              const amount = currentAvailableBalance.add(bn(1))

              it('reverts', async () => {
                await assertRevert(registry.activate(amount, { from }), REGISTRY_ERRORS.INVALID_ACTIVATION_AMOUNT)
              })
            })

            context('when the future active amount will be lower than the minimum active value', () => {
              const amount = MIN_ACTIVE_AMOUNT.sub(bn(1))

              it('reverts', async () => {
                await assertRevert(registry.activate(amount, { from }), REGISTRY_ERRORS.ACTIVE_BALANCE_BELOW_MIN)
              })
            })

            context('when the future active amount will be greater than the minimum active value', () => {
              const amount = MIN_ACTIVE_AMOUNT

              itHandlesActivationProperlyFor(amount, amount, deactivationAmount)
            })
          })

          context('when the deactivation request is for the previous term', () => {
            const currentAvailableBalance = maxPossibleBalance.sub(activeBalance).add(deactivationAmount)

            beforeEach('increment term twice', async () => {
              await controller.mockIncreaseTerm()
              await controller.mockIncreaseTerm()
            })

            context('when the given amount is zero', () => {
              const amount = bn(0)

              itHandlesActivationProperlyFor(amount, currentAvailableBalance, deactivationAmount)
            })

            context('when the given amount is greater than the available balance', () => {
              const amount = currentAvailableBalance.add(bn(1))

              it('reverts', async () => {
                await assertRevert(registry.activate(amount, { from }), REGISTRY_ERRORS.INVALID_ACTIVATION_AMOUNT)
              })
            })

            context('when the future active amount will be lower than the minimum active value', () => {
              const amount = MIN_ACTIVE_AMOUNT.sub(bn(1))

              it('reverts', async () => {
                await assertRevert(registry.activate(amount, { from }), REGISTRY_ERRORS.ACTIVE_BALANCE_BELOW_MIN)
              })
            })

            context('when the future active amount will be greater than the minimum active value', () => {
              const amount = MIN_ACTIVE_AMOUNT

              itHandlesActivationProperlyFor(amount, amount, deactivationAmount)
            })
          })
        })
      })
    })
  })

  describe('deactivate',  () => {
    const from = juror

    const itRevertsForDifferentAmounts = () => {
      context('when the requested amount is zero', () => {
        const amount = bn(0)

        it('reverts', async () => {
          await assertRevert(registry.deactivate(amount, { from }), REGISTRY_ERRORS.INVALID_ZERO_AMOUNT)
        })
      })

      context('when the requested amount is lower than the minimum active value', () => {
        const amount = MIN_ACTIVE_AMOUNT.sub(bn(1))

        it('reverts', async () => {
          await assertRevert(registry.deactivate(amount, { from }), REGISTRY_ERRORS.INVALID_DEACTIVATION_AMOUNT)
        })
      })

      context('when the requested amount is greater than the minimum active value', () => {
        const amount = MIN_ACTIVE_AMOUNT.mul(bn(2))

        it('reverts', async () => {
          await assertRevert(registry.deactivate(amount, { from }), REGISTRY_ERRORS.INVALID_DEACTIVATION_AMOUNT)
        })
      })
    }

    context('when the juror has not staked some tokens yet', () => {
      itRevertsForDifferentAmounts()
    })

    context('when the juror has already staked some tokens', () => {
      const stakedBalance = MIN_ACTIVE_AMOUNT.mul(bn(5))

      beforeEach('stake some tokens', async () => {
        await ANJ.generateTokens(from, stakedBalance)
        await ANJ.approveAndCall(registry.address, stakedBalance, '0x', { from })
      })

      context('when the juror did not activate any tokens yet', () => {
        itRevertsForDifferentAmounts()
      })

      context('when the juror has already activated some tokens', () => {
        const activeBalance = MIN_ACTIVE_AMOUNT.mul(bn(4))

        beforeEach('activate some tokens', async () => {
          await registry.activate(activeBalance, { from })
        })

        const itHandlesDeactivationRequestFor = (requestedAmount, expectedAmount = requestedAmount, previousDeactivationAmount = bn(0)) => {
          it('decreases the active balance and increases the deactivation balance of the juror', async () => {
            const { active: previousActiveBalance, available: previousAvailableBalance, locked: previousLockedBalance, pendingDeactivation: previousDeactivationBalance } = await registry.balanceOf(juror)

            await registry.deactivate(requestedAmount, { from })

            const { active: currentActiveBalance, available: currentAvailableBalance, locked: currentLockedBalance, pendingDeactivation: currentDeactivationBalance } = await registry.balanceOf(juror)

            const expectedActiveBalance = previousActiveBalance.sub(expectedAmount)
            assertBn(currentActiveBalance, expectedActiveBalance, 'active balances do not match')

            const expectedAvailableBalance = previousAvailableBalance.add(previousDeactivationAmount)
            assertBn(currentAvailableBalance, expectedAvailableBalance, 'available balances do not match')

            const expectedDeactivationBalance = previousDeactivationBalance.add(expectedAmount).sub(previousDeactivationAmount)
            assertBn(currentDeactivationBalance, expectedDeactivationBalance, 'deactivation balances do not match')

            assertBn(currentLockedBalance, previousLockedBalance, 'locked balances do not match')
          })

          it('does not affect the active balance of the current term', async () => {
            const termId = await controller.getLastEnsuredTermId()
            const currentTermPreviousBalance = await registry.activeBalanceOfAt(juror, termId)

            await registry.deactivate(requestedAmount, { from })

            const currentTermCurrentBalance = await registry.activeBalanceOfAt(juror, termId)
            assertBn(currentTermCurrentBalance, currentTermPreviousBalance, 'current term active balances do not match')
          })

          it('decreases the unlocked balance of the juror', async () => {
            await controller.mockIncreaseTerm()
            const previousUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(juror)

            await registry.deactivate(requestedAmount, { from })

            await controller.mockIncreaseTerm()
            const currentUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(juror)
            assertBn(currentUnlockedActiveBalance, previousUnlockedActiveBalance.sub(expectedAmount), 'unlocked balances do not match')
          })

          it('does not affect the staked balance of the juror', async () => {
            const previousTotalStake = await registry.totalStaked()
            const previousJurorStake = await registry.totalStakedFor(juror)

            await registry.deactivate(requestedAmount, { from })

            const currentTotalStake = await registry.totalStaked()
            assertBn(currentTotalStake, previousTotalStake, 'total stake amounts do not match')

            const currentJurorStake = await registry.totalStakedFor(juror)
            assertBn(currentJurorStake, previousJurorStake, 'juror stake amounts do not match')
          })

          it('does not affect the token balances', async () => {
            const previousJurorBalance = await ANJ.balanceOf(from)
            const previousRegistryBalance = await ANJ.balanceOf(registry.address)

            await registry.deactivate(requestedAmount, { from })

            const currentSenderBalance = await ANJ.balanceOf(from)
            assertBn(currentSenderBalance, previousJurorBalance, 'juror balances do not match')

            const currentRegistryBalance = await ANJ.balanceOf(registry.address)
            assertBn(currentRegistryBalance, previousRegistryBalance, 'registry balances do not match')
          })

          it('emits a deactivation request created event', async () => {
            const termId = await controller.getLastEnsuredTermId()
            const receipt = await registry.deactivate(requestedAmount, { from })

            assertAmountOfEvents(receipt, REGISTRY_EVENTS.JUROR_DEACTIVATION_REQUESTED)
            assertEvent(receipt, REGISTRY_EVENTS.JUROR_DEACTIVATION_REQUESTED, { juror: from, availableTermId: termId.add(bn(1)), amount: expectedAmount })
          })

          it('can be requested at the next term', async () => {
            const { active: previousActiveBalance, available: previousAvailableBalance, pendingDeactivation: previousDeactivationBalance } = await registry.balanceOf(juror)

            await registry.deactivate(requestedAmount, { from })
            await controller.mockIncreaseTerm()
            await registry.processDeactivationRequest(from)

            const { active: currentActiveBalance, available: currentAvailableBalance, pendingDeactivation: currentDeactivationBalance } = await registry.balanceOf(juror)

            const expectedActiveBalance = previousActiveBalance.sub(expectedAmount)
            assertBn(currentActiveBalance, expectedActiveBalance, 'active balances do not match')

            const expectedAvailableBalance = previousAvailableBalance.add(previousDeactivationBalance).add(expectedAmount)
            assertBn(currentAvailableBalance, expectedAvailableBalance, 'available balances do not match')

            assertBn(currentDeactivationBalance, 0, 'deactivation balances do not match')
          })

          if (!previousDeactivationAmount.eq(bn(0))) {
            it('emits an available balance changed event', async () => {
              const receipt = await registry.deactivate(requestedAmount, { from })

              assertAmountOfEvents(receipt, REGISTRY_EVENTS.JUROR_AVAILABLE_BALANCE_CHANGED)
              assertEvent(receipt, REGISTRY_EVENTS.JUROR_AVAILABLE_BALANCE_CHANGED, { juror, amount: previousDeactivationAmount, positive: true })
            })

            it('emits a deactivation processed event', async () => {
              const termId = await controller.getLastEnsuredTermId()

              const receipt = await registry.deactivate(requestedAmount, { from })

              assertAmountOfEvents(receipt, REGISTRY_EVENTS.JUROR_DEACTIVATION_PROCESSED)
              assertEvent(receipt, REGISTRY_EVENTS.JUROR_DEACTIVATION_PROCESSED, { juror, amount: previousDeactivationAmount, availableTermId: 1, processedTermId: termId })
            })
          }
        }

        context('when the juror does not have a deactivation request', () => {
          context('when the requested amount is zero', () => {
            const amount = bn(0)

            itHandlesDeactivationRequestFor(amount, activeBalance)
          })

          context('when the requested amount will make the active balance to be below the minimum active value', () => {
            const amount = activeBalance.sub(MIN_ACTIVE_AMOUNT).add(bn(1))

            it('reverts', async () => {
              await assertRevert(registry.deactivate(amount, { from }), REGISTRY_ERRORS.INVALID_DEACTIVATION_AMOUNT)
            })
          })

          context('when the requested amount will make the active balance to be above the minimum active value', () => {
            const amount = activeBalance.sub(MIN_ACTIVE_AMOUNT).sub(bn(1))

            itHandlesDeactivationRequestFor(amount)
          })

          context('when the requested amount will make the active balance to be zero', () => {
            const amount = activeBalance

            itHandlesDeactivationRequestFor(amount)
          })
        })

        context('when the juror already has a previous deactivation request', () => {
          const previousDeactivationAmount = MIN_ACTIVE_AMOUNT
          const currentActiveBalance = activeBalance.sub(previousDeactivationAmount)

          beforeEach('deactivate tokens', async () => {
            await registry.deactivate(previousDeactivationAmount, { from })
          })

          context('when the deactivation request is for the next term', () => {
            context('when the requested amount is zero', () => {
              const amount = bn(0)

              itHandlesDeactivationRequestFor(amount, currentActiveBalance)
            })

            context('when the requested amount will make the active balance to be below the minimum active value', () => {
              const amount = currentActiveBalance.sub(MIN_ACTIVE_AMOUNT).add(bn(1))

              it('reverts', async () => {
                await assertRevert(registry.deactivate(amount, { from }), REGISTRY_ERRORS.INVALID_DEACTIVATION_AMOUNT)
              })
            })

            context('when the requested amount will make the active balance to be above the minimum active value', () => {
              const amount = currentActiveBalance.sub(MIN_ACTIVE_AMOUNT).sub(bn(1))

              itHandlesDeactivationRequestFor(amount, amount)
            })

            context('when the requested amount will make the active balance to be zero', () => {
              const amount = currentActiveBalance

              itHandlesDeactivationRequestFor(amount, amount)
            })
          })

          context('when the deactivation request is for the current term', () => {
            beforeEach('increment term', async () => {
              await controller.mockIncreaseTerm()
            })

            context('when the requested amount is zero', () => {
              const amount = bn(0)

              itHandlesDeactivationRequestFor(amount, currentActiveBalance, previousDeactivationAmount)
            })

            context('when the requested amount will make the active balance to be below the minimum active value', () => {
              const amount = currentActiveBalance.sub(MIN_ACTIVE_AMOUNT).add(bn(1))

              it('reverts', async () => {
                await assertRevert(registry.deactivate(amount, { from }), REGISTRY_ERRORS.INVALID_DEACTIVATION_AMOUNT)
              })
            })

            context('when the requested amount will make the active balance to be above the minimum active value', () => {
              const amount = currentActiveBalance.sub(MIN_ACTIVE_AMOUNT).sub(bn(1))

              itHandlesDeactivationRequestFor(amount, amount, previousDeactivationAmount)
            })

            context('when the requested amount will make the active balance be zero', () => {
              const amount = currentActiveBalance

              itHandlesDeactivationRequestFor(amount, amount, previousDeactivationAmount)
            })
          })

          context('when the deactivation request is for the previous term', () => {
            beforeEach('increment term twice', async () => {
              await controller.mockIncreaseTerm()
              await controller.mockIncreaseTerm()
            })

            context('when the requested amount is zero', () => {
              const amount = bn(0)

              itHandlesDeactivationRequestFor(amount, currentActiveBalance, previousDeactivationAmount)
            })

            context('when the requested amount will make the active balance to be below the minimum active value', () => {
              const amount = currentActiveBalance.sub(MIN_ACTIVE_AMOUNT).add(bn(1))

              it('reverts', async () => {
                await assertRevert(registry.deactivate(amount, { from }), REGISTRY_ERRORS.INVALID_DEACTIVATION_AMOUNT)
              })
            })

            context('when the requested amount will make the active balance to be above the minimum active value', () => {
              const amount = currentActiveBalance.sub(MIN_ACTIVE_AMOUNT).sub(bn(1))

              itHandlesDeactivationRequestFor(amount, amount, previousDeactivationAmount)
            })

            context('when the requested amount will make the active balance be zero', () => {
              const amount = currentActiveBalance

              itHandlesDeactivationRequestFor(amount, amount, previousDeactivationAmount)
            })
          })
        })
      })
    })
  })
})
