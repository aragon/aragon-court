const { sha3 } = require('web3-utils')
const { countJuror } = require('../helpers/jurors')
const { bn, bigExp } = require('../helpers/numbers')
const { getEventAt } = require('@aragon/test-helpers/events')
const { buildHelper } = require('../helpers/controller')(web3, artifacts)
const { assertRevert } = require('../helpers/assertThrow')
const { decodeEventsOfType } = require('../helpers/decodeEvent')
const { assertEvent, assertAmountOfEvents } = require('../helpers/assertEvent')

const JurorsRegistry = artifacts.require('JurorsRegistryMock')
const Court = artifacts.require('CourtMockForRegistry')
const ERC20 = artifacts.require('ERC20Mock')

contract('JurorsRegistry', ([_, juror, secondJuror, thirdJuror, anyone]) => {
  let controller, registry, court, ANJ

  const ACTIVATE_DATA = sha3('activate(uint256)').slice(0, 10)
  const MIN_ACTIVE_AMOUNT = bigExp(100, 18)
  const TOTAL_ACTIVE_BALANCE_LIMIT = bigExp(100e6, 18)
  const DRAFT_LOCK_PCT = bn(2000) // 20%
  const DRAFT_LOCK_AMOUNT = MIN_ACTIVE_AMOUNT.mul(DRAFT_LOCK_PCT).div(bn(10000))
  const EMPTY_RANDOMNESS = '0x0000000000000000000000000000000000000000000000000000000000000000'

  beforeEach('create base contracts', async () => {
    controller = await buildHelper().deploy()
    ANJ = await ERC20.new('ANJ Token', 'ANJ', 18)

    registry = await JurorsRegistry.new(controller.address, ANJ.address, MIN_ACTIVE_AMOUNT, TOTAL_ACTIVE_BALANCE_LIMIT)
    await controller.setJurorsRegistry(registry.address)

    court = await Court.new(controller.address)
    await controller.setCourt(court.address)
  })

  describe('slashOrUnlock', () => {
    context('when the sender is the court', () => {
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
            await assertRevert(court.slashOrUnlock(jurors, lockedAmounts, rewardedJurors), 'JR_INVALID_LOCKED_AMOUNTS_LEN')
          })
        })

        context('when given rewarded jurors do not match jurors length', () => {
          const jurors = []
          const lockedAmounts = []
          const rewardedJurors = [true]

          it('reverts', async () => {
            await assertRevert(court.slashOrUnlock(jurors, lockedAmounts, rewardedJurors), 'JR_INVALID_REWARDED_JURORS_LEN')
          })
        })
      })

      context('when given input length matches', () => {
        context('when no jurors are given', () => {
          const jurors = []
          const lockedAmounts = []
          const rewardedJurors = []

          it('does not collect tokens', async () => {
            const receipt = await court.slashOrUnlock(jurors, lockedAmounts, rewardedJurors)
            assertEvent(receipt, 'Slashed', { collected: 0 })
          })

          it('does not affect the balances of the jurors', async () => {
            const previousFirstJurorBalances = await registry.balanceOf(juror)
            const previousSecondJurorBalances = await registry.balanceOf(secondJuror)
            const previousThirdJurorBalances = await registry.balanceOf(thirdJuror)

            await court.slashOrUnlock(jurors, lockedAmounts, rewardedJurors)

            const currentJurorBalances = await registry.balanceOf(juror)
            const currentSecondJurorBalances = await registry.balanceOf(secondJuror)
            const currentThirdJurorBalances = await registry.balanceOf(thirdJuror)

            for (let i = 0; i < currentJurorBalances.length; i++) {
              assert.equal(previousFirstJurorBalances[i].toString(), currentJurorBalances[i].toString(), `first juror balance #${i} does not match`)
              assert.equal(previousSecondJurorBalances[i].toString(), currentSecondJurorBalances[i].toString(), `second juror balance #${i} does not match`)
              assert.equal(previousThirdJurorBalances[i].toString(), currentThirdJurorBalances[i].toString(), `third juror balance #${i} does not match`)
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
            const receipt = await court.draft(EMPTY_RANDOMNESS, 1, 0, 10, 10, DRAFT_LOCK_PCT)
            const { addresses } = getEventAt(receipt, 'Drafted').args

            assert.equal(countJuror(addresses, juror), 3, 'first drafted juror weight does not match')
            assert.equal(countJuror(addresses, secondJuror), 1, 'second drafted juror weight does not match')
            assert.equal(countJuror(addresses, thirdJuror), 6, 'third drafted juror weight does not match')
          })

          context('when given lock amounts are valid', () => {
            const lockedAmounts = [DRAFT_LOCK_AMOUNT.mul(bn(3)), DRAFT_LOCK_AMOUNT, DRAFT_LOCK_AMOUNT.mul(bn(6))]

            it('collect tokens for all the slashed amounts', async () => {
              const receipt = await court.slashOrUnlock(jurors, lockedAmounts, rewardedJurors)
              assertEvent(receipt, 'Slashed', { collected: DRAFT_LOCK_AMOUNT.mul(bn(9)) })
            })

            it('unlocks balances of the rewarded jurors', async () => {
              const { active: previousActiveBalance, available: previousAvailableBalance, locked: previousLockedBalance, pendingDeactivation: previousDeactivationBalance } = await registry.balanceOf(secondJuror)

              await court.slashOrUnlock(jurors, lockedAmounts, rewardedJurors)

              const { active: currentActiveBalance, available: currentAvailableBalance, locked: currentLockedBalance, pendingDeactivation: currentDeactivationBalance } = await registry.balanceOf(secondJuror)
              assert.equal(previousLockedBalance.sub(DRAFT_LOCK_AMOUNT).toString(), currentLockedBalance.toString(), 'rewarded juror locked balance does not match')
              assert.equal(previousActiveBalance.toString(), currentActiveBalance.toString(), 'rewarded juror active balance does not match')
              assert.equal(previousAvailableBalance.toString(), currentAvailableBalance.toString(), 'rewarded juror available balance does not match')
              assert.equal(previousDeactivationBalance.toString(), currentDeactivationBalance.toString(), 'rewarded juror deactivation balance does not match')
            })

            it('slashes the active balances of the not rewarded jurors', async () => {
              const { active: firstJurorPreviousActiveBalance, available: firstJurorPreviousAvailableBalance, locked: firstJurorPreviousLockedBalance, pendingDeactivation: firstJurorPreviousDeactivationBalance } = await registry.balanceOf(juror)
              const { active: thirdJurorPreviousActiveBalance, available: thirdJurorPreviousAvailableBalance, locked: thirdJurorPreviousLockedBalance, pendingDeactivation: thirdJurorPreviousDeactivationBalance } = await registry.balanceOf(thirdJuror)

              await court.slashOrUnlock(jurors, lockedAmounts, rewardedJurors)

              const { active: firstJurorCurrentActiveBalance, available: firstJurorCurrentAvailableBalance, locked: firstJurorCurrentLockedBalance, pendingDeactivation: firstJurorCurrentDeactivationBalance } = await registry.balanceOf(juror)
              assert.equal(firstJurorPreviousLockedBalance.sub(DRAFT_LOCK_AMOUNT.mul(bn(3))).toString(), firstJurorCurrentLockedBalance.toString(), 'first slashed juror locked balance does not match')
              assert.equal(firstJurorPreviousActiveBalance.sub(DRAFT_LOCK_AMOUNT.mul(bn(3))).toString(), firstJurorCurrentActiveBalance.toString(), 'first slashed juror active balance does not match')
              assert.equal(firstJurorPreviousAvailableBalance.toString(), firstJurorCurrentAvailableBalance.toString(), 'first slashed juror available balance does not match')
              assert.equal(firstJurorPreviousDeactivationBalance.toString(), firstJurorCurrentDeactivationBalance.toString(), 'first slashed juror deactivation balance does not match')

              const { active: thirdJurorCurrentActiveBalance, available: thirdJurorCurrentAvailableBalance, locked: thirdJurorCurrentLockedBalance, pendingDeactivation: thirdJurorCurrentDeactivationBalance } = await registry.balanceOf(thirdJuror)
              assert.equal(thirdJurorPreviousLockedBalance.sub(DRAFT_LOCK_AMOUNT.mul(bn(6))).toString(), thirdJurorCurrentLockedBalance.toString(), 'second slashed juror locked balance does not match')
              assert.equal(thirdJurorPreviousActiveBalance.sub(DRAFT_LOCK_AMOUNT.mul(bn(6))).toString(), thirdJurorCurrentActiveBalance.toString(), 'second slashed juror active balance does not match')
              assert.equal(thirdJurorPreviousAvailableBalance.toString(), thirdJurorCurrentAvailableBalance.toString(), 'second slashed juror available balance does not match')
              assert.equal(thirdJurorPreviousDeactivationBalance.toString(), thirdJurorCurrentDeactivationBalance.toString(), 'second slashed juror deactivation balance does not match')
            })

            it('does not affect the active balances of the current term', async () => {
              let termId = await controller.getLastEnsuredTermId()
              const firstJurorPreviousActiveBalance = await registry.activeBalanceOfAt(juror, termId)
              const secondJurorPreviousActiveBalance = await registry.activeBalanceOfAt(secondJuror, termId)
              const thirdJurorPreviousActiveBalance = await registry.activeBalanceOfAt(thirdJuror, termId)

              await court.slashOrUnlock(jurors, lockedAmounts, rewardedJurors)

              const firstJurorCurrentActiveBalance = await registry.activeBalanceOfAt(juror, termId)
              assert.equal(firstJurorPreviousActiveBalance.toString(), firstJurorCurrentActiveBalance.toString(), 'first juror active balance does not match')

              const secondJurorCurrentActiveBalance = await registry.activeBalanceOfAt(secondJuror, termId)
              assert.equal(secondJurorPreviousActiveBalance.toString(), secondJurorCurrentActiveBalance.toString(), 'second juror active balance does not match')

              const thirdJurorCurrentActiveBalance = await registry.activeBalanceOfAt(thirdJuror, termId)
              assert.equal(thirdJurorPreviousActiveBalance.toString(), thirdJurorCurrentActiveBalance.toString(), 'third juror active balance does not match')
            })
          })

          context('when given lock amounts are not valid', () => {
            const lockedAmounts = [DRAFT_LOCK_AMOUNT.mul(bn(10)), bn(0), bn(0)]

            it('reverts', async () => {
              await assertRevert(court.slashOrUnlock(jurors, lockedAmounts, rewardedJurors), 'MATH_SUB_UNDERFLOW')
            })
          })
        })
      })
    })

    context('when the sender is not the court', () => {
      it('reverts', async () => {
        await assertRevert(registry.slashOrUnlock(0, [], [], []), 'CTD_SENDER_NOT_COURT_MODULE')
      })
    })
  })

  describe('collectTokens', () => {
    context('when the sender is the court', () => {
      const itReturnsFalse = amount => {
        it('returns false', async () => {
          const receipt = await court.collect(juror, amount)
          assertEvent(receipt, 'Collected', { collected: false })
        })
      }

      const itHandlesTokensCollectionFor = (amount, deactivationReduced = bn(0)) => {
        it('returns true', async () => {
          const receipt = await court.collect(juror, amount)
          assertEvent(receipt, 'Collected', { collected: true })
        })

        it('decreases the active balance of the juror', async () => {
          const { active: previousActiveBalance, available: previousAvailableBalance, locked: previousLockedBalance, pendingDeactivation: previousDeactivationBalance } = await registry.balanceOf(juror)

          await court.collect(juror, amount)

          const { active: currentActiveBalance, available: currentAvailableBalance, locked: currentLockedBalance, pendingDeactivation: currentDeactivationBalance } = await registry.balanceOf(juror)
          assert.equal(previousDeactivationBalance.sub(deactivationReduced).toString(), currentDeactivationBalance.toString(), 'deactivation balances do not match')
          assert.equal(previousActiveBalance.sub(amount).add(deactivationReduced).toString(), currentActiveBalance.toString(), 'active balances do not match')

          assert.equal(previousLockedBalance.toString(), currentLockedBalance.toString(), 'locked balances do not match')
          assert.equal(previousAvailableBalance.toString(), currentAvailableBalance.toString(), 'available balances do not match')
        })

        it('does not affect the active balance of the current term', async () => {
          const termId = await controller.getLastEnsuredTermId()
          const currentTermPreviousBalance = await registry.activeBalanceOfAt(juror, termId)

          await court.collect(juror, amount)

          const currentTermCurrentBalance = await registry.activeBalanceOfAt(juror, termId)
          assert.equal(currentTermPreviousBalance.toString(), currentTermCurrentBalance.toString(), 'current term active balances do not match')
        })

        it('decreases the unlocked balance of the juror', async () => {
          const pendingDeactivation = await registry.getDeactivationRequest(juror)
          const currentTermId = await controller.getLastEnsuredTermId()

          let pendingDeactivationAmount = bn(0)
          if (pendingDeactivation.availableTermId.gt(currentTermId)) {
            pendingDeactivationAmount = pendingDeactivation.amount
          }
          const previousUnlockedActiveBalance = (await registry.unlockedActiveBalanceOf(juror)).sub(pendingDeactivationAmount)

          await court.collect(juror, amount)

          await controller.mockIncreaseTerm()
          const currentUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(juror)
          assert.equal(previousUnlockedActiveBalance.sub(amount).add(deactivationReduced).toString(), currentUnlockedActiveBalance.toString(), 'unlocked balances do not match')
        })

        it('decreases the staked balance of the juror', async () => {
          const previousTotalStake = await registry.totalStaked()
          const previousJurorStake = await registry.totalStakedFor(juror)

          await court.collect(juror, amount)

          const currentTotalStake = await registry.totalStaked()
          assert.equal(previousTotalStake.toString(), currentTotalStake.toString(), 'total stake amounts do not match')

          const currentJurorStake = await registry.totalStakedFor(juror)
          assert.equal(previousJurorStake.sub(amount).toString(), currentJurorStake.toString(), 'juror stake amounts do not match')
        })

        it('does not affect the token balances', async () => {
          const previousJurorBalance = await ANJ.balanceOf(juror)
          const previousRegistryBalance = await ANJ.balanceOf(registry.address)

          await court.collect(juror, amount)

          const currentSenderBalance = await ANJ.balanceOf(juror)
          assert.equal(previousJurorBalance.toString(), currentSenderBalance.toString(), 'juror balances do not match')

          const currentRegistryBalance = await ANJ.balanceOf(registry.address)
          assert.equal(previousRegistryBalance.toString(), currentRegistryBalance.toString(), 'registry balances do not match')
        })

        if (amount.eq(bn(0))) {
          it('does not emit a juror tokens collected event', async () => {
            const receipt = await court.collect(juror, amount)
            const logs = decodeEventsOfType(receipt, JurorsRegistry.abi, 'JurorTokensCollected')

            assertAmountOfEvents({ logs }, 'JurorTokensCollected', 0)
          })
        } else {
          it('emits a juror tokens collected event', async () => {
            const termId = await controller.getLastEnsuredTermId()

            const receipt = await court.collect(juror, amount)
            const logs = decodeEventsOfType(receipt, JurorsRegistry.abi, 'JurorTokensCollected')

            assertAmountOfEvents({ logs }, 'JurorTokensCollected')
            assertEvent({ logs }, 'JurorTokensCollected', { juror, termId: termId.add(bn(1)), amount })
          })
        }

        it('does not process deactivation requests', async () => {
          const receipt = await court.collect(juror, amount)

          assertAmountOfEvents(receipt, 'JurorDeactivationProcessed', 0)
        })

        if (!deactivationReduced.eq(bn(0))) {
          it('emits a deactivation request updated event', async () => {
            const termId = await controller.getLastEnsuredTermId()
            const { pendingDeactivation: previousDeactivation } = await registry.balanceOf(juror)

            const receipt = await court.collect(juror, amount)
            const logs = decodeEventsOfType(receipt, JurorsRegistry.abi, 'JurorDeactivationUpdated')

            assertAmountOfEvents({ logs }, 'JurorDeactivationUpdated')
            assertEvent({ logs }, 'JurorDeactivationUpdated', { juror, availableTermId: 2, updateTermId: termId, amount: previousDeactivation.sub(deactivationReduced) })
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

    context('when the sender is not the court', () => {
      const from = anyone

      it('reverts', async () => {
        await assertRevert(registry.collectTokens(juror, bigExp(100, 18), 0, { from }), 'CTD_SENDER_NOT_COURT_MODULE')
      })
    })
  })
})
