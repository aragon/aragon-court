const { bn, bigExp } = require('../helpers/numbers')
const { assertRevert } = require('../helpers/assertThrow')
const { assertEvent, assertAmountOfEvents } = require('../helpers/assertEvent')

const JurorsRegistry = artifacts.require('JurorsRegistry')
const ERC20 = artifacts.require('ERC20Mock')
const JurorsRegistryOwnerMock = artifacts.require('JurorsRegistryOwnerMock')

contract('JurorsRegistry', ([_, juror]) => {
  let registry, registryOwner, ANJ

  const MIN_ACTIVE_AMOUNT = bigExp(100, 18)

  beforeEach('create base contracts', async () => {
    registry = await JurorsRegistry.new()
    registryOwner = await JurorsRegistryOwnerMock.new(registry.address)
    ANJ = await ERC20.new('ANJ Token', 'ANJ', 18)
  })

  describe('activate', () => {
    const from = juror

    context('when the registry is initialized', () => {
      beforeEach('initialize registry', async () => {
        await registry.init(registryOwner.address, ANJ.address, MIN_ACTIVE_AMOUNT)
      })

      context('when the juror has not staked some tokens yet', () => {
        context('when the given amount is zero', () => {
          const amount = bn(0)

          it('reverts', async () => {
            await assertRevert(registry.activate(amount, { from }), 'JR_INVALID_ZERO_AMOUNT')
          })
        })

        context('when the given amount is lower than the minimum active value', () => {
          const amount = MIN_ACTIVE_AMOUNT.sub(bn(1))

          it('reverts', async () => {
            await assertRevert(registry.activate(amount, { from }), 'JR_INVALID_ACTIVATION_AMOUNT')
          })
        })

        context('when the given amount is greater than the minimum active value', () => {
          const amount = MIN_ACTIVE_AMOUNT.mul(bn(2))

          it('reverts', async () => {
            await assertRevert(registry.activate(amount, { from }), 'JR_INVALID_ACTIVATION_AMOUNT')
          })
        })
      })

      context('when the juror has already staked some tokens', () => {
        const stakedBalance = MIN_ACTIVE_AMOUNT.mul(bn(3))

        beforeEach('stake some tokens', async () => {
          await ANJ.generateTokens(from, stakedBalance)
          await ANJ.approveAndCall(registry.address, stakedBalance, '0x', { from })
        })

        const itHandlesActivationProperlyFor = (requestedAmount, expectedAmount = requestedAmount, deactivationAmount = bn(0)) => {
          it('adds the requested amount to the active balance of the juror and removes it from the available balance', async () => {
            const { active: previousActiveBalance, available: previousAvailableBalance, locked: previousLockedBalance, pendingDeactivation: previousDeactivationBalance } = await registry.balanceOf(juror)

            await registry.activate(requestedAmount, { from })

            const { active: currentActiveBalance, available: currentAvailableBalance, locked: currentLockedBalance, pendingDeactivation: currentDeactivationBalance } = await registry.balanceOf(juror)
            assert.equal(previousLockedBalance.toString(), currentLockedBalance.toString(), 'locked balances do not match')
            assert.equal(previousAvailableBalance.sub(expectedAmount.sub(deactivationAmount)).toString(), currentAvailableBalance.toString(), 'available balances do not match')

            assert.equal(previousActiveBalance.add(expectedAmount).toString(), currentActiveBalance.toString(), 'active balances do not match')
            assert.equal(previousDeactivationBalance.sub(deactivationAmount).toString(), currentDeactivationBalance.toString(), 'deactivation balances do not match')
          })

          it('does not affect the active balance of the current term', async () => {
            const termId = await registryOwner.getLastEnsuredTermId()
            const currentTermPreviousBalance = await registry.activeBalanceOfAt(juror, termId)

            await registry.activate(requestedAmount, { from })

            const currentTermCurrentBalance = await registry.activeBalanceOfAt(juror, termId)
            assert.equal(currentTermPreviousBalance.toString(), currentTermCurrentBalance.toString(), 'current term active balances do not match')
          })

          it('increments the unlocked balance of the juror', async () => {
            const previousUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(juror)

            await registry.activate(requestedAmount, { from })

            const currentUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(juror)
            assert.equal(previousUnlockedActiveBalance.add(expectedAmount).toString(), currentUnlockedActiveBalance.toString(), 'unlocked balances do not match')
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
            const termId = await registryOwner.getLastEnsuredTermId()

            const receipt = await registry.activate(requestedAmount, { from })

            assertAmountOfEvents(receipt, 'JurorActivated')
            assertEvent(receipt, 'JurorActivated', { juror, fromTermId: termId.add(bn(1)), amount: expectedAmount })
          })

          if (deactivationAmount.eq(bn(0))) {
            it('emits one available balance changed events', async () => {
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
              const termId = await registryOwner.getLastEnsuredTermId()

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

              const jurorId = await registry.getJurorId(from)
              assert.equal(jurorId.toString(), 1, 'juror id does not match')
            })
          }

          context('when the given amount is zero', () => {
            const amount = bn(0)

            itCreatesAnIdForTheJuror(amount)
            itHandlesActivationProperlyFor(amount, stakedBalance)
          })

          context('when the given amount is lower than the minimum active value', () => {
            const amount = MIN_ACTIVE_AMOUNT.sub(bn(1))

            it('reverts', async () => {
              await assertRevert(registry.activate(amount, { from }), 'JR_ACTIVE_BALANCE_BELOW_MIN')
            })
          })

          context('when the given amount is greater than the minimum active value', () => {
            const amount = MIN_ACTIVE_AMOUNT.add(bn(1))

            itCreatesAnIdForTheJuror(amount)
            itHandlesActivationProperlyFor(amount)
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
              const expectedAmount = stakedBalance.sub(activeBalance)

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
                  await registry.unstake(stakedBalance.sub(activeBalance).sub(bn(1)), '0x', { from })
                })

                it('reverts', async () => {
                  await assertRevert(registry.activate(amount, { from }), 'JR_ACTIVE_BALANCE_BELOW_MIN')
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
                  await assertRevert(registry.activate(amount, { from }), 'JR_ACTIVE_BALANCE_BELOW_MIN')
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
              const currentAvailableBalance = stakedBalance.sub(deactivationAmount)

              context('when the given amount is zero', () => {
                const amount = bn(0)

                itHandlesActivationProperlyFor(amount, currentAvailableBalance)
              })

              context('when the given amount is greater than the available balance', () => {
                const amount = currentAvailableBalance.add(bn(1))

                it('reverts', async () => {
                  await assertRevert(registry.activate(amount, { from }), 'JR_INVALID_ACTIVATION_AMOUNT')
                })
              })

              context('when the future active amount will be lower than the minimum active value', () => {
                const amount = MIN_ACTIVE_AMOUNT.sub(bn(1))

                it('reverts', async () => {
                  await assertRevert(registry.activate(amount, { from }), 'JR_ACTIVE_BALANCE_BELOW_MIN')
                })
              })

              context('when the future active amount will be greater than the minimum active value', () => {
                const amount = MIN_ACTIVE_AMOUNT

                itHandlesActivationProperlyFor(amount)
              })
            })

            context('when the deactivation request is for the current term', () => {
              const currentAvailableBalance = stakedBalance.sub(activeBalance).add(deactivationAmount)

              beforeEach('increment term', async () => {
                await registryOwner.incrementTerm()
              })

              context('when the given amount is zero', () => {
                const amount = bn(0)

                itHandlesActivationProperlyFor(amount, currentAvailableBalance, deactivationAmount)
              })

              context('when the given amount is greater than the available balance', () => {
                const amount = currentAvailableBalance.add(bn(1))

                it('reverts', async () => {
                  await assertRevert(registry.activate(amount, { from }), 'JR_INVALID_ACTIVATION_AMOUNT')
                })
              })

              context('when the future active amount will be lower than the minimum active value', () => {
                const amount = MIN_ACTIVE_AMOUNT.sub(bn(1))

                it('reverts', async () => {
                  await assertRevert(registry.activate(amount, { from }), 'JR_ACTIVE_BALANCE_BELOW_MIN')
                })
              })

              context('when the future active amount will be greater than the minimum active value', () => {
                const amount = MIN_ACTIVE_AMOUNT

                itHandlesActivationProperlyFor(amount, amount, deactivationAmount)
              })
            })

            context('when the deactivation request is for the previous term', () => {
              const currentAvailableBalance = stakedBalance.sub(activeBalance).add(deactivationAmount)

              beforeEach('increment term twice', async () => {
                await registryOwner.incrementTerm()
                await registryOwner.incrementTerm()
              })

              context('when the given amount is zero', () => {
                const amount = bn(0)

                itHandlesActivationProperlyFor(amount, currentAvailableBalance, deactivationAmount)
              })

              context('when the given amount is greater than the available balance', () => {
                const amount = currentAvailableBalance.add(bn(1))

                it('reverts', async () => {
                  await assertRevert(registry.activate(amount, { from }), 'JR_INVALID_ACTIVATION_AMOUNT')
                })
              })

              context('when the future active amount will be lower than the minimum active value', () => {
                const amount = MIN_ACTIVE_AMOUNT.sub(bn(1))

                it('reverts', async () => {
                  await assertRevert(registry.activate(amount, { from }), 'JR_ACTIVE_BALANCE_BELOW_MIN')
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
        await registry.init(registryOwner.address, ANJ.address, MIN_ACTIVE_AMOUNT)
      })

      const itRevertsForDifferentAmounts = () => {
        context('when the requested amount is zero', () => {
          const amount = bn(0)

          it('reverts', async () => {
            await assertRevert(registry.deactivate(amount, { from }), 'JR_INVALID_ZERO_AMOUNT')
          })
        })

        context('when the requested amount is lower than the minimum active value', () => {
          const amount = MIN_ACTIVE_AMOUNT.sub(bn(1))

          it('reverts', async () => {
            await assertRevert(registry.deactivate(amount, { from }), 'JR_INVALID_DEACTIVATION_AMOUNT')
          })
        })

        context('when the requested amount is greater than the minimum active value', () => {
          const amount = MIN_ACTIVE_AMOUNT.mul(bn(2))

          it('reverts', async () => {
            await assertRevert(registry.deactivate(amount, { from }), 'JR_INVALID_DEACTIVATION_AMOUNT')
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
              assert.equal(previousActiveBalance.sub(expectedAmount).toString(), currentActiveBalance.toString(), 'active balances do not match')
              assert.equal(previousAvailableBalance.add(previousDeactivationAmount).toString(), currentAvailableBalance.toString(), 'available balances do not match')
              assert.equal(previousDeactivationBalance.add(expectedAmount).sub(previousDeactivationAmount).toString(), currentDeactivationBalance.toString(), 'deactivation balances do not match')

              assert.equal(previousLockedBalance.toString(), currentLockedBalance.toString(), 'locked balances do not match')
            })

            it('does not affect the active balance of the current term', async () => {
              const termId = await registryOwner.getLastEnsuredTermId()
              const currentTermPreviousBalance = await registry.activeBalanceOfAt(juror, termId)

              await registry.deactivate(requestedAmount, { from })

              const currentTermCurrentBalance = await registry.activeBalanceOfAt(juror, termId)
              assert.equal(currentTermPreviousBalance.toString(), currentTermCurrentBalance.toString(), 'current term active balances do not match')
            })

            it('decreases the unlocked balance of the juror', async () => {
              const previousUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(juror)

              await registry.deactivate(requestedAmount, { from })

              const currentUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(juror)
              assert.equal(previousUnlockedActiveBalance.sub(expectedAmount).toString(), currentUnlockedActiveBalance.toString(), 'unlocked balances do not match')
            })

            it('does not affect the staked balance of the juror', async () => {
              const previousTotalStake = await registry.totalStaked()
              const previousJurorStake = await registry.totalStakedFor(juror)

              await registry.deactivate(requestedAmount, { from })

              const currentTotalStake = await registry.totalStaked()
              assert.equal(previousTotalStake.toString(), currentTotalStake.toString(), 'total stake amounts do not match')

              const currentJurorStake = await registry.totalStakedFor(juror)
              assert.equal(previousJurorStake.toString(), currentJurorStake.toString(), 'juror stake amounts do not match')
            })

            it('does not affect the token balances', async () => {
              const previousJurorBalance = await ANJ.balanceOf(from)
              const previousRegistryBalance = await ANJ.balanceOf(registry.address)

              await registry.deactivate(requestedAmount, { from })

              const currentSenderBalance = await ANJ.balanceOf(from)
              assert.equal(previousJurorBalance.toString(), currentSenderBalance.toString(), 'juror balances do not match')

              const currentRegistryBalance = await ANJ.balanceOf(registry.address)
              assert.equal(previousRegistryBalance.toString(), currentRegistryBalance.toString(), 'registry balances do not match')
            })

            it('emits a deactivation request created event', async () => {
              const termId = await registryOwner.getLastEnsuredTermId()
              const receipt = await registry.deactivate(requestedAmount, { from })

              assertAmountOfEvents(receipt, 'JurorDeactivationRequested')
              assertEvent(receipt, 'JurorDeactivationRequested', { juror: from, availableTermId: termId.add(bn(1)), amount: expectedAmount })
            })

            if (!previousDeactivationAmount.eq(bn(0))) {
              it('emits an available balance changed event', async () => {
                const receipt = await registry.deactivate(requestedAmount, { from })

                assertAmountOfEvents(receipt, 'JurorAvailableBalanceChanged')
                assertEvent(receipt, 'JurorAvailableBalanceChanged', { juror, amount: previousDeactivationAmount, positive: true })
              })

              it('emits a deactivation processed event', async () => {
                const termId = await registryOwner.getLastEnsuredTermId()

                const receipt = await registry.deactivate(requestedAmount, { from })

                assertAmountOfEvents(receipt, 'JurorDeactivationProcessed')
                assertEvent(receipt, 'JurorDeactivationProcessed', { juror, amount: previousDeactivationAmount, availableTermId: 1, processedTermId: termId })
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
                await assertRevert(registry.deactivate(amount, { from }), 'JR_INVALID_DEACTIVATION_AMOUNT')
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
                  await assertRevert(registry.deactivate(amount, { from }), 'JR_INVALID_DEACTIVATION_AMOUNT')
                })
              })

              context('when the requested amount will make the active balance to be above the minimum active value', () => {
                const amount = currentActiveBalance.sub(MIN_ACTIVE_AMOUNT).sub(bn(1))

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
                const amount = bn(0)

                itHandlesDeactivationRequestFor(amount, currentActiveBalance, previousDeactivationAmount)
              })

              context('when the requested amount will make the active balance to be below the minimum active value', () => {
                const amount = currentActiveBalance.sub(MIN_ACTIVE_AMOUNT).add(bn(1))

                it('reverts', async () => {
                  await assertRevert(registry.deactivate(amount, { from }), 'JR_INVALID_DEACTIVATION_AMOUNT')
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
                await registryOwner.incrementTerm()
                await registryOwner.incrementTerm()
              })

              context('when the requested amount is zero', () => {
                const amount = bn(0)

                itHandlesDeactivationRequestFor(amount, currentActiveBalance, previousDeactivationAmount)
              })

              context('when the requested amount will make the active balance to be below the minimum active value', () => {
                const amount = currentActiveBalance.sub(MIN_ACTIVE_AMOUNT).add(bn(1))

                it('reverts', async () => {
                  await assertRevert(registry.deactivate(amount, { from }), 'JR_INVALID_DEACTIVATION_AMOUNT')
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

    context('when the registry is not initialized', () => {
      it('reverts', async () => {
        await assertRevert(registry.deactivate(bigExp(100, 18), { from }), 'INIT_NOT_INITIALIZED')
      })
    })
  })
})
