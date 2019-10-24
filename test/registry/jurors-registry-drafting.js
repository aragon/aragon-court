const { sha3 } = require('web3-utils')
const { bn, bigExp } = require('../helpers/numbers')
const { getEventAt } = require('@aragon/test-helpers/events')
const { buildHelper } = require('../helpers/controller')(web3, artifacts)
const { assertRevert } = require('../helpers/assertThrow')
const { simulateDraft } = require('../helpers/registry')
const { countEqualJurors } = require('../helpers/jurors')
const { decodeEventsOfType } = require('../helpers/decodeEvent')
const { assertAmountOfEvents, assertEvent } = require('../helpers/assertEvent')

const JurorsRegistry = artifacts.require('JurorsRegistryMock')
const Court = artifacts.require('CourtMockForRegistry')
const ERC20 = artifacts.require('ERC20Mock')

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

contract('JurorsRegistry', ([_, juror500, juror1000, juror1500, juror2000, juror2500, juror3000, juror3500, juror4000]) => {
  let controller, registry, court, ANJ

  const DRAFT_LOCK_PCT = bn(2000) // 20%
  const MIN_ACTIVE_AMOUNT = bigExp(100, 18)
  const TOTAL_ACTIVE_BALANCE_LIMIT = bigExp(100e6, 18)
  const ACTIVATE_DATA = sha3('activate(uint256)').slice(0, 10)
  const DRAFT_LOCKED_AMOUNT = MIN_ACTIVE_AMOUNT.mul(DRAFT_LOCK_PCT).div(bn(10000))

  /** These tests are using a fixed seed to make sure we generate the same output on each run */
  const TERM_ID = 1
  const DISPUTE_ID = 0
  const SORTITON_ITERATION = 0
  const EMPTY_RANDOMNESS = '0x0000000000000000000000000000000000000000000000000000000000000000'

  const balances = [
    bigExp(500,  18),
    bigExp(1000, 18),
    bigExp(1500, 18),
    bigExp(2000, 18),
    bigExp(2500, 18),
    bigExp(3000, 18),
    bigExp(3500, 18),
    bigExp(4000, 18),
  ]

  const jurors = [
    { address: juror500,  initialActiveBalance: balances[0] },
    { address: juror1000, initialActiveBalance: balances[1] },
    { address: juror1500, initialActiveBalance: balances[2] },
    { address: juror2000, initialActiveBalance: balances[3] },
    { address: juror2500, initialActiveBalance: balances[4] },
    { address: juror3000, initialActiveBalance: balances[5] },
    { address: juror3500, initialActiveBalance: balances[6] },
    { address: juror4000, initialActiveBalance: balances[7] },
  ]

  beforeEach('create base contracts', async () => {
    controller = await buildHelper().deploy()
    ANJ = await ERC20.new('ANJ Token', 'ANJ', 18)

    registry = await JurorsRegistry.new(controller.address, ANJ.address, MIN_ACTIVE_AMOUNT, TOTAL_ACTIVE_BALANCE_LIMIT)
    await controller.setJurorsRegistry(registry.address)

    court = await Court.new(controller.address)
    await controller.setCourt(court.address)
  })

  describe('draft', () => {
    const getTreeKey = (balances, soughtBalance) => {
      // linear search on balances
      if (soughtBalance.eq(bn(0))) return undefined

      let key = 0
      let accumulated = bn(0)
      for (let balance of balances) {
        accumulated = accumulated.add(balance)
        if (soughtBalance.lt(accumulated)) break
        key++
      }
      return key
    }

    const computeExpectedJurors = async ({
      termRandomness = EMPTY_RANDOMNESS,
      disputeId = DISPUTE_ID,
      selectedJurors = 0,
      batchRequestedJurors,
      roundRequestedJurors
    }) => {
      for (const juror of jurors) {
        juror.unlockedActiveBalance = await registry.unlockedActiveBalanceOf(juror.address)
        const { active, pendingDeactivation } = (await registry.balanceOfAt(juror.address, TERM_ID))
        juror.activeBalance = active
        juror.pendingDeactivation = pendingDeactivation
      }

      const activeJurors = jurors.filter(juror => juror.activeBalance.gte(MIN_ACTIVE_AMOUNT))

      return simulateDraft({
        termRandomness,
        disputeId,
        selectedJurors,
        batchRequestedJurors,
        roundRequestedJurors,
        sortitionIteration: SORTITON_ITERATION,
        balances,
        jurors: activeJurors,
        draftLockAmount: DRAFT_LOCKED_AMOUNT,
        getTreeKey
      })
    }

    const draft = async ({
      termRandomness = EMPTY_RANDOMNESS,
      disputeId = DISPUTE_ID,
      selectedJurors = 0,
      batchRequestedJurors,
      roundRequestedJurors
    }) => {
      const expectedJurors = await computeExpectedJurors({ termRandomness, disputeId, selectedJurors, batchRequestedJurors, roundRequestedJurors })
      const receipt = await court.draft(termRandomness, disputeId, selectedJurors, batchRequestedJurors, roundRequestedJurors, DRAFT_LOCK_PCT)
      const { addresses, length } = getEventAt(receipt, 'Drafted').args
      return { receipt, addresses, length, expectedJurors }
    }

    const getFirstExpectedJurorAddress = async (batchRequestedJurors, roundRequestedJurors) => {
      const expectedJurors = await computeExpectedJurors({ batchRequestedJurors, roundRequestedJurors })
      return expectedJurors[0]
    }

    const deactivateFirstExpectedJuror = async (batchRequestedJurors, roundRequestedJurors) => {
      const juror = await getFirstExpectedJurorAddress(batchRequestedJurors, roundRequestedJurors)
      await registry.deactivate(0, { from: juror })
      const { active } = await registry.balanceOf(juror)
      assert.equal(active.toString(), 0, 'first expected juror active balance does not match')
    }

    const lockFirstExpectedJuror = async (batchRequestedJurors, roundRequestedJurors, leftUnlockedAmount = bn(0)) => {
      const juror = await getFirstExpectedJurorAddress(batchRequestedJurors, roundRequestedJurors)
      await registry.mockLock(juror, leftUnlockedAmount)
      const { active, locked } = await registry.balanceOfAt(juror, TERM_ID)
      assert.equal(locked.toString(), active.sub(leftUnlockedAmount).toString(), 'juror locked balance does not match')
    }

    beforeEach('initialize registry and mint ANJ for jurors', async () => {
      for (let i = 0; i < jurors.length; i++) {
        await ANJ.generateTokens(jurors[i].address, jurors[i].initialActiveBalance)
      }
    })

    context('when the sender is the court', () => {
      const itReverts = (previousSelectedJurors, batchRequestedJurors, roundRequestedJurors) => {
        it('reverts', async () => {
          await assertRevert(draft({ selectedJurors: previousSelectedJurors, batchRequestedJurors, roundRequestedJurors }), 'SUM_TREE_SEARCH_OUT_OF_BOUNDS')
        })
      }

      const itReturnsEmptyValues = (batchRequestedJurors, roundRequestedJurors) => {
        it('returns empty values', async () => {
          const { length, addresses } = await draft({ batchRequestedJurors, roundRequestedJurors })

          assert.equal(length.toString(), 0, 'output length does not match')

          const expectedAddresses = (batchRequestedJurors === 0) ? [] : Array.from(new Array(addresses.length)).map(() => ZERO_ADDRESS)
          assert.deepEqual(addresses, expectedAddresses, 'jurors address do not match')
        })

        it('does not emit JurorDrafted events', async () => {
          const { receipt } = await draft({ batchRequestedJurors, roundRequestedJurors })
          const logs = decodeEventsOfType(receipt, JurorsRegistry.abi, 'JurorDrafted')

          assertAmountOfEvents({ logs }, 'JurorDrafted', 0)
        })
      }

      const itReturnsExpectedJurors = ({ termRandomness = EMPTY_RANDOMNESS, disputeId = 0, previousSelectedJurors = 0, batchRequestedJurors, roundRequestedJurors }) => {
        if (previousSelectedJurors > 0) {
          const selectedJurors = 0

          beforeEach('run previous batch', async () => {
            await draft({ termRandomness, disputeId, selectedJurors, batchRequestedJurors: previousSelectedJurors, roundRequestedJurors })
          })
        }

        it('returns the expected jurors', async () => {
          const { addresses, length, expectedJurors } = await draft({
            termRandomness,
            disputeId,
            selectedJurors: previousSelectedJurors,
            batchRequestedJurors,
            roundRequestedJurors
          })

          assert.lengthOf(addresses, batchRequestedJurors, 'jurors length does not match')
          assert.lengthOf(expectedJurors, length.toString(), 'expected jurors length does not match')
          assert.deepEqual(addresses.slice(0, length), expectedJurors, 'juror addresses do not match')
        })

        it('emits JurorDrafted events', async () => {
          const { receipt, length, expectedJurors } = await draft({
            termRandomness,
            disputeId,
            selectedJurors: previousSelectedJurors,
            batchRequestedJurors,
            roundRequestedJurors
          })

          const logs = decodeEventsOfType(receipt, JurorsRegistry.abi, 'JurorDrafted')
          assertAmountOfEvents({ logs }, 'JurorDrafted', length)

          for (let i = 0; i < length; i++) {
            assertEvent({ logs }, 'JurorDrafted', { disputeId, juror: expectedJurors[i] }, i)
          }
        })

        it('locks the corresponding amount of active balances for the expected jurors', async () => {
          const previousLockedBalances = {}
          for(let i = 0; i < jurors.length; i++) {
            const address = jurors[i].address
            const { locked } = await registry.balanceOf(address)
            previousLockedBalances[address] = locked
          }

          const { expectedJurors } = await draft({
            termRandomness,
            disputeId,
            selectedJurors: previousSelectedJurors,
            batchRequestedJurors,
            roundRequestedJurors
          })
          const countedJurors = countEqualJurors(expectedJurors)

          for (const juror of countedJurors) {
            const { locked: currentLockedBalance } = await registry.balanceOf(juror.address)
            const previousLockedBalance = previousLockedBalances[juror.address]
            const expectedLockedBalance = juror.count * DRAFT_LOCKED_AMOUNT

            const actualLockedBalance = currentLockedBalance.sub(previousLockedBalance).toString()
            assert.equal(actualLockedBalance, expectedLockedBalance, `locked balance for juror #${juror.address} does not match`)
          }
        })
      }

      context('when there are no activated jurors', () => {
        context('when no jurors were requested', () => {
          const batchRequestedJurors = 0
          const roundRequestedJurors = 0

          itReturnsEmptyValues(batchRequestedJurors, roundRequestedJurors)
        })

        context('when some jurors were requested', () => {
          const roundRequestedJurors = 10

          context('for the first batch', () => {
            const batchRequestedJurors = 3
            const previousSelectedJurors = 0

            itReverts(previousSelectedJurors, batchRequestedJurors, roundRequestedJurors)
          })

          context('for the second batch', () => {
            const batchRequestedJurors = 7
            const previousSelectedJurors = 3

            itReverts(previousSelectedJurors, batchRequestedJurors, roundRequestedJurors)
          })
        })
      })

      context('when there are some activated jurors', () => {
        context('when there is only one juror activated', () => {
          beforeEach('activate', async () => {
            await ANJ.approveAndCall(registry.address, bigExp(500, 18), ACTIVATE_DATA, { from: juror500 })
          })

          context('when no jurors were requested', () => {
            const batchRequestedJurors = 0
            const roundRequestedJurors = 0

            itReturnsEmptyValues(batchRequestedJurors, roundRequestedJurors)
          })

          context('when some jurors were requested', () => {
            const roundRequestedJurors = 10

            context('when the juror is activated for the following term', () => {
              context('for the first batch', () => {
                const batchRequestedJurors = 3
                const previousSelectedJurors = 0

                itReverts(previousSelectedJurors, batchRequestedJurors, roundRequestedJurors)
              })

              context('for the second batch', () => {
                const batchRequestedJurors = 7
                const previousSelectedJurors = 3

                itReverts(previousSelectedJurors, batchRequestedJurors, roundRequestedJurors)
              })
            })

            context('when the juror is activated for the current term', () => {
              beforeEach('increment term', async () => {
                await controller.mockIncreaseTerm()
              })

              context('when juror has enough unlocked balance to be drafted', () => {
                context('for the first batch', () => {
                  const batchRequestedJurors = 3
                  const previousSelectedJurors = 0

                  itReturnsExpectedJurors({ previousSelectedJurors, batchRequestedJurors, roundRequestedJurors })
                })

                context('for the second batch', () => {
                  const batchRequestedJurors = 7
                  const previousSelectedJurors = 3

                  itReturnsExpectedJurors({ previousSelectedJurors, batchRequestedJurors, roundRequestedJurors })
                })
              })

              context('when juror has partially enough unlocked balance to be drafted', () => {
                const firstBatchRequestedJurors = 3

                beforeEach('lock first expected juror', async () => {
                  const leftUnlockedAmount = DRAFT_LOCKED_AMOUNT.mul(bn(2))
                  await lockFirstExpectedJuror(firstBatchRequestedJurors, roundRequestedJurors, leftUnlockedAmount)
                })

                context('for the first batch', () => {
                  const batchRequestedJurors = firstBatchRequestedJurors

                  itReturnsExpectedJurors({ batchRequestedJurors, roundRequestedJurors })
                })

                context('for the second batch', () => {
                  const batchRequestedJurors = 7

                  beforeEach('run previous batch', async () => {
                    await draft({ batchRequestedJurors: firstBatchRequestedJurors, roundRequestedJurors })
                  })

                  itReturnsEmptyValues(batchRequestedJurors, roundRequestedJurors)
                })
              })

              context('when juror does not have enough unlocked balance to be drafted', () => {
                const batchRequestedJurors = 1
                const roundRequestedJurors = 1

                beforeEach('lock first expected juror', async () => {
                  await lockFirstExpectedJuror(batchRequestedJurors, roundRequestedJurors)
                })

                itReturnsEmptyValues(batchRequestedJurors, roundRequestedJurors)
              })
            })
          })
        })

        context('when there are many jurors activated', () => {
          beforeEach('activate', async () => {
            for (let i = 0; i < jurors.length; i++) {
              await ANJ.approveAndCall(registry.address, jurors[i].initialActiveBalance, ACTIVATE_DATA, { from: jurors[i].address })
            }
          })

          context('when no jurors were requested', () => {
            const batchRequestedJurors = 0
            const roundRequestedJurors = 0

            itReturnsEmptyValues(batchRequestedJurors, roundRequestedJurors)
          })

          context('when some jurors were requested', () => {
            context('when there were requested less jurors than the active ones', () => {
              const roundRequestedJurors = 5

              context('when the jurors are activated for the following term', () => {
                context('for the first batch', () => {
                  const batchRequestedJurors = 1
                  const previousSelectedJurors = 0

                  itReverts(previousSelectedJurors, batchRequestedJurors, roundRequestedJurors)
                })

                context('for the second batch', () => {
                  const batchRequestedJurors = 4
                  const previousSelectedJurors = 1

                  itReverts(previousSelectedJurors, batchRequestedJurors, roundRequestedJurors)
                })
              })

              context('when the jurors are activated for the current term', () => {
                beforeEach('increment term', async () => {
                  await controller.mockIncreaseTerm()
                })

                context('for the first batch', () => {
                  const batchRequestedJurors = 1
                  const previousSelectedJurors = 0

                  itReturnsExpectedJurors({ previousSelectedJurors, batchRequestedJurors, roundRequestedJurors })
                })

                context('for the second batch', () => {
                  const batchRequestedJurors = 4
                  const previousSelectedJurors = 1

                  itReturnsExpectedJurors({ previousSelectedJurors, batchRequestedJurors, roundRequestedJurors })
                })
              })
            })

            context('when there were requested more jurors than the active ones', () => {
              const roundRequestedJurors = 10

              context('when the jurors are activated for the following term', () => {
                context('for the first batch', () => {
                  const batchRequestedJurors = 3
                  const previousSelectedJurors = 0

                  itReverts(previousSelectedJurors, batchRequestedJurors, roundRequestedJurors)
                })

                context('for the second batch', () => {
                  const batchRequestedJurors = 7
                  const previousSelectedJurors = 3

                  itReverts(previousSelectedJurors, batchRequestedJurors, roundRequestedJurors)
                })
              })

              context('when the jurors are activated for the current term', () => {
                beforeEach('increment term', async () => {
                  await controller.mockIncreaseTerm()
                })

                context('when jurors have not been selected for other drafts', () => {
                  context('for the first batch', () => {
                    const batchRequestedJurors = 3
                    const previousSelectedJurors = 0

                    itReturnsExpectedJurors({ previousSelectedJurors, batchRequestedJurors, roundRequestedJurors })

                    it('changes for different dispute ids', async () => {
                      const disputeId = 1
                      const expectedJurors = await computeExpectedJurors({ disputeId: DISPUTE_ID, batchRequestedJurors, roundRequestedJurors })

                      const { addresses } = await draft({ disputeId, batchRequestedJurors, roundRequestedJurors })
                      assert.notDeepEqual(addresses, expectedJurors, 'jurors should not match')
                    })

                    it('changes for different term randomness', async () => {
                      const termRandomness = sha3('0x1')
                      const expectedJurors = await computeExpectedJurors({ termRandomness: EMPTY_RANDOMNESS, batchRequestedJurors, roundRequestedJurors })

                      const { addresses } = await draft({ termRandomness, batchRequestedJurors, roundRequestedJurors })
                      assert.notDeepEqual(addresses, expectedJurors, 'jurors should not match')
                    })
                  })

                  context('for the second batch', () => {
                    const batchRequestedJurors = 7
                    const previousSelectedJurors = 3

                    itReturnsExpectedJurors({ previousSelectedJurors, batchRequestedJurors, roundRequestedJurors })
                  })
                })

                context('when jurors have been selected for other drafts', () => {
                  context('when all jurors have been enough balance to be drafted again', () => {
                    beforeEach('compute a previous draft', async () => {
                      await draft({ batchRequestedJurors: 3, roundRequestedJurors: 3 })
                    })

                    context('for the first batch', () => {
                      const batchRequestedJurors = 3
                      const previousSelectedJurors = 0

                      itReturnsExpectedJurors({ previousSelectedJurors, batchRequestedJurors, roundRequestedJurors })
                    })

                    context('for the second batch', () => {
                      const batchRequestedJurors = 7
                      const previousSelectedJurors = 3

                      itReturnsExpectedJurors({ previousSelectedJurors, batchRequestedJurors, roundRequestedJurors })
                    })
                  })

                  context('when some jurors do not have been enough balance to be drafted again', () => {
                    context('when it is due to other drafts', () => {
                      context('for the first batch', () => {
                        const batchRequestedJurors = 3
                        const previousSelectedJurors = 0

                        beforeEach('lock first expected juror', async () => {
                          await lockFirstExpectedJuror(batchRequestedJurors, roundRequestedJurors)
                        })

                        itReturnsExpectedJurors({ previousSelectedJurors, batchRequestedJurors, roundRequestedJurors })
                      })

                      context('for the second batch', () => {
                        const batchRequestedJurors = 7
                        const previousSelectedJurors = 3

                        beforeEach('lock first expected juror', async () => {
                          await lockFirstExpectedJuror(batchRequestedJurors, roundRequestedJurors)
                        })

                        itReturnsExpectedJurors({ previousSelectedJurors, batchRequestedJurors, roundRequestedJurors })
                      })
                    })

                    context('when it is due to deactivation requests', () => {
                      context('for the first batch', () => {
                        const batchRequestedJurors = 3
                        const previousSelectedJurors = 0

                        beforeEach('deactivate first expected juror', async () => {
                          await deactivateFirstExpectedJuror(batchRequestedJurors, roundRequestedJurors)
                        })

                        itReturnsExpectedJurors({ previousSelectedJurors, batchRequestedJurors, roundRequestedJurors })
                      })

                      context('for the second batch', () => {
                        const batchRequestedJurors = 7
                        const previousSelectedJurors = 3

                        beforeEach('deactivate first expected juror', async () => {
                          await deactivateFirstExpectedJuror(batchRequestedJurors, roundRequestedJurors)
                        })

                        itReturnsExpectedJurors({ previousSelectedJurors, batchRequestedJurors, roundRequestedJurors })
                      })
                    })
                  })
                })
              })
            })
          })
        })
      })
    })

    context('when the sender is not the court', () => {
      it('reverts', async () => {
        await assertRevert(registry.draft([0, 0, 0, 0, 0, 0, 0]), 'CTD_SENDER_NOT_COURT_MODULE')
      })
    })
  })
})
