const { bigExp } = require('../helpers/numbers')(web3)
const { assertRevert } = require('@aragon/test-helpers/assertThrow')
const { decodeEventsOfType } = require('../helpers/decodeEvent')
const { assertEvent, assertAmountOfEvents } = require('@aragon/test-helpers/assertEvent')(web3)

const JurorsRegistry = artifacts.require('JurorsRegistry')
const MiniMeToken = artifacts.require('MiniMeToken')
const JurorsRegistryOwnerMock = artifacts.require('JurorsRegistryOwnerMock')

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

contract('JurorsRegistry slashing', ([_, juror, anyone]) => {
  let registry, registryOwner, ANJ

  const MIN_ACTIVE_AMOUNT = bigExp(100, 18)

  beforeEach('create base contracts', async () => {
    registry = await JurorsRegistry.new()
    registryOwner = await JurorsRegistryOwnerMock.new(registry.address)
    ANJ = await MiniMeToken.new(ZERO_ADDRESS, ZERO_ADDRESS, 0, 'n', 18, 'ANJ', true)
  })

  describe('slash', () => {
    // TODO: implement
  })

  describe('collectTokens', () => {
    context('when the registry is initialized', () => {
      beforeEach('initialize registry', async () => {
        await registry.init(registryOwner.address, ANJ.address, MIN_ACTIVE_AMOUNT)
      })

      context('when the sender is the owner', () => {
        const itReturnsFalse = amount => {
          it('returns false', async () => {
            const receipt = await registryOwner.collect(juror, amount)
            assertEvent(receipt, 'Collected', { collected: false })
          })
        }

        const itHandlesTokensCollectionFor = (amount, deactivationReduced = 0) => {
          it('returns true', async () => {
            const receipt = await registryOwner.collect(juror, amount)
            assertEvent(receipt, 'Collected', { collected: true })
          })

          it('decreases the active balance of the juror', async () => {
            const [previousActiveBalance, previousAvailableBalance, previousLockedBalance, previousDeactivationBalance] = await registry.balanceOf(juror)

            await registryOwner.collect(juror, amount)

            const [currentActiveBalance, currentAvailableBalance, currentLockedBalance, currentDeactivationBalance] = await registry.balanceOf(juror)
            assert.equal(previousDeactivationBalance.minus(deactivationReduced).toString(), currentDeactivationBalance.toString(), 'deactivation balances do not match')
            assert.equal(previousActiveBalance.minus(amount).plus(deactivationReduced).toString(), currentActiveBalance.toString(), 'active balances do not match')

            assert.equal(previousLockedBalance.toString(), currentLockedBalance.toString(), 'locked balances do not match')
            assert.equal(previousAvailableBalance.toString(), currentAvailableBalance.toString(), 'available balances do not match')
          })

          it('does not affect the active balance of the current term', async () => {
            const termId = await registryOwner.getLastEnsuredTermId()
            const currentTermPreviousBalance = await registry.activeBalanceOfAt(juror, termId)

            await registryOwner.collect(juror, amount)

            const currentTermCurrentBalance = await registry.activeBalanceOfAt(juror, termId)
            assert.equal(currentTermPreviousBalance.toString(), currentTermCurrentBalance.toString(), 'current term active balances do not match')
          })

          it('decreases the unlocked balance of the juror', async () => {
            const previousUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(juror)

            await registryOwner.collect(juror, amount)

            const currentUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(juror)
            assert.equal(previousUnlockedActiveBalance.minus(amount).plus(deactivationReduced).toString(), currentUnlockedActiveBalance.toString(), 'unlocked balances do not match')
          })

          it('decreases the staked balance of the juror', async () => {
            const previousTotalStake = await registry.totalStaked()
            const previousJurorStake = await registry.totalStakedFor(juror)

            await registryOwner.collect(juror, amount)

            const currentTotalStake = await registry.totalStaked()
            assert.equal(previousTotalStake.toString(), currentTotalStake.toString(), 'total stake amounts do not match')

            const currentJurorStake = await registry.totalStakedFor(juror)
            assert.equal(previousJurorStake.minus(amount).toString(), currentJurorStake.toString(), 'juror stake amounts do not match')
          })

          it('does not affect the token balances', async () => {
            const previousJurorBalance = await ANJ.balanceOf(juror)
            const previousRegistryBalance = await ANJ.balanceOf(registry.address)

            await registryOwner.collect(juror, amount)

            const currentSenderBalance = await ANJ.balanceOf(juror)
            assert.equal(previousJurorBalance.toString(), currentSenderBalance.toString(), 'juror balances do not match')

            const currentRegistryBalance = await ANJ.balanceOf(registry.address)
            assert.equal(previousRegistryBalance.toString(), currentRegistryBalance.toString(), 'registry balances do not match')
          })

          if (amount === 0) {
            it('does not emit a juror tokens collected event', async () => {
              const { tx } = await registryOwner.collect(juror, amount)
              const receipt = await web3.eth.getTransactionReceipt(tx)
              const logs = decodeEventsOfType({ receipt }, JurorsRegistry.abi, 'JurorTokensCollected')

              assertAmountOfEvents({ logs }, 'JurorTokensCollected', 0)
            })
          } else {
            it('emits a juror tokens collected event', async () => {
              const termId = await registryOwner.getLastEnsuredTermId()

              const { tx } = await registryOwner.collect(juror, amount)
              const receipt = await web3.eth.getTransactionReceipt(tx)
              const logs = decodeEventsOfType({ receipt }, JurorsRegistry.abi, 'JurorTokensCollected')

              assertAmountOfEvents({ logs }, 'JurorTokensCollected')
              assertEvent({ logs }, 'JurorTokensCollected', { juror: web3.toChecksumAddress(juror), termId: termId.plus(1), amount })
            })
          }

          it('does not process deactivation requests', async () => {
            const receipt = await registryOwner.collect(juror, amount)

            assertAmountOfEvents(receipt, 'JurorDeactivationProcessed', 0)
          })

          if (deactivationReduced !== 0) {
            it('emits a deactivation request updated event', async () => {
              const termId = await registryOwner.getLastEnsuredTermId()
              const [, , , previousDeactivationBalance] = await registry.balanceOf(juror)

              const { tx } = await registryOwner.collect(juror, amount)
              const receipt = await web3.eth.getTransactionReceipt(tx)
              const logs = decodeEventsOfType({ receipt }, JurorsRegistry.abi, 'JurorDeactivationUpdated')

              assertAmountOfEvents({ logs }, 'JurorDeactivationUpdated')
              assertEvent({ logs }, 'JurorDeactivationUpdated', {
                juror: web3.toChecksumAddress(juror),
                amount: previousDeactivationBalance.minus(deactivationReduced),
                availableTermId: 1,
                updateTermId: termId
              })
            })
          }
        }

        context('when the juror has not staked some tokens yet', () => {
          context('when the given amount is zero', () => {
            const amount = 0

            itHandlesTokensCollectionFor(amount)
          })

          context('when the given amount is greater than zero', () => {
            const amount = bigExp(50, 18)

            itReturnsFalse(amount)
          })
        })

        context('when the juror has already staked some tokens', () => {
          const stakedBalance = MIN_ACTIVE_AMOUNT.times(5)

          beforeEach('stake some tokens', async () => {
            await ANJ.generateTokens(juror, stakedBalance)
            await ANJ.approveAndCall(registry.address, stakedBalance, '0x', { from: juror })
          })

          context('when the juror did not activate any tokens yet', () => {
            context('when the given amount is zero', () => {
              const amount = 0

              itHandlesTokensCollectionFor(amount)
            })

            context('when the given amount is lower than the available balance of the juror', () => {
              const amount = stakedBalance.minus(1)

              itReturnsFalse(amount)
            })

            context('when the given amount is greater than the available balance of the juror', () => {
              const amount = stakedBalance.plus(1)

              itReturnsFalse(amount)
            })
          })

          context('when the juror has already activated some tokens', () => {
            const activeBalance = MIN_ACTIVE_AMOUNT.times(4)

            beforeEach('activate some tokens', async () => {
              await registry.activate(activeBalance, { from: juror })
            })

            context('when the juror does not have a deactivation request', () => {
              context('when the given amount is zero', () => {
                const amount = 0

                itHandlesTokensCollectionFor(amount)
              })

              context('when the given amount is lower than the active balance of the juror', () => {
                const amount = activeBalance.minus(1)

                itHandlesTokensCollectionFor(amount)
              })

              context('when the given amount is lower than the active balance of the juror', () => {
                const amount = activeBalance.plus(1)

                itReturnsFalse(amount)
              })
            })

            context('when the juror already has a previous deactivation request', () => {
              const deactivationAmount = MIN_ACTIVE_AMOUNT
              const currentActiveBalance = activeBalance.minus(deactivationAmount)

              beforeEach('deactivate tokens', async () => {
                await registry.deactivate(deactivationAmount, { from: juror })
              })

              context('when the deactivation request is for the next term', () => {
                context('when the given amount is zero', () => {
                  const amount = 0

                  itHandlesTokensCollectionFor(amount)
                })

                context('when the given amount is lower than the active balance of the juror', () => {
                  const amount = currentActiveBalance.minus(1)

                  itHandlesTokensCollectionFor(amount)
                })

                context('when the given amount is greater than the active balance of the juror but fits with the future deactivation amount', () => {
                  const amount = currentActiveBalance.plus(1)
                  const deactivationReduced = amount.minus(currentActiveBalance)

                  itHandlesTokensCollectionFor(amount, deactivationReduced)
                })

                context('when the given amount is greater than the active balance of the juror and does not fit with the future deactivation amount', () => {
                  const amount = currentActiveBalance.plus(deactivationAmount).plus(1)

                  itReturnsFalse(amount)
                })
              })

              context('when the deactivation request is for the current term', () => {
                beforeEach('increment term', async () => {
                  await registryOwner.incrementTerm()
                })

                context('when the given amount is zero', () => {
                  const amount = 0

                  itHandlesTokensCollectionFor(amount)
                })

                context('when the given amount is lower than the active balance of the juror', () => {
                  const amount = currentActiveBalance.minus(1)

                  itHandlesTokensCollectionFor(amount)
                })

                context('when the given amount is greater than the active balance of the juror but fits with the future deactivation amount', () => {
                  const amount = currentActiveBalance.plus(1)

                  itReturnsFalse(amount)
                })

                context('when the given amount is greater than the active balance of the juror and does not fit with the future deactivation amount', () => {
                  const amount = currentActiveBalance.plus(deactivationAmount).plus(1)

                  itReturnsFalse(amount)
                })
              })

              context('when the deactivation request is for the previous term', () => {
                beforeEach('increment term twice', async () => {
                  await registryOwner.incrementTerm()
                  await registryOwner.incrementTerm()
                })

                context('when the given amount is zero', () => {
                  const amount = 0

                  itHandlesTokensCollectionFor(amount)
                })

                context('when the given amount is lower than the available balance of the juror', () => {
                  const amount = currentActiveBalance.minus(1)

                  itHandlesTokensCollectionFor(amount)
                })

                context('when the given amount is greater than the active balance of the juror but fits with the future deactivation amount', () => {
                  const amount = currentActiveBalance.plus(1)

                  itReturnsFalse(amount)
                })

                context('when the given amount is greater than the active balance of the juror and does not fit with the future deactivation amount', () => {
                  const amount = currentActiveBalance.plus(deactivationAmount).plus(1)

                  itReturnsFalse(amount)
                })
              })
            })
          })
        })
      })

      context('when the sender is not the owner', () => {
        const from = anyone

        it('reverts', async () => {
          await assertRevert(registry.collectTokens(juror, bigExp(100, 18), 0, { from }), 'JR_SENDER_NOT_OWNER')
        })
      })
    })

    context('when the registry is not initialized', () => {
      it('reverts', async () => {
        await assertRevert(registryOwner.collect(juror, bigExp(100, 18)), 'JR_SENDER_NOT_OWNER')
      })
    })
  })
})
