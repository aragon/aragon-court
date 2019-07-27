const { bigExp } = require('../helpers/numbers')(web3)
const { assertRevert } = require('@aragon/test-helpers/assertThrow')
const { assertEvent, assertAmountOfEvents } = require('@aragon/test-helpers/assertEvent')(web3)

const JurorsRegistry = artifacts.require('JurorsRegistry')
const MiniMeToken = artifacts.require('MiniMeToken')
const JurorsRegistryOwnerMock = artifacts.require('JurorsRegistryOwnerMock')

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

contract('JurorsRegistry activation', ([_, juror]) => {
  let registry, registryOwner, ANJ

  const MIN_ACTIVE_TOKENS = bigExp(100, 18)

  beforeEach('create base contracts', async () => {
    registry = await JurorsRegistry.new()
    registryOwner = await JurorsRegistryOwnerMock.new(registry.address)
    ANJ = await MiniMeToken.new(ZERO_ADDRESS, ZERO_ADDRESS, 0, 'n', 18, 'ANJ', true)
  })

  describe('activate', () => {
    const from = juror

    context('when the registry is initialized', () => {
      beforeEach('initialize registry', async () => {
        await registry.init(registryOwner.address, ANJ.address, MIN_ACTIVE_TOKENS)
      })

      context('when the juror has not staked some tokens yet', () => {
        context('when the given amount is zero', () => {
          const amount = 0

          it('reverts', async () => {
            await assertRevert(registry.activate(amount, { from }), 'REGISTRY_INVALID_ZERO_AMOUNT')
          })
        })

        context('when the given amount is lower than the minimum active value', () => {
          const amount = MIN_ACTIVE_TOKENS.sub(1)

          it('reverts', async () => {
            await assertRevert(registry.activate(amount, { from }), 'REGISTRY_INVALID_ACTIVATION_AMOUNT')
          })
        })

        context('when the given amount is greater than the minimum active value', () => {
          const amount = MIN_ACTIVE_TOKENS.times(2)

          it('reverts', async () => {
            await assertRevert(registry.activate(amount, { from }), 'REGISTRY_INVALID_ACTIVATION_AMOUNT')
          })
        })
      })

      context('when the juror has already staked some tokens', () => {
        const stakedBalance = MIN_ACTIVE_TOKENS.times(3)

        beforeEach('stake some tokens', async () => {
          await ANJ.generateTokens(from, stakedBalance)
          await ANJ.approveAndCall(registry.address, stakedBalance, '0x', { from })
        })

        const itHandlesActivationProperlyFor = (requestedAmount, expectedAmount = requestedAmount, deactivationAmount = 0) => {
          it('adds the requested amount to the active balance of the juror and removes it from the available balance', async () => {
            const [previousActiveBalance, previousAvailableBalance, previousLockedBalance, previousDeactivationBalance] = await registry.balanceOf(juror)

            await registry.activate(requestedAmount, { from })

            const [currentActiveBalance, currentAvailableBalance, currentLockedBalance, currentDeactivationBalance] = await registry.balanceOf(juror)
            assert.equal(previousLockedBalance.toString(), currentLockedBalance.toString(), 'locked balances do not match')

            assert.equal(previousActiveBalance.plus(expectedAmount).toString(), currentActiveBalance.toString(), 'active balances do not match')
            assert.equal(previousDeactivationBalance.minus(deactivationAmount).toString(), currentDeactivationBalance.toString(), 'deactivation balances do not match')
            assert.equal(previousAvailableBalance.minus(expectedAmount.minus(deactivationAmount)).toString(), currentAvailableBalance.toString(), 'available balances do not match')
          })

          it('increments the unlocked balance of the juror', async () => {
            const previousUnlockedBalance = await registry.unlockedBalanceOf(juror)

            await registry.activate(requestedAmount, { from })

            const currentUnlockedBalance = await registry.unlockedBalanceOf(juror)
            assert.equal(previousUnlockedBalance.plus(expectedAmount).toString(), currentUnlockedBalance.toString(), 'unlocked balances do not match')
          })

          it('does not affect the staked balances', async () => {
            const previousTotalStake = await registry.totalStaked()
            const previousJurorStake = await registry.totalStakedFor(juror)

            await registry.activate(requestedAmount, { from })

            const currentTotalStake = await registry.totalStaked()
            assert.equal(previousTotalStake.toString(), currentTotalStake.toString(), 'total stake amounts do not match')

            const currentJurorStake = await registry.totalStakedFor(juror)
            assert.equal(previousJurorStake.toString(), currentJurorStake.toString(), 'juror stake amounts do not match')
          })

          it('does not affect the token balances', async () => {
            const previousJurorBalance = await ANJ.balanceOf(from)
            const previousRegistryBalance = await ANJ.balanceOf(registry.address)

            await registry.activate(requestedAmount, { from })

            const currentSenderBalance = await ANJ.balanceOf(from)
            assert.equal(previousJurorBalance.toString(), currentSenderBalance.toString(), 'juror balances do not match')

            const currentRegistryBalance = await ANJ.balanceOf(registry.address)
            assert.equal(previousRegistryBalance.toString(), currentRegistryBalance.toString(), 'registry balances do not match')
          })

          it('emits an activation event', async () => {
            const termId = await registryOwner.getTermId()

            const receipt = await registry.activate(requestedAmount, { from })

            assertAmountOfEvents(receipt, 'JurorActivated')
            assertEvent(receipt, 'JurorActivated', { juror, fromTermId: termId.plus(1), amount: expectedAmount })
          })

          if (deactivationAmount === 0) {
            it('emits two available balance changed events', async () => {
              const receipt = await registry.activate(requestedAmount, { from })

              assertAmountOfEvents(receipt, 'JurorAvailableBalanceChanged')
              assertEvent(receipt, 'JurorAvailableBalanceChanged', { juror, amount: expectedAmount, positive: false })
            })
          } else {
            it('emits two available balance changed events', async () => {
              const receipt = await registry.activate(requestedAmount, { from })

              assertAmountOfEvents(receipt, 'JurorAvailableBalanceChanged', 2)
              assertEvent(receipt, 'JurorAvailableBalanceChanged', { juror, amount: deactivationAmount, positive: true }, 0)
              assertEvent(receipt, 'JurorAvailableBalanceChanged', { juror, amount: expectedAmount, positive: false }, 1)
            })

            it('emits a deactivation processed event', async () => {
              const termId = await registryOwner.getTermId()

              const receipt = await registry.activate(requestedAmount, { from })

              assertAmountOfEvents(receipt, 'JurorDeactivationProcessed')
              assertEvent(receipt, 'JurorDeactivationProcessed', { juror, amount: deactivationAmount, availableTermId: 1, processedTermId: termId })
            })
          }
        }

        context('when the juror did not activate any tokens yet', () => {

          const itCreatesAnIdForTheJuror = amount => {
            it('creates an id for the given juror', async () => {
              await registry.activate(amount, { from })

              const jurorId = await registry.jurorId(from)
              assert.equal(jurorId.toString(), 1, 'juror id does not match')
            })
          }

          context('when the given amount is zero', () => {
            const amount = 0

            itCreatesAnIdForTheJuror(amount)
            itHandlesActivationProperlyFor(amount, stakedBalance)
          })

          context('when the given amount is lower than the minimum active value', () => {
            const amount = MIN_ACTIVE_TOKENS.sub(1)

            it('reverts', async () => {
              await assertRevert(registry.activate(amount, { from }), 'REGISTRY_TOKENS_BELOW_MIN_STAKE')
            })
          })

          context('when the given amount is greater than the minimum active value', () => {
            const amount = MIN_ACTIVE_TOKENS.plus(1)

            itCreatesAnIdForTheJuror(amount)
            itHandlesActivationProperlyFor(amount)
          })
        })

        context('when the juror has already activated some tokens', () => {
          const activeBalance = MIN_ACTIVE_TOKENS

          beforeEach('activate some tokens', async () => {
            await registry.activate(activeBalance, { from })
          })

          context('when the juror does not have a deactivation request', () => {
            context('when the given amount is zero', () => {
              const amount = 0
              const expectedAmount = stakedBalance.minus(activeBalance)

              context('when the juror was not slash and reaches the minimum active amount of tokens', () => {
                itHandlesActivationProperlyFor(amount, expectedAmount)
              })

              context('when the juror was slashed and reaches the minimum active amount of tokens', () => {
                beforeEach('slash juror', async () => {
                  await registryOwner.collect(juror, bigExp(1, 18))
                })

                itHandlesActivationProperlyFor(amount, expectedAmount)
              })

              context('when the juror was slashed and does not reach the minimum active amount of tokens', () => {
                beforeEach('slash juror', async () => {
                  await registryOwner.collect(juror, activeBalance)
                  await registry.unstake(stakedBalance.minus(activeBalance).minus(1), '0x', { from })
                })

                it('reverts', async () => {
                  await assertRevert(registry.activate(amount, { from }), 'REGISTRY_TOKENS_BELOW_MIN_STAKE')
                })
              })
            })

            context('when the given amount is greater than zero', () => {
              const amount = bigExp(1, 18)

              context('when the juror was not slash and reaches the minimum active amount of tokens', () => {
                itHandlesActivationProperlyFor(amount)
              })

              context('when the juror was slashed and reaches the minimum active amount of tokens', () => {
                beforeEach('slash juror', async () => {
                  await registryOwner.collect(juror, amount)
                })

                itHandlesActivationProperlyFor(amount)
              })

              context('when the juror was slashed and does not reach the minimum active amount of tokens', () => {
                beforeEach('slash juror', async () => {
                  await registryOwner.collect(juror, activeBalance)
                })

                it('reverts', async () => {
                  await assertRevert(registry.activate(amount, { from }), 'REGISTRY_TOKENS_BELOW_MIN_STAKE')
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
              const currentAvailableBalance = stakedBalance.minus(deactivationAmount)

              context('when the given amount is zero', () => {
                const amount = 0

                itHandlesActivationProperlyFor(amount, currentAvailableBalance)
              })

              context('when the given amount is greater than the available balance', () => {
                const amount = currentAvailableBalance.plus(1)

                it('reverts', async () => {
                  await assertRevert(registry.activate(amount, { from }), 'REGISTRY_INVALID_ACTIVATION_AMOUNT')
                })
              })

              context('when the future active amount will be lower than the minimum active value', () => {
                const amount = MIN_ACTIVE_TOKENS.sub(1)

                it('reverts', async () => {
                  await assertRevert(registry.activate(amount, { from }), 'REGISTRY_TOKENS_BELOW_MIN_STAKE')
                })
              })

              context('when the future active amount will be greater than the minimum active value', () => {
                const amount = MIN_ACTIVE_TOKENS

                itHandlesActivationProperlyFor(amount)
              })
            })

            context('when the deactivation request is for the current term', () => {
              const currentAvailableBalance = stakedBalance.minus(activeBalance).plus(deactivationAmount)

              beforeEach('increment term', async () => {
                await registryOwner.incrementTerm()
              })

              context('when the given amount is zero', () => {
                const amount = 0

                itHandlesActivationProperlyFor(amount, currentAvailableBalance, deactivationAmount)
              })

              context('when the given amount is greater than the available balance', () => {
                const amount = currentAvailableBalance.plus(1)

                it('reverts', async () => {
                  await assertRevert(registry.activate(amount, { from }), 'REGISTRY_INVALID_ACTIVATION_AMOUNT')
                })
              })

              context('when the future active amount will be lower than the minimum active value', () => {
                const amount = MIN_ACTIVE_TOKENS.sub(1)

                it('reverts', async () => {
                  await assertRevert(registry.activate(amount, { from }), 'REGISTRY_TOKENS_BELOW_MIN_STAKE')
                })
              })

              context('when the future active amount will be greater than the minimum active value', () => {
                const amount = MIN_ACTIVE_TOKENS

                itHandlesActivationProperlyFor(amount, amount, deactivationAmount)
              })
            })

            context('when the deactivation request is for the previous term', () => {
              const currentAvailableBalance = stakedBalance.minus(activeBalance).plus(deactivationAmount)

              beforeEach('increment term twice', async () => {
                await registryOwner.incrementTerm()
                await registryOwner.incrementTerm()
              })

              context('when the given amount is zero', () => {
                const amount = 0

                itHandlesActivationProperlyFor(amount, currentAvailableBalance, deactivationAmount)
              })

              context('when the given amount is greater than the available balance', () => {
                const amount = currentAvailableBalance.plus(1)

                it('reverts', async () => {
                  await assertRevert(registry.activate(amount, { from }), 'REGISTRY_INVALID_ACTIVATION_AMOUNT')
                })
              })

              context('when the future active amount will be lower than the minimum active value', () => {
                const amount = MIN_ACTIVE_TOKENS.sub(1)

                it('reverts', async () => {
                  await assertRevert(registry.activate(amount, { from }), 'REGISTRY_TOKENS_BELOW_MIN_STAKE')
                })
              })

              context('when the future active amount will be greater than the minimum active value', () => {
                const amount = MIN_ACTIVE_TOKENS

                itHandlesActivationProperlyFor(amount, amount, deactivationAmount)
              })
            })
          })
        })
      })
    })

    context('when the registry is not initialized', () => {
      it('reverts', async () => {
        await assertRevert(registry.activate(bigExp(100, 18), { from }), 'INIT_NOT_INITIALIZED')
      })
    })
  })

  describe('deactivate',  () => {
    const from = juror

    context('when the registry is initialized', () => {
      beforeEach('initialize registry', async () => {
        await registry.init(registryOwner.address, ANJ.address, MIN_ACTIVE_TOKENS)
      })

      const itRevertsForDifferentAmounts = () => {
        context('when the requested amount is zero', () => {
          const amount = 0

          it('reverts', async () => {
            await assertRevert(registry.deactivate(amount, { from }), 'REGISTRY_INVALID_ZERO_AMOUNT')
          })
        })

        context('when the requested amount is lower than the minimum active value', () => {
          const amount = MIN_ACTIVE_TOKENS.sub(1)

          it('reverts', async () => {
            await assertRevert(registry.deactivate(amount, { from }), 'REGISTRY_INVALID_DEACTIVATION_AMOUNT')
          })
        })

        context('when the requested amount is greater than the minimum active value', () => {
          const amount = MIN_ACTIVE_TOKENS.times(2)

          it('reverts', async () => {
            await assertRevert(registry.deactivate(amount, { from }), 'REGISTRY_INVALID_DEACTIVATION_AMOUNT')
          })
        })
      }

      context('when the juror has not staked some tokens yet', () => {
        itRevertsForDifferentAmounts()
      })

      context('when the juror has already staked some tokens', () => {
        const stakedBalance = MIN_ACTIVE_TOKENS.times(5)

        beforeEach('stake some tokens', async () => {
          await ANJ.generateTokens(from, stakedBalance)
          await ANJ.approveAndCall(registry.address, stakedBalance, '0x', { from })
        })

        context('when the juror did not activate any tokens yet', () => {
          itRevertsForDifferentAmounts()
        })

        context('when the juror has already activated some tokens', () => {
          const activeBalance = MIN_ACTIVE_TOKENS.times(4)

          beforeEach('activate some tokens', async () => {
            await registry.activate(activeBalance, { from })
          })

          const itHandlesDeactivationRequestFor = (amount, previousDeactivationAmount = 0) => {
            it('decreases the active balance and increases the deactivation balance of the juror', async () => {
              const [previousActiveBalance, previousAvailableBalance, previousLockedBalance, previousDeactivationBalance] = await registry.balanceOf(juror)

              await registry.deactivate(amount, { from })

              const [currentActiveBalance, currentAvailableBalance, currentLockedBalance, currentDeactivationBalance] = await registry.balanceOf(juror)
              assert.equal(previousActiveBalance.minus(amount).toString(), currentActiveBalance.toString(), 'active balances do not match')
              assert.equal(previousAvailableBalance.plus(previousDeactivationAmount).toString(), currentAvailableBalance.toString(), 'available balances do not match')
              assert.equal(previousDeactivationBalance.plus(amount).minus(previousDeactivationAmount).toString(), currentDeactivationBalance.toString(), 'deactivation balances do not match')

              assert.equal(previousLockedBalance.toString(), currentLockedBalance.toString(), 'locked balances do not match')
            })

            it('decreases the unlocked balance of the juror', async () => {
              const previousUnlockedBalance = await registry.unlockedBalanceOf(juror)

              await registry.deactivate(amount, { from })

              const currentUnlockedBalance = await registry.unlockedBalanceOf(juror)
              assert.equal(previousUnlockedBalance.minus(amount).toString(), currentUnlockedBalance.toString(), 'unlocked balances do not match')
            })

            it('does not affect the staked balance of the juror', async () => {
              const previousTotalStake = await registry.totalStaked()
              const previousJurorStake = await registry.totalStakedFor(juror)

              await registry.deactivate(amount, { from })

              const currentTotalStake = await registry.totalStaked()
              assert.equal(previousTotalStake.toString(), currentTotalStake.toString(), 'total stake amounts do not match')

              const currentJurorStake = await registry.totalStakedFor(juror)
              assert.equal(previousJurorStake.toString(), currentJurorStake.toString(), 'juror stake amounts do not match')
            })

            it('does not affect the token balances', async () => {
              const previousJurorBalance = await ANJ.balanceOf(from)
              const previousRegistryBalance = await ANJ.balanceOf(registry.address)

              await registry.deactivate(amount, { from })

              const currentSenderBalance = await ANJ.balanceOf(from)
              assert.equal(previousJurorBalance.toString(), currentSenderBalance.toString(), 'juror balances do not match')

              const currentRegistryBalance = await ANJ.balanceOf(registry.address)
              assert.equal(previousRegistryBalance.toString(), currentRegistryBalance.toString(), 'registry balances do not match')
            })

            it('emits a deactivation request created event', async () => {
              const termId = await registryOwner.getTermId()
              const receipt = await registry.deactivate(amount, { from })

              assertAmountOfEvents(receipt, 'JurorDeactivationRequested')
              assertEvent(receipt, 'JurorDeactivationRequested', { juror: from, availableTermId: termId.plus(1), amount })
            })

            if (previousDeactivationAmount !== 0) {
              it('emits an available balance changed event', async () => {
                const receipt = await registry.deactivate(amount, { from })

                assertAmountOfEvents(receipt, 'JurorAvailableBalanceChanged')
                assertEvent(receipt, 'JurorAvailableBalanceChanged', { juror, amount: previousDeactivationAmount, positive: true })
              })

              it('emits a deactivation processed event', async () => {
                const termId = await registryOwner.getTermId()

                const receipt = await registry.deactivate(amount, { from })

                assertAmountOfEvents(receipt, 'JurorDeactivationProcessed')
                assertEvent(receipt, 'JurorDeactivationProcessed', { juror, amount: previousDeactivationAmount, availableTermId: 1, processedTermId: termId })
              })
            }
          }

          context('when the juror does not have a deactivation request', () => {
            context('when the requested amount is zero', () => {
              const amount = 0

              it('reverts', async () => {
                await assertRevert(registry.deactivate(amount, { from }), 'REGISTRY_INVALID_ZERO_AMOUNT')
              })
            })

            context('when the requested amount will make the active balance to be below the minimum active value', () => {
              const amount = activeBalance.minus(MIN_ACTIVE_TOKENS).plus(1)

              it('reverts', async () => {
                await assertRevert(registry.deactivate(amount, { from }), 'REGISTRY_INVALID_DEACTIVATION_AMOUNT')
              })
            })

            context('when the requested amount will make the active balance to be above the minimum active value', () => {
              const amount = activeBalance.minus(MIN_ACTIVE_TOKENS).minus(1)

              itHandlesDeactivationRequestFor(amount)
            })

            context('when the requested amount will make the active balance to be zero', () => {
              const amount = activeBalance

              itHandlesDeactivationRequestFor(amount)
            })
          })

          context('when the juror already has a previous deactivation request', () => {
            const previousDeactivationAmount = MIN_ACTIVE_TOKENS
            const currentActiveBalance = activeBalance.minus(previousDeactivationAmount)

            beforeEach('deactivate tokens', async () => {
              await registry.deactivate(previousDeactivationAmount, { from })
            })

            context('when the deactivation request is for the next term', () => {
              context('when the requested amount is zero', () => {
                const amount = 0

                it('reverts', async () => {
                  await assertRevert(registry.deactivate(amount, { from }), 'REGISTRY_INVALID_ZERO_AMOUNT')
                })
              })

              context('when the requested amount will make the active balance to be below the minimum active value', () => {
                const amount = currentActiveBalance.minus(MIN_ACTIVE_TOKENS).plus(1)

                it('reverts', async () => {
                  await assertRevert(registry.deactivate(amount, { from }), 'REGISTRY_INVALID_DEACTIVATION_AMOUNT')
                })
              })

              context('when the requested amount will make the active balance to be above the minimum active value', () => {
                const amount = currentActiveBalance.minus(MIN_ACTIVE_TOKENS).minus(1)

                itHandlesDeactivationRequestFor(amount)
              })

              context('when the requested amount will make the active balance to be zero', () => {
                const amount = currentActiveBalance

                itHandlesDeactivationRequestFor(amount)
              })
            })

            context('when the deactivation request is for the current term', () => {
              beforeEach('increment term', async () => {
                await registryOwner.incrementTerm()
              })

              context('when the requested amount is zero', () => {
                const amount = 0

                it('reverts', async () => {
                  await assertRevert(registry.deactivate(amount, { from }), 'REGISTRY_INVALID_ZERO_AMOUNT')
                })
              })

              context('when the requested amount will make the active balance to be below the minimum active value', () => {
                const amount = currentActiveBalance.minus(MIN_ACTIVE_TOKENS).plus(1)

                it('reverts', async () => {
                  await assertRevert(registry.deactivate(amount, { from }), 'REGISTRY_INVALID_DEACTIVATION_AMOUNT')
                })
              })

              context('when the requested amount will make the active balance to be above the minimum active value', () => {
                const amount = currentActiveBalance.minus(MIN_ACTIVE_TOKENS).minus(1)

                itHandlesDeactivationRequestFor(amount, previousDeactivationAmount)
              })

              context('when the requested amount will make the active balance be zero', () => {
                const amount = currentActiveBalance

                itHandlesDeactivationRequestFor(amount, previousDeactivationAmount)
              })
            })

            context('when the deactivation request is for the previous term', () => {
              beforeEach('increment term twice', async () => {
                await registryOwner.incrementTerm()
                await registryOwner.incrementTerm()
              })

              context('when the requested amount is zero', () => {
                const amount = 0

                it('reverts', async () => {
                  await assertRevert(registry.deactivate(amount, { from }), 'REGISTRY_INVALID_ZERO_AMOUNT')
                })
              })

              context('when the requested amount will make the active balance to be below the minimum active value', () => {
                const amount = currentActiveBalance.minus(MIN_ACTIVE_TOKENS).plus(1)

                it('reverts', async () => {
                  await assertRevert(registry.deactivate(amount, { from }), 'REGISTRY_INVALID_DEACTIVATION_AMOUNT')
                })
              })

              context('when the requested amount will make the active balance to be above the minimum active value', () => {
                const amount = currentActiveBalance.minus(MIN_ACTIVE_TOKENS).minus(1)

                itHandlesDeactivationRequestFor(amount, previousDeactivationAmount)
              })

              context('when the requested amount will make the active balance be zero', () => {
                const amount = currentActiveBalance

                itHandlesDeactivationRequestFor(amount, previousDeactivationAmount)
              })
            })
          })
        })
      })
    })

    context('when the registry is not initialized', () => {
      it('reverts', async () => {
        await assertRevert(registry.deactivate(bigExp(100, 18), { from }), 'INIT_NOT_INITIALIZED')
      })
    })
  })
})
