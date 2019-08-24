const { bn, bigExp } = require('../helpers/numbers')(web3)
const { getEventAt } = require('@aragon/test-helpers/events')
const { assertRevert } = require('@aragon/test-helpers/assertThrow')

const JurorsRegistry = artifacts.require('JurorsRegistry')
const MiniMeToken = artifacts.require('MiniMeToken')
const JurorsRegistryOwnerMock = artifacts.require('JurorsRegistryOwnerMock')

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const NO_DATA = '0x0000000000000000000000000000000000000000000000000000000000000000'

contract('JurorsRegistry drafting', ([_, juror500, juror1000, juror1500, juror2000, juror2500, juror3000, juror3500, juror4000]) => {
  let registry, registryOwner, ANJ

  const DRAFT_LOCK_PCT = bn(2000) // 20%
  const MIN_ACTIVE_AMOUNT = bigExp(100, 18)
  const ACTIVATE_DATA = web3.sha3('activate(uint256)').slice(0, 10)

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

  beforeEach('create base contracts', async () => {
    registry = await JurorsRegistry.new()
    registryOwner = await JurorsRegistryOwnerMock.new(registry.address)
    ANJ = await MiniMeToken.new(ZERO_ADDRESS, ZERO_ADDRESS, 0, 'n', 18, 'ANJ', true)
  })

  describe('draft', () => {
    const draft = async ({ termRandomness = NO_DATA, disputeId = 0, selectedJurors = 0, batchRequestedJurors, roundRequestedJurors, lockPct = DRAFT_LOCK_PCT }) => {
      const receipt = await registryOwner.draft(termRandomness, disputeId, selectedJurors, batchRequestedJurors, roundRequestedJurors, lockPct)
      return getEventAt(receipt, 'Drafted').args
    }

    context('when the registry is already initialized', () => {
      beforeEach('initialize registry and mint ANJ for jurors', async () => {
        await registry.init(registryOwner.address, ANJ.address, MIN_ACTIVE_AMOUNT)
        for (let i = 0; i < jurors.length; i++) {
          await ANJ.generateTokens(jurors[i].address, jurors[i].initialActiveBalance)
        }
      })

      context('when the sender is the registry owner', () => {
        const assertEmptyDraftOutput = output => {
          const { addresses, weights, outputLength, selectedJurors } = output

          assert.equal(outputLength.toString(), 0, 'output length does not match')
          assert.equal(selectedJurors.toString(), 0, 'amount of selected jurors does not match')

          assert.isEmpty(addresses, 'jurors address do not match')
          assert.isEmpty(weights, 'jurors weights do not match')
        }

        const assertDraftOutput = async (output, requestedJurors, expectedAddresses, expectedWeights, previousLockedBalances = {}) => {
          const { addresses, weights, outputLength, selectedJurors } = output

          assert.equal(outputLength.toString(), expectedWeights.length, 'output length does not match')
          assert.equal(outputLength.toString(), expectedAddresses.length, 'output length does not match')

          assert.equal(selectedJurors.toString(), requestedJurors, 'amount of selected jurors does not match')
          assert.equal(selectedJurors, expectedWeights.reduce((a, b) => a + b, 0), 'total weight does not match')

          assert.lengthOf(weights, requestedJurors, 'jurors weights do not match')
          assert.lengthOf(addresses, requestedJurors, 'jurors address do not match')

          for (let i = 0; i < requestedJurors; i++) {
            assert.equal(weights[i], expectedWeights[i] || 0, `weight #${i} does not match`)
            assert.equal(addresses[i], expectedAddresses[i] || ZERO_ADDRESS, `juror address #${i} does not match`)

            if (expectedAddresses[i]) {
              const lockedBalance = (await registry.balanceOf(expectedAddresses[i]))[2]
              const previousLockedBalance = previousLockedBalances[expectedAddresses[i]] || 0
              const expectedLockedBalance = expectedWeights[i] * (MIN_ACTIVE_AMOUNT * DRAFT_LOCK_PCT / 10000)
              assert.equal(lockedBalance.minus(previousLockedBalance).toString(), expectedLockedBalance, `locked balance for juror #${i} does not match`)
            }
          }
        }

        context('when there are no activated jurors', () => {
          context('when no jurors were requested', () => {
            const batchRequestedJurors = 0
            const roundRequestedJurors = 0

            it('returns empty values', async () => {
              const output = await draft({ batchRequestedJurors, roundRequestedJurors })
              assertEmptyDraftOutput(output)
            })
          })

          context('when some jurors were requested', () => {
            const roundRequestedJurors = 10

            context('for the first batch', () => {
              const batchRequestedJurors = 3

              // NOTE: this scenario is not being handled, the registry trusts the input from the owner and the tree
              it('reverts', async () => {
                await assertRevert(draft({ batchRequestedJurors, roundRequestedJurors }))
              })
            })

            context('for the second batch', () => {
              const batchRequestedJurors = 7

              // NOTE: this scenario is not being handled, the registry trusts the input from the owner and the tree
              it('reverts', async () => {
                await assertRevert(draft({ batchRequestedJurors, roundRequestedJurors }))
              })
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

              it('returns empty values', async () => {
                const output = await draft({ batchRequestedJurors, roundRequestedJurors })
                assertEmptyDraftOutput(output)
              })
            })

            context('when some jurors were requested', () => {
              const roundRequestedJurors = 10

              context('when the jurors are activated for the following term', () => {
                context('for the first batch', () => {
                  const batchRequestedJurors = 3

                  // NOTE: this scenario is not being handled, the registry trusts the input from the owner and the tree
                  it('reverts', async () => {
                    await assertRevert(draft({ batchRequestedJurors, roundRequestedJurors }))
                  })
                })

                context('for the second batch', () => {
                  const batchRequestedJurors = 7

                  // NOTE: this scenario is not being handled, the registry trusts the input from the owner and the tree
                  it('reverts', async () => {
                    await assertRevert(draft({ batchRequestedJurors, roundRequestedJurors }))
                  })
                })
              })

              context('when the jurors are activated for the current term', () => {
                beforeEach('increment term', async () => {
                  await registryOwner.incrementTerm()
                })

                context('when juror has enough unlocked balance to be drafted', () => {
                  context('for the first batch', () => {
                    const batchRequestedJurors = 3

                    const expectedWeights = [3]
                    const expectedAddresses = [juror500]

                    it('returns expected jurors', async () => {
                      const output = await draft({ batchRequestedJurors, roundRequestedJurors })
                      await assertDraftOutput(output, batchRequestedJurors, expectedAddresses, expectedWeights)
                    })
                  })

                  context('for the second batch', () => {
                    const batchRequestedJurors = 7

                    const expectedWeights = [7]
                    const expectedAddresses = [juror500]

                    it('returns expected jurors', async () => {
                      const output = await draft({ batchRequestedJurors, roundRequestedJurors })
                      await assertDraftOutput(output, batchRequestedJurors, expectedAddresses, expectedWeights)
                    })
                  })
                })

                context('when juror does not have enough unlocked balance to be drafted', () => {
                  beforeEach('draft juror', async () => {
                    // lock per draft is 20% of the min active balance, we need to lock 500 tokens which is 25 seats
                    await draft({ batchRequestedJurors: 25, roundRequestedJurors: 25 })
                  })

                  it('reverts', async () => {
                    await assertRevert(draft({ batchRequestedJurors: 1, roundRequestedJurors: 1 }))
                  })
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

              it('returns empty values', async () => {
                const output = await draft({ batchRequestedJurors, roundRequestedJurors })
                assertEmptyDraftOutput(output)
              })
            })

            context('when some jurors were requested', () => {
              context('when there were requested less jurors than the active ones', () => {
                const roundRequestedJurors = 5

                context('when the jurors are activated for the following term', () => {
                  context('for the first batch', () => {
                    const batchRequestedJurors = 1

                    // NOTE: this scenario is not being handled, the registry trusts the input from the owner and the tree
                    it('reverts', async () => {
                      await assertRevert(draft({ batchRequestedJurors, roundRequestedJurors }))
                    })
                  })

                  context('for the second batch', () => {
                    const batchRequestedJurors = 4

                    // NOTE: this scenario is not being handled, the registry trusts the input from the owner and the tree
                    it('reverts', async () => {
                      await assertRevert(draft({ batchRequestedJurors, roundRequestedJurors }))
                    })
                  })
                })

                context('when the jurors are activated for the current term', () => {
                  beforeEach('increment term', async () => {
                    await registryOwner.incrementTerm()
                  })

                  context('for the first batch', () => {
                    const batchRequestedJurors = 1

                    const expectedWeights = [1]
                    const expectedAddresses = [juror1500]

                    it('returns expected jurors', async () => {
                      const output = await draft({ batchRequestedJurors, roundRequestedJurors })
                      await assertDraftOutput(output, batchRequestedJurors, expectedAddresses, expectedWeights)
                    })
                  })

                  context('for the second batch', () => {
                    const batchRequestedJurors = 4

                    const expectedWeights = [2, 1, 1]
                    const expectedAddresses = [juror1500, juror3000, juror3500]

                    it('returns expected jurors', async () => {
                      const output = await draft({ batchRequestedJurors, roundRequestedJurors })
                      await assertDraftOutput(output, batchRequestedJurors, expectedAddresses, expectedWeights)
                    })
                  })
                })
              })

              context('when there were requested more jurors than the active ones', () => {
                const roundRequestedJurors = 10

                context('when the jurors are activated for the following term', () => {
                  context('for the first batch', () => {
                    const batchRequestedJurors = 3

                    // NOTE: this scenario is not being handled, the registry trusts the input from the owner and the tree
                    it('reverts', async () => {
                      await assertRevert(draft({ batchRequestedJurors, roundRequestedJurors }))
                    })
                  })

                  context('for the second batch', () => {
                    const batchRequestedJurors = 7

                    // NOTE: this scenario is not being handled, the registry trusts the input from the owner and the tree
                    it('reverts', async () => {
                      await assertRevert(draft({ batchRequestedJurors, roundRequestedJurors }))
                    })
                  })
                })

                context('when the jurors are activated for the current term', () => {
                  beforeEach('increment term', async () => {
                    await registryOwner.incrementTerm()
                  })

                  context('when jurors have not been selected for other drafts', () => {
                    context('for the first batch', () => {
                      const batchRequestedJurors = 3

                      const expectedWeights = [1, 1, 1]
                      const expectedAddresses = [juror500, juror1000, juror2000]

                      it('returns expected jurors', async () => {
                        const output = await draft({ batchRequestedJurors, roundRequestedJurors })
                        await assertDraftOutput(output, batchRequestedJurors, expectedAddresses, expectedWeights)
                      })

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

                      const expectedWeights = [1, 2, 1, 2, 1]
                      const expectedAddresses = [juror1000, juror1500, juror2000, juror3000, juror3500]

                      it('returns expected jurors', async () => {
                        const output = await draft({ batchRequestedJurors, roundRequestedJurors })
                        await assertDraftOutput(output, batchRequestedJurors, expectedAddresses, expectedWeights)
                      })
                    })
                  })

                  context('when jurors have been selected for other drafts', () => {
                    let previousLockedBalances

                    context('when all jurors have been enough balance to be drafted again', () => {
                      beforeEach('draft and compute previous locked balances', async () => {
                        previousLockedBalances = {}
                        const { addresses, weights, outputLength } = await draft({ batchRequestedJurors: 3, roundRequestedJurors: 3 })

                        for(let i = 0; i < outputLength; i++) {
                          const lockedBalance = weights[i] * (MIN_ACTIVE_AMOUNT * DRAFT_LOCK_PCT / 10000)
                          previousLockedBalances[addresses[i]] = (previousLockedBalances[addresses[i]] || 0) + lockedBalance
                        }
                      })

                      context('for the first batch', () => {
                        const batchRequestedJurors = 3

                        const expectedWeights = [1, 1, 1]
                        const expectedAddresses = [juror500, juror1000, juror2000]

                        it('returns expected jurors', async () => {
                          const output = await draft({ batchRequestedJurors, roundRequestedJurors })
                          await assertDraftOutput(output, batchRequestedJurors, expectedAddresses, expectedWeights, previousLockedBalances)
                        })
                      })

                      context('for the second batch', () => {
                        const batchRequestedJurors = 7

                        const expectedWeights = [1, 2, 1, 2, 1]
                        const expectedAddresses = [juror1000, juror1500, juror2000, juror3000, juror3500]

                        it('returns expected jurors', async () => {
                          const output = await draft({ batchRequestedJurors, roundRequestedJurors })
                          await assertDraftOutput(output, batchRequestedJurors, expectedAddresses, expectedWeights, previousLockedBalances)
                        })
                      })
                    })

                    context('when some jurors do not have been enough balance to be drafted again', () => {
                      beforeEach('draft and compute previous locked balances', async () => {
                        previousLockedBalances = {}

                        // draft enough times to leave the first juror without unlocked balance
                        for(let i = 0; i < 50; i++) {
                          const { addresses, weights, outputLength } = await draft({ batchRequestedJurors: 3, roundRequestedJurors })

                          for(let j = 0; j < outputLength; j++) {
                            const lockedBalance = weights[j] * (MIN_ACTIVE_AMOUNT * DRAFT_LOCK_PCT / 10000)
                            previousLockedBalances[addresses[j]] = (previousLockedBalances[addresses[j]] || 0) + lockedBalance
                          }
                        }
                      })

                      context('for the first batch', () => {
                        const batchRequestedJurors = 3

                        const expectedWeights = [3]
                        const expectedAddresses = [juror2000]

                        it('returns expected jurors', async () => {
                          const output = await draft({ batchRequestedJurors, roundRequestedJurors })
                          await assertDraftOutput(output, batchRequestedJurors, expectedAddresses, expectedWeights, previousLockedBalances)
                        })
                      })

                      context('for the second batch', () => {
                        const batchRequestedJurors = 7

                        const expectedWeights = [2, 1, 2, 2]
                        const expectedAddresses = [juror1500, juror2000, juror3000, juror3500]

                        it('returns expected jurors', async () => {
                          const output = await draft({ batchRequestedJurors, roundRequestedJurors })
                          await assertDraftOutput(output, batchRequestedJurors, expectedAddresses, expectedWeights, previousLockedBalances)
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

      context('when the sender is not the registry owner', () => {
        it('reverts', async () => {
          await assertRevert(registry.draft(new Array(7)), 'JR_SENDER_NOT_OWNER')
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
