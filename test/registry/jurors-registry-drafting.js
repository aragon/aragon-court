const { sha3 } = require('web3-utils')
const { bn, bigExp } = require('../helpers/numbers')
const { assertRevert } = require('../helpers/assertThrow')
const { decodeEventsOfType } = require('../helpers/decodeEvent')
const { getEventAt, getEventArgument } = require('@aragon/test-helpers/events')
const { assertAmountOfEvents, assertEvent } = require('../helpers/assertEvent')

const JurorsRegistry = artifacts.require('JurorsRegistry')
const ERC20 = artifacts.require('ERC20Mock')
const JurorsRegistryOwnerMock = artifacts.require('JurorsRegistryOwnerMock')

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

contract('JurorsRegistry', ([_, juror500, juror1000, juror1500, juror2000, juror2500, juror3000, juror3500, juror4000]) => {
  let registry, registryOwner, ANJ

  const DRAFT_LOCK_PCT = bn(2000) // 20%
  const MIN_ACTIVE_AMOUNT = bigExp(100, 18)
  const ACTIVATE_DATA = sha3('activate(uint256)').slice(0, 10)

  const jurors = [
    { address: juror500,  initialActiveBalance: bigExp(500,  18) },
    { address: juror1000, initialActiveBalance: bigExp(1000, 18) },
    { address: juror1500, initialActiveBalance: bigExp(1500, 18) },
    { address: juror2000, initialActiveBalance: bigExp(2000, 18) },
    { address: juror2500, initialActiveBalance: bigExp(2500, 18) },
    { address: juror3000, initialActiveBalance: bigExp(3000, 18) },
    { address: juror3500, initialActiveBalance: bigExp(3500, 18) },
    { address: juror4000, initialActiveBalance: bigExp(4000, 18) },
  ]

  /** These tests are using a fixed seed to make sure we generate the same output on each run */
  const DISPUTE_ID = 0
  const EMPTY_RANDOMNESS = '0x0000000000000000000000000000000000000000000000000000000000000000'

  beforeEach('create base contracts', async () => {
    registry = await JurorsRegistry.new()
    registryOwner = await JurorsRegistryOwnerMock.new(registry.address)
    ANJ = await ERC20.new('ANJ Token', 'ANJ', 18)
  })

  describe('draft', () => {
    const draft = async ({ termRandomness = EMPTY_RANDOMNESS, disputeId = DISPUTE_ID, selectedJurors = 0, batchRequestedJurors, roundRequestedJurors }) => {
      return registryOwner.draft(termRandomness, disputeId, selectedJurors, batchRequestedJurors, roundRequestedJurors, DRAFT_LOCK_PCT)
    }

    context('when the registry is already initialized', () => {
      beforeEach('initialize registry and mint ANJ for jurors', async () => {
        await registry.init(registryOwner.address, ANJ.address, MIN_ACTIVE_AMOUNT)
        for (let i = 0; i < jurors.length; i++) {
          await ANJ.generateTokens(jurors[i].address, jurors[i].initialActiveBalance)
        }
      })

      context('when the sender is the registry owner', () => {
        const itReverts = (previousSelectedJurors, batchRequestedJurors, roundRequestedJurors) => {
          // NOTE: this scenario is not being handled, the registry trusts the input from the owner and the tree
          it('reverts', async () => {
            await assertRevert(draft({ previousSelectedJurors, batchRequestedJurors, roundRequestedJurors }))
          })
        }

        const itReturnsEmptyValues = (batchRequestedJurors, roundRequestedJurors) => {
          it('returns empty values', async () => {
            const receipt = await draft({ batchRequestedJurors, roundRequestedJurors })
            const { addresses, weights, outputLength, selectedJurors } = getEventAt(receipt, 'Drafted').args

            assert.equal(outputLength.toString(), 0, 'output length does not match')
            assert.equal(selectedJurors.toString(), 0, 'amount of selected jurors does not match')
            assert.isEmpty(addresses, 'jurors address do not match')
            assert.isEmpty(weights, 'jurors weights do not match')
          })

          it('does not emit JurorDrafted events', async () => {
            const receipt = await draft({ batchRequestedJurors, roundRequestedJurors })
            const logs = decodeEventsOfType(receipt, JurorsRegistry.abi, 'JurorDrafted')

            assertAmountOfEvents({ logs }, 'JurorDrafted', 0)
          })
        }

        const itReturnsExpectedJurors = ({ termRandomness = EMPTY_RANDOMNESS, disputeId = 0, previousSelectedJurors = 0, batchRequestedJurors, roundRequestedJurors }, expectedAddresses, expectedWeights) => {
          if (previousSelectedJurors > 0) {
            beforeEach('run previous batch', async () => {
              await draft({ termRandomness, disputeId, previousSelectedJurors: 0, batchRequestedJurors: previousSelectedJurors, roundRequestedJurors })
            })
          }

          it('returns the expected jurors', async () => {
            const receipt = await draft({ termRandomness, disputeId, previousSelectedJurors, batchRequestedJurors, roundRequestedJurors })
            const { addresses, weights, outputLength, selectedJurors } = getEventAt(receipt, 'Drafted').args

            assert.equal(outputLength.toString(), expectedWeights.length, 'output length does not match')
            assert.equal(outputLength.toString(), expectedAddresses.length, 'output length does not match')

            assert.equal(selectedJurors.toString(), batchRequestedJurors, 'amount of selected jurors does not match')
            assert.equal(selectedJurors, expectedWeights.reduce((a, b) => a + b, 0), 'total weight does not match')

            assert.lengthOf(weights, batchRequestedJurors, 'jurors weights do not match')
            assert.lengthOf(addresses, batchRequestedJurors, 'jurors address do not match')

            for (let i = 0; i < batchRequestedJurors; i++) {
              assert.equal(weights[i], expectedWeights[i] || 0, `weight #${i} does not match`)
              assert.equal(addresses[i], expectedAddresses[i] || ZERO_ADDRESS, `juror address #${i} does not match`)
            }
          })

          it('emits JurorDrafted events', async () => {
            const receipt = await draft({ termRandomness, disputeId, previousSelectedJurors, batchRequestedJurors, roundRequestedJurors })
            const logs = decodeEventsOfType(receipt, JurorsRegistry.abi, 'JurorDrafted')

            const { addresses, outputLength } = getEventAt(receipt, 'Drafted').args
            assertAmountOfEvents({ logs }, 'JurorDrafted', batchRequestedJurors)

            let nextEventIndex = 0
            for (let i = 0; i < outputLength.toNumber(); i++) {
              for (let j = 0; j < expectedWeights[i]; j++) {
                assertEvent({ logs }, 'JurorDrafted', { disputeId, juror: addresses[i] }, nextEventIndex)
                nextEventIndex++
              }
            }
          })

          it('lock the corresponding amount of active balances for the expected jurors', async () => {
            const previousLockedBalances = {}
            for(let i = 0; i < jurors.length; i++) {
              const address = jurors[i].address
              previousLockedBalances[address] = (await registry.balanceOf(address))[2]
            }

            const receipt = await draft({ termRandomness, disputeId, previousSelectedJurors, batchRequestedJurors, roundRequestedJurors })
            const outputLength = getEventArgument(receipt, 'Drafted', 'outputLength')

            for (let i = 0; i < outputLength.toNumber(); i++) {
              const currentLockedBalance = (await registry.balanceOf(expectedAddresses[i]))[2]
              const previousLockedBalance = previousLockedBalances[expectedAddresses[i]]
              const expectedLockedBalance = expectedWeights[i] * (MIN_ACTIVE_AMOUNT.mul(DRAFT_LOCK_PCT).div(bn(10000)))
              assert.equal(currentLockedBalance.sub(previousLockedBalance).toString(), expectedLockedBalance, `locked balance for juror #${i} does not match`)
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
                  await registryOwner.mockIncreaseTerm()
                })

                context('when juror has enough unlocked balance to be drafted', () => {
                  context('for the first batch', () => {
                    const batchRequestedJurors = 3
                    const previousSelectedJurors = 0

                    const expectedWeights = [3]
                    const expectedAddresses = [juror500]

                    itReturnsExpectedJurors({ previousSelectedJurors, batchRequestedJurors, roundRequestedJurors }, expectedAddresses, expectedWeights)
                  })

                  context('for the second batch', () => {
                    const batchRequestedJurors = 7
                    const previousSelectedJurors = 3

                    const expectedWeights = [7]
                    const expectedAddresses = [juror500]

                    itReturnsExpectedJurors({ previousSelectedJurors, batchRequestedJurors, roundRequestedJurors }, expectedAddresses, expectedWeights)
                  })
                })

                context('when juror does not have enough unlocked balance to be drafted', () => {
                  beforeEach('draft juror', async () => {
                    // lock per draft is 20% of the min active balance, we need to lock 500 tokens which is 25 seats
                    await draft({ batchRequestedJurors: 25, roundRequestedJurors: 25 })
                  })

                  itReverts(0, 1, 1)
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
                    await registryOwner.mockIncreaseTerm()
                  })

                  context('for the first batch', () => {
                    const batchRequestedJurors = 1
                    const previousSelectedJurors = 0

                    const expectedWeights = [1]
                    const expectedAddresses = [juror500]

                    itReturnsExpectedJurors({ previousSelectedJurors, batchRequestedJurors, roundRequestedJurors }, expectedAddresses, expectedWeights)
                  })

                  context('for the second batch', () => {
                    const batchRequestedJurors = 4
                    const previousSelectedJurors = 1

                    const expectedWeights = [1, 1, 2]
                    const expectedAddresses = [juror2000, juror3000, juror3500]

                    itReturnsExpectedJurors({ previousSelectedJurors, batchRequestedJurors, roundRequestedJurors }, expectedAddresses, expectedWeights)
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
                    await registryOwner.mockIncreaseTerm()
                  })

                  context('when jurors have not been selected for other drafts', () => {
                    context('for the first batch', () => {
                      const batchRequestedJurors = 3
                      const previousSelectedJurors = 0

                      const expectedWeights = [2, 1]
                      const expectedAddresses = [juror1000, juror2000]

                      itReturnsExpectedJurors({ previousSelectedJurors, batchRequestedJurors, roundRequestedJurors }, expectedAddresses, expectedWeights)

                      it('changes for different dispute ids', async () => {
                        const { weights, addresses } = await draft({ disputeId: 1, batchRequestedJurors, roundRequestedJurors })
                        assert.notEqual(expectedWeights, weights, 'weights should not match')
                        assert.notEqual(expectedAddresses, addresses, 'jurors addresses should not match')
                      })

                      it('changes for different term randomness', async () => {
                        const { weights, addresses } = await draft({ termRandomness: '0x1', batchRequestedJurors, roundRequestedJurors })
                        assert.notEqual(expectedWeights, weights, 'weights should not match')
                        assert.notEqual(expectedAddresses, addresses, 'jurors addresses should not match')
                      })
                    })

                    context('for the second batch', () => {
                      const batchRequestedJurors = 7
                      const previousSelectedJurors = 3

                      const expectedWeights = [2, 4, 1]
                      const expectedAddresses = [juror2000, juror3000, juror3500]

                      itReturnsExpectedJurors({ previousSelectedJurors, batchRequestedJurors, roundRequestedJurors }, expectedAddresses, expectedWeights)
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

                        const expectedWeights = [2, 1]
                        const expectedAddresses = [juror1000, juror2000]

                        itReturnsExpectedJurors({ previousSelectedJurors, batchRequestedJurors, roundRequestedJurors }, expectedAddresses, expectedWeights)
                      })

                      context('for the second batch', () => {
                        const batchRequestedJurors = 7
                        const previousSelectedJurors = 3

                        const expectedWeights = [2, 4, 1]
                        const expectedAddresses = [juror2000, juror3000, juror3500]

                        itReturnsExpectedJurors({ previousSelectedJurors, batchRequestedJurors, roundRequestedJurors }, expectedAddresses, expectedWeights)
                      })
                    })

                    context('when some jurors do not have been enough balance to be drafted again', () => {
                      beforeEach('compute multiple previous drafts', async () => {
                        // draft enough times to leave the first drafted juror (juror1000) without unlocked balance
                        while ((await registry.unlockedActiveBalanceOf(juror1000)).gt(bn(0))) {
                          await draft({ batchRequestedJurors: 3, roundRequestedJurors })
                        }

                        const { active, locked } = await registry.balanceOf(juror1000)
                        assert.equal(active.toString(), locked.toString(), 'juror1000 locked balance does not match')
                      })

                      context('for the first batch', () => {
                        const batchRequestedJurors = 3
                        const previousSelectedJurors = 0

                        const expectedWeights = [3]
                        const expectedAddresses = [juror2000]

                        itReturnsExpectedJurors({ previousSelectedJurors, batchRequestedJurors, roundRequestedJurors }, expectedAddresses, expectedWeights)
                      })

                      context('for the second batch', () => {
                        const batchRequestedJurors = 7
                        const previousSelectedJurors = 3

                        const expectedWeights = [2, 4, 1]
                        const expectedAddresses = [juror2000, juror3000, juror3500]

                        itReturnsExpectedJurors({ previousSelectedJurors, batchRequestedJurors, roundRequestedJurors }, expectedAddresses, expectedWeights)
                      })
                    })
                  })
                })
              })
            })
          })
        })
      })

      context('when the sender is not the registry owner', () => {
        it('reverts', async () => {
          await assertRevert(registry.draft([0,0,0,0,0,0,0]), 'JR_SENDER_NOT_OWNER')
        })
      })
    })

    context('when the registry is not initialized', () => {
      it('reverts', async () => {
        await assertRevert(draft({ batchRequestedJurors: 1, roundRequestedJurors: 1 }), 'JR_SENDER_NOT_OWNER')
      })
    })
  })
})
