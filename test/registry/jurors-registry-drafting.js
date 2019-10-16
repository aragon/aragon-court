const { sha3 } = require('web3-utils')
const { bn, bigExp } = require('../helpers/numbers')
const { getEventAt } = require('@aragon/test-helpers/events')
const { assertRevert } = require('../helpers/assertThrow')
const { simulateDraft } = require('../helpers/registry')
const { ONE_DAY, NEXT_WEEK } = require('../helpers/time')
const { decodeEventsOfType } = require('../helpers/decodeEvent')
const { assertAmountOfEvents, assertEvent } = require('../helpers/assertEvent')

const JurorsRegistry = artifacts.require('JurorsRegistryMock')
const Controller = artifacts.require('ControllerMock')
const CourtClock = artifacts.require('CourtClockMock')
const Court = artifacts.require('CourtMockForRegistry')
const ERC20 = artifacts.require('ERC20Mock')

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

contract('JurorsRegistry', ([_, juror500, juror1000, juror1500, juror2000, juror2500, juror3000, juror3500, juror4000]) => {
  let controller, clock, registry, court, ANJ

  const DRAFT_LOCK_PCT = bn(2000) // 20%
  const MIN_ACTIVE_AMOUNT = bigExp(100, 18)
  const TOTAL_ACTIVE_BALANCE_LIMIT = bigExp(100e6, 18)
  const ACTIVATE_DATA = sha3('activate(uint256)').slice(0, 10)
  const MIN_UNLOCKED_AMOUNT = MIN_ACTIVE_AMOUNT.mul(DRAFT_LOCK_PCT).div(bn(10000))

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

  /** These tests are using a fixed seed to make sure we generate the same output on each run */
  const TERM_ID = 1
  const DISPUTE_ID = 0
  const SORTITON_ITERATION = 0
  const EMPTY_RANDOMNESS = '0x0000000000000000000000000000000000000000000000000000000000000000'

  // linear search on balances
  const getTreeKey = (balances, soughtBalance) => {
    let key = 0
    let accumulated = bn(0)
    for (let balance of balances) {
      accumulated = accumulated.add(balance)
      if (soughtBalance.lt(accumulated)) {
        break
      }
      key++
    }
    return key
  }

  beforeEach('create base contracts', async () => {
    controller = await Controller.new()
    ANJ = await ERC20.new('ANJ Token', 'ANJ', 18)

    registry = await JurorsRegistry.new(controller.address, ANJ.address, MIN_ACTIVE_AMOUNT, TOTAL_ACTIVE_BALANCE_LIMIT)
    await controller.setJurorsRegistry(registry.address)

    clock = await CourtClock.new(controller.address, ONE_DAY, NEXT_WEEK)
    await controller.setClock(clock.address)

    court = await Court.new(registry.address)
    await controller.setCourt(court.address)
  })

  describe('draft', () => {
    const draftPromise = async ({
      termRandomness = EMPTY_RANDOMNESS,
      disputeId = DISPUTE_ID,
      selectedJurors = 0,
      batchRequestedJurors,
      roundRequestedJurors
    }) => {
      return court.draft(termRandomness, disputeId, selectedJurors, batchRequestedJurors, roundRequestedJurors, DRAFT_LOCK_PCT)
    }

    const updateJurorsAndSimulateDraft = async ({
      termRandomness = EMPTY_RANDOMNESS,
      disputeId = DISPUTE_ID,
      selectedJurors = 0,
      batchRequestedJurors,
      roundRequestedJurors
    })  => {
      await Promise.all(
        jurors.map(async (juror) => {
          const unlockedActiveBalance = await registry.unlockedActiveBalanceOf(juror.address)
          juror.unlockedActiveBalance = unlockedActiveBalance
        })
      )

      await Promise.all(
        jurors.map(async (juror) => {
          const { active, pendingDeactivation } = (await registry.balanceOfAt(juror.address, TERM_ID))
          juror.activeBalance = active
          juror.pendingDeactivation = pendingDeactivation
        })
      )

      const activeJurors = jurors.filter(juror => juror.activeBalance.gte(MIN_ACTIVE_AMOUNT))

      const expectedJurors = simulateDraft({
        termRandomness,
        disputeId,
        termId: TERM_ID,
        selectedJurors,
        batchRequestedJurors,
        roundRequestedJurors,
        sortitionIteration: SORTITON_ITERATION,
        balances,
        jurors: activeJurors,
        minUnlockedAmount: MIN_UNLOCKED_AMOUNT,
        getTreeKey
      })

      return expectedJurors
    }

    const draft = async ({
      termRandomness = EMPTY_RANDOMNESS,
      disputeId = DISPUTE_ID,
      selectedJurors = 0,
      batchRequestedJurors,
      roundRequestedJurors
    }) => {
      const receipt = await draftPromise({ termRandomness, disputeId, selectedJurors, batchRequestedJurors, roundRequestedJurors })

      const {
        addresses,
        weights,
        outputLength
      } = getEventAt(receipt, 'Drafted').args

      const expectedJurors = await updateJurorsAndSimulateDraft({
        termRandomness,
        disputeId,
        selectedJurors,
        batchRequestedJurors,
        roundRequestedJurors
      })

      return {
        receipt,
        addresses,
        weights,
        outputLength,
        expectedJurors
      }
    }

    const getFirstExpectedJuror  = async (batchRequestedJurors, roundRequestedJurors) => {
      const expectedJurors = await updateJurorsAndSimulateDraft({
        termRandomness: EMPTY_RANDOMNESS,
        disputeId: 0,
        selectedJurors: 0,
        batchRequestedJurors,
        roundRequestedJurors
      })
      return expectedJurors[0].address
    }

    const lockFirstExpectedJuror = async (batchRequestedJurors, roundRequestedJurors) => {
      const firstExpectedJuror = await getFirstExpectedJuror(batchRequestedJurors, roundRequestedJurors)
      await registry.lockAll(firstExpectedJuror)

      const { active, locked } = await registry.balanceOfAt(firstExpectedJuror, TERM_ID)
      assert.equal(active.toString(), locked.toString(), 'juror locked balance does not match')
    }

    beforeEach('initialize registry and mint ANJ for jurors', async () => {
      for (let i = 0; i < jurors.length; i++) {
        await ANJ.generateTokens(jurors[i].address, jurors[i].initialActiveBalance)
      }
    })

    context('when the sender is the court', () => {
      const itReverts = (previousSelectedJurors, batchRequestedJurors, roundRequestedJurors) => {
        it('reverts', async () => {
          await assertRevert(draftPromise({ selectedJurors: previousSelectedJurors, batchRequestedJurors, roundRequestedJurors }))
        })
      }

      const itReturnsEmptyValues = (batchRequestedJurors, roundRequestedJurors) => {
        it('returns empty values', async () => {
          const { addresses, weights, outputLength } = await draft({ batchRequestedJurors, roundRequestedJurors })

          assert.equal(outputLength.toString(), 0, 'output length does not match')
          assert.isEmpty(addresses, 'jurors address do not match')
          assert.isEmpty(weights, 'jurors weights do not match')
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
            await draft({
              termRandomness,
              disputeId,
              selectedJurors,
              batchRequestedJurors: previousSelectedJurors,
              roundRequestedJurors
            })
          })
        }

        it('returns the expected jurors', async () => {
          const { addresses, weights, outputLength, expectedJurors } = await draft({
            termRandomness,
            disputeId,
            selectedJurors: previousSelectedJurors,
            batchRequestedJurors,
            roundRequestedJurors
          })

          assert.equal(outputLength.toString(), expectedJurors.length, 'output length does not match')
          assert.equal(batchRequestedJurors, expectedJurors.reduce((acc, j) => acc + j.weight, 0), 'total weight does not match')

          assert.lengthOf(weights, batchRequestedJurors, 'jurors weights do not match')
          assert.lengthOf(addresses, batchRequestedJurors, 'jurors address do not match')

          for (let i = 0; i < expectedJurors.length; i++) {
            assert.equal(weights[i], expectedJurors[i].weight || 0, `weight #${i} does not match`)
            assert.equal(addresses[i], expectedJurors[i].address || ZERO_ADDRESS, `juror address #${i} does not match`)
          }
        })

        it('emits JurorDrafted events', async () => {
          const { receipt, addresses, outputLength, expectedJurors } = await draft({
            termRandomness,
            disputeId,
            selectedJurors: previousSelectedJurors,
            batchRequestedJurors,
            roundRequestedJurors
          })
          const logs = decodeEventsOfType(receipt, JurorsRegistry.abi, 'JurorDrafted')
          assertAmountOfEvents({ logs }, 'JurorDrafted', batchRequestedJurors)

          let nextEventIndex = 0
          for (let i = 0; i < outputLength.toNumber(); i++) {
            for (let j = 0; j < expectedJurors[i]; j++) {
              assertEvent({ logs }, 'JurorDrafted', { disputeId, juror: addresses[i] }, nextEventIndex)
              nextEventIndex++
            }
          }
        })

        it('locks the corresponding amount of active balances for the expected jurors', async () => {
          const previousLockedBalances = {}
          for(let i = 0; i < jurors.length; i++) {
            const address = jurors[i].address
            previousLockedBalances[address] = (await registry.balanceOf(address))[2]
          }

          const { outputLength, expectedJurors } = await draft({
            termRandomness,
            disputeId,
            selectedJurors: previousSelectedJurors,
            batchRequestedJurors,
            roundRequestedJurors
          })

          assert.equal(outputLength.toNumber(), expectedJurors.length, 'output length does not match')
          // merge possible duplicates
          const mergedExpectedJurors = expectedJurors.reduce((acc, juror) => {
            if (acc[juror.key]) {
              acc[juror.key].weight += juror.weight
            } else {
              acc[juror.key] = {
                address: juror.address,
                weight: juror.weight
              }
            }
            return acc
          }, {})
          for (let key in mergedExpectedJurors) {
            const currentLockedBalance = (await registry.balanceOf(mergedExpectedJurors[key].address))[2]
            const previousLockedBalance = previousLockedBalances[mergedExpectedJurors[key].address]
            const expectedLockedBalance = mergedExpectedJurors[key].weight * (MIN_ACTIVE_AMOUNT.mul(DRAFT_LOCK_PCT).div(bn(10000)))
            assert.equal(currentLockedBalance.sub(previousLockedBalance).toString(), expectedLockedBalance, `locked balance for juror #${mergedExpectedJurors[key]} does not match`)
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
                await clock.mockIncreaseTerm()
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

              context('when juror does not have enough unlocked balance to be drafted', () => {
                const batchRequestedJurors = 1
                const roundRequestedJurors = 1
                beforeEach('draft juror', async () => {
                  await lockFirstExpectedJuror(batchRequestedJurors, roundRequestedJurors)
                })

                itReverts(0, batchRequestedJurors, roundRequestedJurors)
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
                  await clock.mockIncreaseTerm()
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
                  await clock.mockIncreaseTerm()
                })

                context('when jurors have not been selected for other drafts', () => {
                  context('for the first batch', () => {
                    const batchRequestedJurors = 3
                    const previousSelectedJurors = 0

                    itReturnsExpectedJurors({ previousSelectedJurors, batchRequestedJurors, roundRequestedJurors })

                    it('changes for different dispute ids', async () => {
                      const disputeId = 1
                      const { addresses, weights } = await draft({ disputeId, batchRequestedJurors, roundRequestedJurors })
                      const expectedJurors = await updateJurorsAndSimulateDraft({ batchRequestedJurors, roundRequestedJurors })
                      assert.isNotTrue(expectedJurors.reduce((acc, juror, i) => acc && weights[i] == juror.weight && addresses[i] == juror.address, true), 'jurors should not match')
                    })

                    it('changes for different term randomness', async () => {
                      const { addresses, weights } = await draft({ termRandomness: sha3('0x1'), batchRequestedJurors, roundRequestedJurors })
                      const expectedJurors = await updateJurorsAndSimulateDraft({ batchRequestedJurors, roundRequestedJurors })
                      assert.isNotTrue(expectedJurors.reduce((acc, juror, i) => acc && weights[i] == juror.weight && addresses[i] == juror.address, true), 'jurors should not match')
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

                        beforeEach('deactivate', async () => {
                          const firstExpectedJuror = await getFirstExpectedJuror(batchRequestedJurors, roundRequestedJurors)
                          await registry.deactivate(0, { from: firstExpectedJuror })
                          const { active } = await registry.balanceOf(firstExpectedJuror)
                          assert.equal(active.toString(), 0, 'first expected juror active balance does not match')
                        })

                        itReturnsExpectedJurors({ previousSelectedJurors, batchRequestedJurors, roundRequestedJurors })
                      })

                      context('for the second batch', () => {
                        const batchRequestedJurors = 7
                        const previousSelectedJurors = 3

                        beforeEach('deactivate', async () => {
                          const firstExpectedJuror = await getFirstExpectedJuror(batchRequestedJurors, roundRequestedJurors)
                          await registry.deactivate(0, { from: firstExpectedJuror })
                          const { active } = await registry.balanceOf(firstExpectedJuror)
                          assert.equal(active.toString(), 0, 'first expected juror active balance does not match')
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
