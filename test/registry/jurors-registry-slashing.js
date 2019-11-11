const { assertBn } = require('../helpers/asserts/assertBn')
const { bn, bigExp } = require('../helpers/lib/numbers')
const { getEventAt } = require('@aragon/test-helpers/events')
const { buildHelper } = require('../helpers/wrappers/court')(web3, artifacts)
const { assertRevert } = require('../helpers/asserts/assertThrow')
const { REGISTRY_EVENTS } = require('../helpers/utils/events')
const { decodeEventsOfType } = require('../helpers/lib/decodeEvent')
const { ACTIVATE_DATA, countJuror } = require('../helpers/utils/jurors')
const { assertEvent, assertAmountOfEvents } = require('../helpers/asserts/assertEvent')
const { MATH_ERRORS, CONTROLLED_ERRORS, REGISTRY_ERRORS } = require('../helpers/utils/errors')

const JurorsRegistry = artifacts.require('JurorsRegistryMock')
const DisputesManager = artifacts.require('DisputesManagerMockForRegistry')
const ERC20 = artifacts.require('ERC20Mock')

contract('JurorsRegistry', ([_, juror, secondJuror, thirdJuror, anyone]) => {
  let controller, registry, disputesManager, ANJ

  const MIN_ACTIVE_AMOUNT = bigExp(100, 18)
  const TOTAL_ACTIVE_BALANCE_LIMIT = bigExp(100e6, 18)
  const DRAFT_LOCK_PCT = bn(2000) // 20%
  const DRAFT_LOCK_AMOUNT = MIN_ACTIVE_AMOUNT.mul(DRAFT_LOCK_PCT).div(bn(10000))
  const EMPTY_RANDOMNESS = '0x0000000000000000000000000000000000000000000000000000000000000000'

  beforeEach('create base contracts', async () => {
    controller = await buildHelper().deploy({ minActiveBalance: MIN_ACTIVE_AMOUNT })

    ANJ = await ERC20.new('ANJ Token', 'ANJ', 18)
    registry = await JurorsRegistry.new(controller.address, ANJ.address, TOTAL_ACTIVE_BALANCE_LIMIT)
    await controller.setJurorsRegistry(registry.address)

    disputesManager = await DisputesManager.new(controller.address)
    await controller.setDisputesManager(disputesManager.address)
  })

  describe('slashOrUnlock', () => {
    context('when the sender is the disputes manager', () => {
      beforeEach('activate jurors', async () => {
        const firstJurorBalance = MIN_ACTIVE_AMOUNT.mul(bn(10))
        await ANJ.generateTokens(juror, firstJurorBalance)
        await ANJ.approveAndCall(registry.address, firstJurorBalance, ACTIVATE_DATA, { from: juror })

        const secondJurorBalance = MIN_ACTIVE_AMOUNT.mul(bn(5))
        await ANJ.generateTokens(secondJuror, secondJurorBalance)
        await ANJ.approveAndCall(registry.address, secondJurorBalance, ACTIVATE_DATA, { from: secondJuror })

        const thirdJurorBalance = MIN_ACTIVE_AMOUNT.mul(bn(20))
        await ANJ.generateTokens(thirdJuror, thirdJurorBalance)
        await ANJ.approveAndCall(registry.address, thirdJurorBalance, ACTIVATE_DATA, { from: thirdJuror })

        await controller.mockIncreaseTerm()
      })

      context('when given input length does not match', () => {
        context('when given locked amounts do not match jurors length', () => {
          const jurors = []
          const lockedAmounts = [1]
          const rewardedJurors = []

          it('reverts', async () => {
            await assertRevert(disputesManager.slashOrUnlock(jurors, lockedAmounts, rewardedJurors), REGISTRY_ERRORS.INVALID_LOCKED_AMOUNTS_LEN)
          })
        })

        context('when given rewarded jurors do not match jurors length', () => {
          const jurors = []
          const lockedAmounts = []
          const rewardedJurors = [true]

          it('reverts', async () => {
            await assertRevert(disputesManager.slashOrUnlock(jurors, lockedAmounts, rewardedJurors), REGISTRY_ERRORS.INVALID_REWARDED_JURORS_LEN)
          })
        })
      })

      context('when given input length matches', () => {
        context('when no jurors are given', () => {
          const jurors = []
          const lockedAmounts = []
          const rewardedJurors = []

          it('does not collect tokens', async () => {
            const receipt = await disputesManager.slashOrUnlock(jurors, lockedAmounts, rewardedJurors)
            assertEvent(receipt, REGISTRY_EVENTS.SLASHED, { collected: 0 })
          })

          it('does not affect the balances of the jurors', async () => {
            const previousFirstJurorBalances = await registry.balanceOf(juror)
            const previousSecondJurorBalances = await registry.balanceOf(secondJuror)
            const previousThirdJurorBalances = await registry.balanceOf(thirdJuror)

            await disputesManager.slashOrUnlock(jurors, lockedAmounts, rewardedJurors)

            const currentJurorBalances = await registry.balanceOf(juror)
            const currentSecondJurorBalances = await registry.balanceOf(secondJuror)
            const currentThirdJurorBalances = await registry.balanceOf(thirdJuror)

            for (let i = 0; i < currentJurorBalances.length; i++) {
              assertBn(previousFirstJurorBalances[i], currentJurorBalances[i], `first juror balance #${i} does not match`)
              assertBn(previousSecondJurorBalances[i], currentSecondJurorBalances[i], `second juror balance #${i} does not match`)
              assertBn(previousThirdJurorBalances[i], currentThirdJurorBalances[i], `third juror balance #${i} does not match`)
            }
          })
        })

        context('when some jurors are given', () => {
          const jurors = [juror, secondJuror, thirdJuror]
          const rewardedJurors = [false, true, false]

          beforeEach('draft jurors', async () => {
            // Mock registry draft forcing the following result
            const draftedJurors = [juror, secondJuror, thirdJuror]
            const draftedWeights = [3, 1, 6]
            await registry.mockNextDraft(draftedJurors, draftedWeights)

            // Draft and make sure mock worked as expected
            const receipt = await disputesManager.draft(EMPTY_RANDOMNESS, 1, 0, 10, 10, DRAFT_LOCK_PCT)
            const { addresses } = getEventAt(receipt, 'Drafted').args

            assert.equal(countJuror(addresses, juror), 3, 'first drafted juror weight does not match')
            assert.equal(countJuror(addresses, secondJuror), 1, 'second drafted juror weight does not match')
            assert.equal(countJuror(addresses, thirdJuror), 6, 'third drafted juror weight does not match')
          })

          context('when given lock amounts are valid', () => {
            const lockedAmounts = [DRAFT_LOCK_AMOUNT.mul(bn(3)), DRAFT_LOCK_AMOUNT, DRAFT_LOCK_AMOUNT.mul(bn(6))]

            it('collect tokens for all the slashed amounts', async () => {
              const receipt = await disputesManager.slashOrUnlock(jurors, lockedAmounts, rewardedJurors)
              assertEvent(receipt, REGISTRY_EVENTS.SLASHED, { collected: DRAFT_LOCK_AMOUNT.mul(bn(9)) })
            })

            it('unlocks balances of the rewarded jurors', async () => {
              const { active: previousActiveBalance, available: previousAvailableBalance, locked: previousLockedBalance, pendingDeactivation: previousDeactivationBalance } = await registry.balanceOf(secondJuror)

              await disputesManager.slashOrUnlock(jurors, lockedAmounts, rewardedJurors)

              const { active: currentActiveBalance, available: currentAvailableBalance, locked: currentLockedBalance, pendingDeactivation: currentDeactivationBalance } = await registry.balanceOf(secondJuror)
              assertBn(previousLockedBalance.sub(DRAFT_LOCK_AMOUNT), currentLockedBalance, 'rewarded juror locked balance does not match')
              assertBn(previousActiveBalance, currentActiveBalance, 'rewarded juror active balance does not match')
              assertBn(previousAvailableBalance, currentAvailableBalance, 'rewarded juror available balance does not match')
              assertBn(previousDeactivationBalance, currentDeactivationBalance, 'rewarded juror deactivation balance does not match')
            })

            it('slashes the active balances of the not rewarded jurors', async () => {
              const { active: firstJurorPreviousActiveBalance, available: firstJurorPreviousAvailableBalance, locked: firstJurorPreviousLockedBalance, pendingDeactivation: firstJurorPreviousDeactivationBalance } = await registry.balanceOf(juror)
              const { active: thirdJurorPreviousActiveBalance, available: thirdJurorPreviousAvailableBalance, locked: thirdJurorPreviousLockedBalance, pendingDeactivation: thirdJurorPreviousDeactivationBalance } = await registry.balanceOf(thirdJuror)

              await disputesManager.slashOrUnlock(jurors, lockedAmounts, rewardedJurors)

              const { active: firstJurorCurrentActiveBalance, available: firstJurorCurrentAvailableBalance, locked: firstJurorCurrentLockedBalance, pendingDeactivation: firstJurorCurrentDeactivationBalance } = await registry.balanceOf(juror)
              assertBn(firstJurorPreviousLockedBalance.sub(DRAFT_LOCK_AMOUNT.mul(bn(3))), firstJurorCurrentLockedBalance, 'first slashed juror locked balance does not match')
              assertBn(firstJurorPreviousActiveBalance.sub(DRAFT_LOCK_AMOUNT.mul(bn(3))), firstJurorCurrentActiveBalance, 'first slashed juror active balance does not match')
              assertBn(firstJurorPreviousAvailableBalance, firstJurorCurrentAvailableBalance, 'first slashed juror available balance does not match')
              assertBn(firstJurorPreviousDeactivationBalance, firstJurorCurrentDeactivationBalance, 'first slashed juror deactivation balance does not match')

              const { active: thirdJurorCurrentActiveBalance, available: thirdJurorCurrentAvailableBalance, locked: thirdJurorCurrentLockedBalance, pendingDeactivation: thirdJurorCurrentDeactivationBalance } = await registry.balanceOf(thirdJuror)
              assertBn(thirdJurorPreviousLockedBalance.sub(DRAFT_LOCK_AMOUNT.mul(bn(6))), thirdJurorCurrentLockedBalance, 'second slashed juror locked balance does not match')
              assertBn(thirdJurorPreviousActiveBalance.sub(DRAFT_LOCK_AMOUNT.mul(bn(6))), thirdJurorCurrentActiveBalance, 'second slashed juror active balance does not match')
              assertBn(thirdJurorPreviousAvailableBalance, thirdJurorCurrentAvailableBalance, 'second slashed juror available balance does not match')
              assertBn(thirdJurorPreviousDeactivationBalance, thirdJurorCurrentDeactivationBalance, 'second slashed juror deactivation balance does not match')
            })

            it('does not affect the active balances of the current term', async () => {
              let termId = await controller.getLastEnsuredTermId()
              const firstJurorPreviousActiveBalance = await registry.activeBalanceOfAt(juror, termId)
              const secondJurorPreviousActiveBalance = await registry.activeBalanceOfAt(secondJuror, termId)
              const thirdJurorPreviousActiveBalance = await registry.activeBalanceOfAt(thirdJuror, termId)

              await disputesManager.slashOrUnlock(jurors, lockedAmounts, rewardedJurors)

              const firstJurorCurrentActiveBalance = await registry.activeBalanceOfAt(juror, termId)
              assertBn(firstJurorPreviousActiveBalance, firstJurorCurrentActiveBalance, 'first juror active balance does not match')

              const secondJurorCurrentActiveBalance = await registry.activeBalanceOfAt(secondJuror, termId)
              assertBn(secondJurorPreviousActiveBalance, secondJurorCurrentActiveBalance, 'second juror active balance does not match')

              const thirdJurorCurrentActiveBalance = await registry.activeBalanceOfAt(thirdJuror, termId)
              assertBn(thirdJurorPreviousActiveBalance, thirdJurorCurrentActiveBalance, 'third juror active balance does not match')
            })
          })

          context('when given lock amounts are not valid', () => {
            const lockedAmounts = [DRAFT_LOCK_AMOUNT.mul(bn(10)), bn(0), bn(0)]

            it('reverts', async () => {
              await assertRevert(disputesManager.slashOrUnlock(jurors, lockedAmounts, rewardedJurors), MATH_ERRORS.SUB_UNDERFLOW)
            })
          })
        })
      })
    })

    context('when the sender is not the disputes manager', () => {
      it('reverts', async () => {
        await assertRevert(registry.slashOrUnlock(0, [], [], []), CONTROLLED_ERRORS.SENDER_NOT_DISPUTES_MODULE)
      })
    })
  })

  describe('collectTokens', () => {
    context('when the sender is the disputes manager', () => {
      const itReturnsFalse = amount => {
        it('returns false', async () => {
          const receipt = await disputesManager.collect(juror, amount)
          assertEvent(receipt, REGISTRY_EVENTS.COLLECTED, { collected: false })
        })
      }

      const itHandlesTokensCollectionFor = (amount, deactivationReduced = bn(0)) => {
        it('returns true', async () => {
          const receipt = await disputesManager.collect(juror, amount)
          assertEvent(receipt, REGISTRY_EVENTS.COLLECTED, { collected: true })
        })

        it('decreases the active balance of the juror', async () => {
          const { active: previousActiveBalance, available: previousAvailableBalance, locked: previousLockedBalance, pendingDeactivation: previousDeactivationBalance } = await registry.balanceOf(juror)

          await disputesManager.collect(juror, amount)

          const { active: currentActiveBalance, available: currentAvailableBalance, locked: currentLockedBalance, pendingDeactivation: currentDeactivationBalance } = await registry.balanceOf(juror)
          assertBn(previousDeactivationBalance.sub(deactivationReduced), currentDeactivationBalance, 'deactivation balances do not match')
          assertBn(previousActiveBalance.sub(amount).add(deactivationReduced), currentActiveBalance, 'active balances do not match')

          assertBn(previousLockedBalance, currentLockedBalance, 'locked balances do not match')
          assertBn(previousAvailableBalance, currentAvailableBalance, 'available balances do not match')
        })

        it('does not affect the active balance of the current term', async () => {
          const termId = await controller.getLastEnsuredTermId()
          const currentTermPreviousBalance = await registry.activeBalanceOfAt(juror, termId)

          await disputesManager.collect(juror, amount)

          const currentTermCurrentBalance = await registry.activeBalanceOfAt(juror, termId)
          assertBn(currentTermPreviousBalance, currentTermCurrentBalance, 'current term active balances do not match')
        })

        it('decreases the unlocked balance of the juror', async () => {
          const pendingDeactivation = await registry.getDeactivationRequest(juror)
          const currentTermId = await controller.getLastEnsuredTermId()

          let pendingDeactivationAmount = bn(0)
          if (pendingDeactivation.availableTermId.gt(currentTermId)) {
            pendingDeactivationAmount = pendingDeactivation.amount
          }
          // unlockedActivebalanceOf returns the balance for the current term, but there may be a deactivation scheduled for the next term
          const previousUnlockedActiveBalance = (await registry.unlockedActiveBalanceOf(juror)).sub(pendingDeactivationAmount)

          await disputesManager.collect(juror, amount)

          await controller.mockIncreaseTerm()
          const currentUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(juror)
          assertBn(previousUnlockedActiveBalance.sub(amount).add(deactivationReduced), currentUnlockedActiveBalance, 'unlocked balances do not match')
        })

        it('decreases the staked balance of the juror', async () => {
          const previousTotalStake = await registry.totalStaked()
          const previousJurorStake = await registry.totalStakedFor(juror)

          await disputesManager.collect(juror, amount)

          const currentTotalStake = await registry.totalStaked()
          assertBn(previousTotalStake, currentTotalStake, 'total stake amounts do not match')

          const currentJurorStake = await registry.totalStakedFor(juror)
          assertBn(previousJurorStake.sub(amount), currentJurorStake, 'juror stake amounts do not match')
        })

        it('does not affect the token balances', async () => {
          const previousJurorBalance = await ANJ.balanceOf(juror)
          const previousRegistryBalance = await ANJ.balanceOf(registry.address)

          await disputesManager.collect(juror, amount)

          const currentSenderBalance = await ANJ.balanceOf(juror)
          assertBn(previousJurorBalance, currentSenderBalance, 'juror balances do not match')

          const currentRegistryBalance = await ANJ.balanceOf(registry.address)
          assertBn(previousRegistryBalance, currentRegistryBalance, 'registry balances do not match')
        })

        if (amount.eq(bn(0))) {
          it('does not emit a juror tokens collected event', async () => {
            const receipt = await disputesManager.collect(juror, amount)
            const logs = decodeEventsOfType(receipt, JurorsRegistry.abi, REGISTRY_EVENTS.JUROR_TOKENS_COLLECTED)

            assertAmountOfEvents({ logs }, REGISTRY_EVENTS.JUROR_TOKENS_COLLECTED, 0)
          })
        } else {
          it('emits a juror tokens collected event', async () => {
            const termId = await controller.getLastEnsuredTermId()

            const receipt = await disputesManager.collect(juror, amount)
            const logs = decodeEventsOfType(receipt, JurorsRegistry.abi, REGISTRY_EVENTS.JUROR_TOKENS_COLLECTED)

            assertAmountOfEvents({ logs }, REGISTRY_EVENTS.JUROR_TOKENS_COLLECTED)
            assertEvent({ logs }, REGISTRY_EVENTS.JUROR_TOKENS_COLLECTED, { juror, termId: termId.add(bn(1)), amount })
          })
        }

        it('does not process deactivation requests', async () => {
          const receipt = await disputesManager.collect(juror, amount)

          assertAmountOfEvents(receipt, REGISTRY_EVENTS.JUROR_DEACTIVATION_PROCESSED, 0)
        })

        if (!deactivationReduced.eq(bn(0))) {
          it('emits a deactivation request updated event', async () => {
            const termId = await controller.getLastEnsuredTermId()
            const { pendingDeactivation: previousDeactivation } = await registry.balanceOf(juror)

            const receipt = await disputesManager.collect(juror, amount)
            const logs = decodeEventsOfType(receipt, JurorsRegistry.abi, REGISTRY_EVENTS.JUROR_DEACTIVATION_UPDATED)

            assertAmountOfEvents({ logs }, REGISTRY_EVENTS.JUROR_DEACTIVATION_UPDATED)
            assertEvent({ logs }, REGISTRY_EVENTS.JUROR_DEACTIVATION_UPDATED, { juror, availableTermId: 2, updateTermId: termId, amount: previousDeactivation.sub(deactivationReduced) })
          })
        }
      }

      context('when the juror has not staked some tokens yet', () => {
        context('when the given amount is zero', () => {
          const amount = bn(0)

          itHandlesTokensCollectionFor(amount)
        })

        context('when the given amount is greater than zero', () => {
          const amount = bigExp(50, 18)

          itReturnsFalse(amount)
        })
      })

      context('when the juror has already staked some tokens', () => {
        const stakedBalance = MIN_ACTIVE_AMOUNT.mul(bn(5))

        beforeEach('stake some tokens', async () => {
          await ANJ.generateTokens(juror, stakedBalance)
          await ANJ.approveAndCall(registry.address, stakedBalance, '0x', { from: juror })
        })

        context('when the juror did not activate any tokens yet', () => {
          context('when the given amount is zero', () => {
            const amount = bn(0)

            itHandlesTokensCollectionFor(amount)
          })

          context('when the given amount is lower than the available balance of the juror', () => {
            const amount = stakedBalance.sub(bn(1))

            itReturnsFalse(amount)
          })

          context('when the given amount is greater than the available balance of the juror', () => {
            const amount = stakedBalance.add(bn(1))

            itReturnsFalse(amount)
          })
        })

        context('when the juror has already activated some tokens', () => {
          const activeBalance = MIN_ACTIVE_AMOUNT.mul(bn(4))

          beforeEach('activate some tokens', async () => {
            await registry.activate(activeBalance, { from: juror })
            await controller.mockIncreaseTerm()
          })

          context('when the juror does not have a deactivation request', () => {
            context('when the given amount is zero', () => {
              const amount = bn(0)

              itHandlesTokensCollectionFor(amount)
            })

            context('when the given amount is lower than the active balance of the juror', () => {
              const amount = activeBalance.sub(bn(1))

              itHandlesTokensCollectionFor(amount)
            })

            context('when the given amount is lower than the active balance of the juror', () => {
              const amount = activeBalance.add(bn(1))

              itReturnsFalse(amount)
            })
          })

          context('when the juror already has a previous deactivation request', () => {
            const deactivationAmount = MIN_ACTIVE_AMOUNT
            const currentActiveBalance = activeBalance.sub(deactivationAmount)

            beforeEach('deactivate tokens', async () => {
              await registry.deactivate(deactivationAmount, { from: juror })
            })

            context('when the deactivation request is for the next term', () => {
              context('when the given amount is zero', () => {
                const amount = bn(0)

                itHandlesTokensCollectionFor(amount)
              })

              context('when the given amount is lower than the active balance of the juror', () => {
                const amount = currentActiveBalance.sub(bn(1))

                itHandlesTokensCollectionFor(amount)
              })

              context('when the given amount is greater than the active balance of the juror but fits with the future deactivation amount', () => {
                const deactivationReduced = bn(1)
                const amount = currentActiveBalance.add(deactivationReduced)

                itHandlesTokensCollectionFor(amount, deactivationReduced)
              })

              context('when the given amount is greater than the active balance of the juror and does not fit with the future deactivation amount', () => {
                const amount = currentActiveBalance.add(deactivationAmount).add(bn(1))

                itReturnsFalse(amount)
              })
            })

            context('when the deactivation request is for the current term', () => {
              beforeEach('increment term', async () => {
                await controller.mockIncreaseTerm()
              })

              context('when the given amount is zero', () => {
                const amount = bn(0)

                itHandlesTokensCollectionFor(amount)
              })

              context('when the given amount is lower than the active balance of the juror', () => {
                const amount = currentActiveBalance.sub(bn(1))

                itHandlesTokensCollectionFor(amount)
              })

              context('when the given amount is greater than the active balance of the juror but fits with the future deactivation amount', () => {
                const amount = currentActiveBalance.add(bn(1))

                itReturnsFalse(amount)
              })

              context('when the given amount is greater than the active balance of the juror and does not fit with the future deactivation amount', () => {
                const amount = currentActiveBalance.add(deactivationAmount).add(bn(1))

                itReturnsFalse(amount)
              })
            })

            context('when the deactivation request is for the previous term', () => {
              beforeEach('increment term twice', async () => {
                await controller.mockIncreaseTerm()
                await controller.mockIncreaseTerm()
              })

              context('when the given amount is zero', () => {
                const amount = bn(0)

                itHandlesTokensCollectionFor(amount)
              })

              context('when the given amount is lower than the available balance of the juror', () => {
                const amount = currentActiveBalance.sub(bn(1))

                itHandlesTokensCollectionFor(amount)
              })

              context('when the given amount is greater than the active balance of the juror but fits with the future deactivation amount', () => {
                const amount = currentActiveBalance.add(bn(1))

                itReturnsFalse(amount)
              })

              context('when the given amount is greater than the active balance of the juror and does not fit with the future deactivation amount', () => {
                const amount = currentActiveBalance.add(deactivationAmount).add(bn(1))

                itReturnsFalse(amount)
              })
            })
          })
        })
      })
    })

    context('when the sender is not the disputes manager', () => {
      const from = anyone

      it('reverts', async () => {
        await assertRevert(registry.collectTokens(juror, bigExp(100, 18), 0, { from }), CONTROLLED_ERRORS.SENDER_NOT_DISPUTES_MODULE)
      })
    })
  })
})
