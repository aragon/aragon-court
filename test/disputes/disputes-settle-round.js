const { assertBn } = require('../helpers/asserts/assertBn')
const { bn, bigExp } = require('../helpers/lib/numbers')
const { assertRevert } = require('../helpers/asserts/assertThrow')
const { decodeEventsOfType } = require('../helpers/lib/decodeEvent')
const { DISPUTE_MANAGER_ERRORS, REGISTRY_ERRORS } = require('../helpers/utils/errors')
const { filterJurors, filterWinningJurors } = require('../helpers/utils/jurors')
const { assertAmountOfEvents, assertEvent } = require('../helpers/asserts/assertEvent')
const { getVoteId, oppositeOutcome, OUTCOMES } = require('../helpers/utils/crvoting')
const { ARBITRABLE_EVENTS, DISPUTE_MANAGER_EVENTS, REGISTRY_EVENTS } = require('../helpers/utils/events')
const { buildHelper, ROUND_STATES, DISPUTE_STATES, DEFAULTS } = require('../helpers/wrappers/court')(web3, artifacts)

const DisputeManager = artifacts.require('DisputeManager')
const Arbitrable = artifacts.require('ArbitrableMock')

contract('DisputeManager', ([_, drafter, appealMaker, appealTaker, juror500, juror1000, juror1500, juror2000, juror2500, juror3000, juror3500, juror4000, anyone]) => {
  let courtHelper, court, disputeManager, voting
  const maxRegularAppealRounds = bn(2)

  const jurors = [
    { address: juror3000, initialActiveBalance: bigExp(3000, 18) },
    { address: juror500,  initialActiveBalance: bigExp(500,  18) },
    { address: juror1000, initialActiveBalance: bigExp(1000, 18) },
    { address: juror2000, initialActiveBalance: bigExp(2000, 18) },
    { address: juror4000, initialActiveBalance: bigExp(4000, 18) },
    { address: juror1500, initialActiveBalance: bigExp(1500, 18) },
    { address: juror3500, initialActiveBalance: bigExp(3500, 18) },
    { address: juror2500, initialActiveBalance: bigExp(2500, 18) }
  ]

  const BURN_ADDRESS = '0x000000000000000000000000000000000000dEaD'

  beforeEach('create court', async () => {
    courtHelper = buildHelper()
    court = await courtHelper.deploy({ maxRegularAppealRounds })
    voting = courtHelper.voting
    disputeManager = courtHelper.disputeManager
  })

  describe('settle round', () => {
    context('when the given dispute exists', () => {
      let disputeId, voteId
      const draftTermId = 4

      beforeEach('activate jurors and create dispute', async () => {
        await courtHelper.activate(jurors)

        disputeId = await courtHelper.dispute({ draftTermId })
        await courtHelper.passTerms(bn(1)) // court is already at term previous to dispute start
      })

      context('when the given round is valid', () => {
        const roundId = 0
        const voters = [
          { address: juror1000, weight: 1, outcome: OUTCOMES.LEAKED },
          { address: juror2000, weight: 1, outcome: OUTCOMES.HIGH },
          { address: juror4000, weight: 1, outcome: OUTCOMES.LOW }
        ]

        const itIsAtState = (roundId, state) => {
          it(`round is at state ${state}`, async () => {
            const { roundState } = await courtHelper.getRound(disputeId, roundId)
            assertBn(roundState, state, 'round state does not match')
          })
        }

        const itFailsToRuleAndSettleRound = (roundId) => {
          it('fails to compute ruling and settle round', async () => {
            await assertRevert(disputeManager.computeRuling(disputeId), DISPUTE_MANAGER_ERRORS.INVALID_ADJUDICATION_STATE)
            await assertRevert(disputeManager.settlePenalties(disputeId, roundId, DEFAULTS.firstRoundJurorsNumber), DISPUTE_MANAGER_ERRORS.INVALID_ADJUDICATION_STATE)
            await assertRevert(disputeManager.settleReward(disputeId, roundId, anyone), DISPUTE_MANAGER_ERRORS.ROUND_PENALTIES_NOT_SETTLED)
          })
        }

        const itExecutesFinalRulingProperly = expectedFinalRuling => {
          describe('executeRuling', () => {
            it('marks the dispute ruling as computed but not twice', async () => {
              const receipt = await court.executeRuling(disputeId)

              const logs = decodeEventsOfType(receipt, DisputeManager.abi, DISPUTE_MANAGER_EVENTS.RULING_COMPUTED)
              assertAmountOfEvents({ logs }, DISPUTE_MANAGER_EVENTS.RULING_COMPUTED)
              assertEvent({ logs }, DISPUTE_MANAGER_EVENTS.RULING_COMPUTED, { disputeId, ruling: expectedFinalRuling })

              const { possibleRulings, state, finalRuling } = await courtHelper.getDispute(disputeId)
              assertBn(state, DISPUTE_STATES.RULED, 'dispute state does not match')
              assertBn(possibleRulings, 2, 'dispute possible rulings do not match')
              assertBn(finalRuling, expectedFinalRuling, 'dispute final ruling does not match')

              const anotherReceipt = await court.executeRuling(disputeId)
              const anotherLogs = decodeEventsOfType(anotherReceipt, DisputeManager.abi, DISPUTE_MANAGER_EVENTS.RULING_COMPUTED)
              assertAmountOfEvents({ logs: anotherLogs }, DISPUTE_MANAGER_EVENTS.RULING_COMPUTED, 0)
            })

            it('executes the final ruling on the arbitrable', async () => {
              const receipt = await court.executeRuling(disputeId)

              const logs = decodeEventsOfType(receipt, Arbitrable.abi, ARBITRABLE_EVENTS.RULED)
              assertAmountOfEvents({ logs }, ARBITRABLE_EVENTS.RULED)
              assertEvent({ logs }, ARBITRABLE_EVENTS.RULED, { arbitrator: court.address, disputeId, ruling: expectedFinalRuling })
            })
          })
        }

        const itSettlesPenaltiesAndRewardsProperly = (roundId, expectedWinningJurors, expectedLosingJurors) => {
          let arbitrable, previousBalances = {}, expectedCoherentJurors, expectedCollectedTokens

          beforeEach('load previous balances', async () => {
            previousBalances = {}
            for (const { address } of jurors) {
              const { active, available, locked } = await courtHelper.jurorsRegistry.balanceOf(address)
              previousBalances[address] = { active, available, locked }
            }

            const { active, available, locked } = await courtHelper.jurorsRegistry.balanceOf(BURN_ADDRESS)
            previousBalances[BURN_ADDRESS] = { active, available, locked }

            const { feeToken, treasury } = courtHelper
            arbitrable = (await courtHelper.getDispute(disputeId)).subject
            previousBalances[arbitrable] = { feeAmount: await treasury.balanceOf(feeToken.address, arbitrable) }
            previousBalances[appealMaker] = { feeAmount: await treasury.balanceOf(feeToken.address, appealMaker) }
            previousBalances[appealTaker] = { feeAmount: await treasury.balanceOf(feeToken.address, appealTaker) }
          })

          beforeEach('load expected coherent jurors', async () => {
            // for final rounds compute voter's weight
            if (roundId >= courtHelper.maxRegularAppealRounds.toNumber()) {
              for (const juror of expectedWinningJurors) {
                juror.weight = (await courtHelper.getFinalRoundWeight(disputeId, roundId, juror.address)).toNumber()
              }
            }
            expectedCoherentJurors = expectedWinningJurors.reduce((total, { weight }) => total + weight, 0)
          })

          beforeEach('load expected collected tokens', async () => {
            expectedCollectedTokens = bn(0)
            for (const { address } of expectedLosingJurors) {
              const roundLockedBalance = await courtHelper.getRoundLockBalance(disputeId, roundId, address)
              expectedCollectedTokens = expectedCollectedTokens.add(roundLockedBalance)
            }

            // for final rounds add winning jurors locked amounts since all voter's tokens are collected before hand
            if (roundId >= courtHelper.maxRegularAppealRounds.toNumber()) {
              for (const { address } of expectedWinningJurors) {
                const roundLockedBalance = await courtHelper.getRoundLockBalance(disputeId, roundId, address)
                expectedCollectedTokens = expectedCollectedTokens.add(roundLockedBalance)
              }
            }
          })

          describe('settlePenalties', () => {
            let receipt

            const itSettlesPenaltiesProperly = () => {
              it('unlocks the locked balances of the winning jurors', async () => {
                for (const { address } of expectedWinningJurors) {
                  const roundLockedBalance = await courtHelper.getRoundLockBalance(disputeId, roundId, address)

                  const { locked: previousLockedBalance, active: previousActiveBalance } = previousBalances[address]
                  const { active: currentActiveBalance, locked: currentLockedBalance } = await courtHelper.jurorsRegistry.balanceOf(address)
                  assertBn(currentActiveBalance, previousActiveBalance, 'current active balance does not match')

                  // for the final round tokens are slashed before hand, thus they are not considered as locked tokens
                  const expectedLockedBalance = roundId < courtHelper.maxRegularAppealRounds ? previousLockedBalance.sub(roundLockedBalance).toString() : 0
                  assertBn(currentLockedBalance, expectedLockedBalance, 'current locked balance does not match')
                }
              })

              it('slashes the losing jurors', async () => {
                for (const { address } of expectedLosingJurors) {
                  const roundLockedBalance = await courtHelper.getRoundLockBalance(disputeId, roundId, address)

                  const { locked: previousLockedBalance, active: previousActiveBalance } = previousBalances[address]
                  const { active: currentActiveBalance, locked: currentLockedBalance } = await courtHelper.jurorsRegistry.balanceOf(address)

                  // for the final round tokens are slashed before hand, thus the active tokens for slashed jurors stays equal
                  const expectedActiveBalance = roundId < courtHelper.maxRegularAppealRounds
                    ? previousActiveBalance.sub(roundLockedBalance)
                    : previousActiveBalance
                  assertBn(currentActiveBalance, expectedActiveBalance, 'current active balance does not match')

                  // for the final round tokens are slashed before hand, thus they are not considered as locked tokens
                  const expectedLockedBalance = roundId < courtHelper.maxRegularAppealRounds
                    ? previousLockedBalance.sub(roundLockedBalance)
                    : 0
                  assertBn(currentLockedBalance, expectedLockedBalance, 'current locked balance does not match')
                }
              })

              it('burns the collected tokens if necessary', async () => {
                const { available: previousAvailableBalance } = previousBalances[BURN_ADDRESS]
                const { available: currentAvailableBalance } = await courtHelper.jurorsRegistry.balanceOf(BURN_ADDRESS)

                if (expectedCoherentJurors === 0) {
                  assertBn(currentAvailableBalance, previousAvailableBalance.add(expectedCollectedTokens), 'burned balance does not match')
                } else {
                  assertBn(currentAvailableBalance, previousAvailableBalance, 'burned balance does not match')
                }
              })

              it('refunds the jurors fees if necessary', async () => {
                const { jurorFees } = await courtHelper.getRound(disputeId, roundId)
                const { feeToken, treasury } = courtHelper

                if (roundId === 0) {
                  const { feeAmount: previousArbitrableBalance } = previousBalances[arbitrable]
                  const currentArbitrableBalance = await treasury.balanceOf(feeToken.address, arbitrable)

                  expectedCoherentJurors === 0
                    ? assertBn(currentArbitrableBalance, previousArbitrableBalance.add(jurorFees), 'arbitrable fee balance does not match')
                    : assertBn(currentArbitrableBalance, previousArbitrableBalance, 'arbitrable fee balance does not match')
                } else {
                  const { feeAmount: previousAppealMakerBalance } = previousBalances[appealMaker]
                  const currentAppealMakerBalance = await treasury.balanceOf(feeToken.address, appealMaker)

                  const { feeAmount: previousAppealTakerBalance } = previousBalances[appealTaker]
                  const currentAppealTakerBalance = await treasury.balanceOf(feeToken.address, appealTaker)

                  if (expectedCoherentJurors === 0) {
                    const refundFees = jurorFees.div(bn(2))
                    assertBn(currentAppealMakerBalance, previousAppealMakerBalance.add(refundFees), 'appeal maker fee balance does not match')
                    assertBn(currentAppealTakerBalance, previousAppealTakerBalance.add(refundFees), 'appeal taker fee balance does not match')
                  } else {
                    assertBn(currentAppealMakerBalance, previousAppealMakerBalance, 'appeal maker fee balance does not match')
                    assertBn(currentAppealTakerBalance, previousAppealTakerBalance, 'appeal taker fee balance does not match')
                  }
                }
              })

              it('updates the given round and cannot be settled twice', async () => {
                assertAmountOfEvents(receipt, DISPUTE_MANAGER_EVENTS.PENALTIES_SETTLED)
                assertEvent(receipt, DISPUTE_MANAGER_EVENTS.PENALTIES_SETTLED, { disputeId, roundId, collectedTokens: expectedCollectedTokens })

                const { settledPenalties, collectedTokens, coherentJurors } = await courtHelper.getRound(disputeId, roundId)
                assert.equal(settledPenalties, true, 'current round penalties should be settled')
                assertBn(collectedTokens, expectedCollectedTokens, 'current round collected tokens does not match')
                assertBn(coherentJurors, expectedCoherentJurors, 'current round coherent jurors does not match')

                await assertRevert(disputeManager.settlePenalties(disputeId, roundId, 0), DISPUTE_MANAGER_ERRORS.ROUND_ALREADY_SETTLED)
              })
            }

            context('when settling in one batch', () => {
              beforeEach('settle penalties', async () => {
                receipt = await disputeManager.settlePenalties(disputeId, roundId, 0)
              })

              itSettlesPenaltiesProperly()
            })

            context('when settling in multiple batches', () => {
              if (roundId < DEFAULTS.maxRegularAppealRounds.toNumber()) {
                beforeEach('settle penalties', async () => {
                  const batches = expectedWinningJurors.length + expectedLosingJurors.length
                  for (let batch = 0; batch < batches; batch++) {
                    receipt = await disputeManager.settlePenalties(disputeId, roundId, 1)
                    // assert round is not settle in the middle batches
                    if (batch < batches - 1) assertAmountOfEvents(receipt, DISPUTE_MANAGER_EVENTS.PENALTIES_SETTLED, 0)
                  }
                })

                itSettlesPenaltiesProperly()
              } else {
                it('reverts', async () => {
                  await disputeManager.settlePenalties(disputeId, roundId, 1)

                  await assertRevert(disputeManager.settlePenalties(disputeId, roundId, 1), DISPUTE_MANAGER_ERRORS.ROUND_ALREADY_SETTLED)
                })
              }
            })
          })

          describe('settleReward', () => {
            context('when penalties have been settled', () => {
              beforeEach('settle penalties', async () => {
                await disputeManager.settlePenalties(disputeId, roundId, 0)
              })

              if (expectedWinningJurors.length > 0) {
                it('emits an event for each juror and cannot be settled twice', async () => {
                  for (const { address } of expectedWinningJurors) {
                    const receipt = await disputeManager.settleReward(disputeId, roundId, address)

                    assertAmountOfEvents(receipt, DISPUTE_MANAGER_EVENTS.REWARD_SETTLED)
                    assertEvent(receipt, DISPUTE_MANAGER_EVENTS.REWARD_SETTLED, { disputeId, roundId, juror: address })

                    await assertRevert(disputeManager.settleReward(disputeId, roundId, address), DISPUTE_MANAGER_ERRORS.JUROR_ALREADY_REWARDED)
                  }
                })

                it('rewards the winning jurors with juror tokens', async () => {
                  for (const { address, weight } of expectedWinningJurors) {
                    await disputeManager.settleReward(disputeId, roundId, address)

                    const { weight: actualWeight, rewarded } = await courtHelper.getRoundJuror(disputeId, roundId, address)
                    assert.isTrue(rewarded, 'juror should have been rewarded')
                    assertBn(actualWeight, weight, 'juror weight should not have changed')

                    const { available } = await courtHelper.jurorsRegistry.balanceOf(address)
                    const expectedReward = expectedCollectedTokens.mul(bn(weight)).div(bn(expectedCoherentJurors))
                    const expectedCurrentAvailableBalance = previousBalances[address].available.add(expectedReward)

                    assertBn(expectedCurrentAvailableBalance, available, 'current available balance does not match')
                  }
                })

                it('rewards winning jurors with fees', async () => {
                  const { treasury, feeToken } = courtHelper
                  const { jurorFees } = await courtHelper.getRound(disputeId, roundId)

                  for (const { address, weight } of expectedWinningJurors) {
                    const previousJurorBalance = await treasury.balanceOf(feeToken.address, address)

                    await disputeManager.settleReward(disputeId, roundId, address)

                    const expectedReward = jurorFees.mul(bn(weight)).div(bn(expectedCoherentJurors))
                    const currentJurorBalance = await treasury.balanceOf(feeToken.address, address)
                    assertBn(currentJurorBalance, previousJurorBalance.add(expectedReward), 'juror fee balance does not match')
                  }
                })

                it('does not allow settling non-winning jurors', async () => {
                  for (const { address } of expectedLosingJurors) {
                    await assertRevert(disputeManager.settleReward(disputeId, roundId, address), DISPUTE_MANAGER_ERRORS.WONT_REWARD_INCOHERENT_JUROR)
                  }
                })

                if (roundId >= maxRegularAppealRounds.toNumber()) {
                  context('locks coherent jurors in final round', () => {
                    const amount = bn(1)
                    const data = '0x00'
                    beforeEach('settle reward', async () => {
                      // settle reward and deactivate
                      for (const juror of expectedWinningJurors) {
                        await disputeManager.settleReward(disputeId, roundId, juror.address)
                        await courtHelper.jurorsRegistry.deactivate(0, { from: juror.address }) // deactivate all
                      }
                    })

                    it('locks only after final round lock period', async () => {
                      // fails to withdraw on next term
                      await courtHelper.passTerms(bn(1))
                      for (const juror of expectedWinningJurors) {
                        await assertRevert(courtHelper.jurorsRegistry.unstake(amount, data, { from: juror.address }), REGISTRY_ERRORS.WITHDRAWALS_LOCK)
                      }

                      // fails to withdraw on last locked term
                      const { draftTerm } = await disputeManager.getRound(disputeId, roundId)
                      const lastLockedTermId = draftTerm
                        .add(courtHelper.commitTerms)
                        .add(courtHelper.revealTerms)
                        .add(courtHelper.finalRoundLockTerms)
                      await courtHelper.setTerm(lastLockedTermId)
                      for (const juror of expectedWinningJurors) {
                        await assertRevert(courtHelper.jurorsRegistry.unstake(amount, data, { from: juror.address }), REGISTRY_ERRORS.WITHDRAWALS_LOCK)
                      }

                      // succeeds to withdraw after locked term
                      await courtHelper.passTerms(bn(1))
                      for (const juror of expectedWinningJurors) {
                        const receipt = await courtHelper.jurorsRegistry.unstake(amount, data, { from: juror.address })
                        assertAmountOfEvents(receipt, REGISTRY_EVENTS.UNSTAKED)
                        assertEvent(receipt, REGISTRY_EVENTS.UNSTAKED, { user: juror.address, amount: amount.toString() })
                      }
                    })
                  })
                }
              } else {
                it('does not allow settling non-winning jurors', async () => {
                  for (const { address } of expectedLosingJurors) {
                    await assertRevert(disputeManager.settleReward(disputeId, roundId, address), DISPUTE_MANAGER_ERRORS.WONT_REWARD_INCOHERENT_JUROR)
                  }
                })
              }

              it('does not allow settling non-voting jurors', async () => {
                const nonVoters = filterJurors(jurors, expectedWinningJurors.concat(expectedLosingJurors))

                for (const { address } of nonVoters) {
                  await assertRevert(disputeManager.settleReward(disputeId, roundId, address), DISPUTE_MANAGER_ERRORS.WONT_REWARD_NON_VOTER_JUROR)
                }
              })
            })

            context('when penalties have not been settled yet', () => {
              it('reverts', async () => {
                for (const { address } of expectedWinningJurors) {
                  await assertRevert(disputeManager.settleReward(disputeId, roundId, address), DISPUTE_MANAGER_ERRORS.ROUND_PENALTIES_NOT_SETTLED)
                }
              })
            })
          })
        }

        beforeEach('mock draft round', async () => {
          voteId = getVoteId(disputeId, roundId)
          await courtHelper.draft({ disputeId, drafter, draftedJurors: voters })
        })

        context('during commit period', () => {
          itIsAtState(roundId, ROUND_STATES.COMMITTING)
          itFailsToRuleAndSettleRound(roundId)
        })

        context('during reveal period', () => {
          beforeEach('commit votes', async () => {
            await courtHelper.commit({ disputeId, roundId, voters })
          })

          itIsAtState(roundId, ROUND_STATES.REVEALING)
          itFailsToRuleAndSettleRound(roundId)
        })

        context('during appeal period', () => {
          context('when there were no votes', () => {
            beforeEach('pass commit and reveal periods', async () => {
              await courtHelper.passTerms(courtHelper.commitTerms.add(courtHelper.revealTerms))
            })

            itIsAtState(roundId, ROUND_STATES.APPEALING)
            itFailsToRuleAndSettleRound(roundId)
          })

          context('when there were some votes', () => {
            beforeEach('commit and reveal votes', async () => {
              await courtHelper.commit({ disputeId, roundId, voters })
              await courtHelper.reveal({ disputeId, roundId, voters })
            })

            itIsAtState(roundId, ROUND_STATES.APPEALING)
            itFailsToRuleAndSettleRound(roundId)
          })
        })

        context('during the appeal confirmation period', () => {
          context('when there were no votes', () => {
            beforeEach('pass commit and reveal periods', async () => {
              await courtHelper.passTerms(courtHelper.commitTerms.add(courtHelper.revealTerms))
            })

            context('when the round was not appealed', () => {
              const expectedFinalRuling = OUTCOMES.REFUSED
              const expectedWinningJurors = []
              const expectedLosingJurors = voters

              beforeEach('pass appeal period', async () => {
                await courtHelper.passTerms(courtHelper.appealTerms)
              })

              itIsAtState(roundId, ROUND_STATES.ENDED)
              itExecutesFinalRulingProperly(expectedFinalRuling)
              itSettlesPenaltiesAndRewardsProperly(roundId, expectedWinningJurors, expectedLosingJurors)
            })

            context('when the round was appealed', () => {
              beforeEach('appeal', async () => {
                await courtHelper.appeal({ disputeId, roundId, appealMaker, ruling: OUTCOMES.LOW })
              })

              itIsAtState(roundId, ROUND_STATES.CONFIRMING_APPEAL)
              itFailsToRuleAndSettleRound(roundId)
            })
          })

          context('when there were some votes', () => {
            beforeEach('commit and reveal votes', async () => {
              await courtHelper.commit({ disputeId, roundId, voters })
              await courtHelper.reveal({ disputeId, roundId, voters })
            })

            context('when the round was not appealed', () => {
              const expectedFinalRuling = OUTCOMES.LOW
              const expectedWinningJurors = voters.filter(({ outcome }) => outcome === expectedFinalRuling)
              const expectedLosingJurors = filterJurors(voters, expectedWinningJurors)

              beforeEach('pass appeal period', async () => {
                await courtHelper.passTerms(courtHelper.appealTerms)
              })

              itIsAtState(roundId, ROUND_STATES.ENDED)
              itExecutesFinalRulingProperly(expectedFinalRuling)
              itSettlesPenaltiesAndRewardsProperly(roundId, expectedWinningJurors, expectedLosingJurors)
            })

            context('when the round was appealed', () => {
              beforeEach('appeal', async () => {
                await courtHelper.appeal({ disputeId, roundId, appealMaker })
              })

              itIsAtState(roundId, ROUND_STATES.CONFIRMING_APPEAL)
              itFailsToRuleAndSettleRound(roundId)
            })
          })
        })

        context('after the appeal confirmation period', () => {
          context('when there were no votes', () => {
            beforeEach('pass commit and reveal periods', async () => {
              await courtHelper.passTerms(courtHelper.commitTerms.add(courtHelper.revealTerms))
            })

            context('when the round was not appealed', () => {
              const expectedFinalRuling = OUTCOMES.REFUSED
              const expectedWinningJurors = []
              const expectedLosingJurors = voters

              beforeEach('pass appeal and confirmation periods', async () => {
                await courtHelper.passTerms(courtHelper.appealTerms.add(courtHelper.appealConfirmTerms))
              })

              itIsAtState(roundId, ROUND_STATES.ENDED)
              itExecutesFinalRulingProperly(expectedFinalRuling)
              itSettlesPenaltiesAndRewardsProperly(roundId, expectedWinningJurors, expectedLosingJurors)
            })

            context('when the round was appealed', () => {
              const appealedRuling = OUTCOMES.HIGH

              beforeEach('appeal', async () => {
                await courtHelper.appeal({ disputeId, roundId, appealMaker, ruling: appealedRuling })
              })

              context('when the appeal was not confirmed', () => {
                const expectedFinalRuling = appealedRuling
                const expectedWinningJurors = []
                const expectedLosingJurors = voters

                beforeEach('pass confirmation period', async () => {
                  await courtHelper.passTerms(courtHelper.appealConfirmTerms)
                })

                itIsAtState(roundId, ROUND_STATES.ENDED)
                itExecutesFinalRulingProperly(expectedFinalRuling)
                itSettlesPenaltiesAndRewardsProperly(roundId, expectedWinningJurors, expectedLosingJurors)
              })

              context('when the appeal was confirmed', () => {
                beforeEach('confirm appeal', async () => {
                  await courtHelper.confirmAppeal({ disputeId, roundId, appealTaker })
                })

                itIsAtState(roundId, ROUND_STATES.ENDED)
                itFailsToRuleAndSettleRound(roundId)
              })
            })
          })

          context('when there were some votes', () => {
            beforeEach('commit and reveal votes', async () => {
              await courtHelper.commit({ disputeId, roundId, voters })
              await courtHelper.reveal({ disputeId, roundId, voters })
            })

            context('when the round was not appealed', () => {
              const expectedFinalRuling = OUTCOMES.LOW
              const expectedWinningJurors = voters.filter(({ outcome }) => outcome === expectedFinalRuling)
              const expectedLosingJurors = filterJurors(voters, expectedWinningJurors)

              beforeEach('pass appeal and confirmation periods', async () => {
                await courtHelper.passTerms(courtHelper.appealTerms.add(courtHelper.appealConfirmTerms))
              })

              itIsAtState(roundId, ROUND_STATES.ENDED)
              itExecutesFinalRulingProperly(expectedFinalRuling)
              itSettlesPenaltiesAndRewardsProperly(roundId, expectedWinningJurors, expectedLosingJurors)
            })

            context('when the round was appealed', () => {
              const appealedRuling = OUTCOMES.HIGH

              beforeEach('appeal', async () => {
                await courtHelper.appeal({ disputeId, roundId, appealMaker, ruling: appealedRuling })
              })

              context('when the appeal was not confirmed', () => {
                const expectedFinalRuling = appealedRuling
                const expectedWinningJurors = voters.filter(({ outcome }) => outcome === expectedFinalRuling)
                const expectedLosingJurors = filterJurors(voters, expectedWinningJurors)

                beforeEach('pass confirmation period', async () => {
                  await courtHelper.passTerms(courtHelper.appealConfirmTerms)
                })

                itIsAtState(roundId, ROUND_STATES.ENDED)
                itExecutesFinalRulingProperly(expectedFinalRuling)
                itSettlesPenaltiesAndRewardsProperly(roundId, expectedWinningJurors, expectedLosingJurors)
              })

              context('when the appeal was confirmed', () => {
                beforeEach('confirm appeal', async () => {
                  await courtHelper.confirmAppeal({ disputeId, roundId, appealTaker })
                })

                itIsAtState(roundId, ROUND_STATES.ENDED)
                itFailsToRuleAndSettleRound(roundId)

                context('when the next round is a regular round', () => {
                  const newRoundId = roundId + 1

                  const itHandlesRoundsSettlesProperly = (newRoundVoters, expectedFinalRuling) => {
                    const [firstRoundWinners, firstRoundLosers] = filterWinningJurors(voters, expectedFinalRuling)
                    const [secondRoundWinners, secondRoundLosers] = filterWinningJurors(newRoundVoters, expectedFinalRuling)

                    beforeEach('draft and vote second round', async () => {
                      const expectedNewRoundJurorsNumber = 9 // previous jurors * 3 + 1
                      const { roundJurorsNumber } = await courtHelper.getRound(disputeId, newRoundId)
                      assertBn(roundJurorsNumber, expectedNewRoundJurorsNumber, 'new round jurors number does not match')

                      await courtHelper.draft({ disputeId, maxJurorsToBeDrafted: expectedNewRoundJurorsNumber, draftedJurors: newRoundVoters })
                      await courtHelper.commit({ disputeId, roundId: newRoundId, voters: newRoundVoters })
                      await courtHelper.reveal({ disputeId, roundId: newRoundId, voters: newRoundVoters })
                      await courtHelper.passTerms(courtHelper.appealTerms.add(courtHelper.appealConfirmTerms))
                    })

                    itExecutesFinalRulingProperly(expectedFinalRuling)

                    context('when settling first round', () => {
                      itSettlesPenaltiesAndRewardsProperly(roundId, firstRoundWinners, firstRoundLosers)
                    })

                    context('when settling second round', () => {
                      beforeEach('settle first round', async () => {
                        await disputeManager.settlePenalties(disputeId, roundId, 0)
                        for (const { address } of firstRoundWinners) {
                          await disputeManager.settleReward(disputeId, roundId, address)
                        }
                      })

                      itSettlesPenaltiesAndRewardsProperly(newRoundId, secondRoundWinners, secondRoundLosers)
                    })
                  }

                  context('when the ruling is sustained', async () => {
                    const expectedFinalRuling = OUTCOMES.LOW
                    const newRoundVoters = [
                      { address: juror500,  weight: 1, outcome: OUTCOMES.HIGH },
                      { address: juror2000, weight: 4, outcome: OUTCOMES.LOW },
                      { address: juror2500, weight: 1, outcome: OUTCOMES.HIGH },
                      { address: juror4000, weight: 2, outcome: OUTCOMES.LOW },
                      { address: juror3000, weight: 1, outcome: OUTCOMES.LOW }
                    ]

                    itHandlesRoundsSettlesProperly(newRoundVoters, expectedFinalRuling)
                  })

                  context('when the ruling is flipped', async () => {
                    const expectedFinalRuling = appealedRuling
                    const newRoundVoters = [
                      { address: juror500,  weight: 1, outcome: OUTCOMES.HIGH },
                      { address: juror2000, weight: 4, outcome: OUTCOMES.HIGH },
                      { address: juror2500, weight: 1, outcome: OUTCOMES.HIGH },
                      { address: juror4000, weight: 2, outcome: OUTCOMES.HIGH },
                      { address: juror3000, weight: 1, outcome: OUTCOMES.HIGH }
                    ]

                    itHandlesRoundsSettlesProperly(newRoundVoters, expectedFinalRuling)
                  })

                  context('when the ruling is refused', async () => {
                    const expectedFinalRuling = OUTCOMES.REFUSED
                    const newRoundVoters = [
                      { address: juror500,  weight: 1, outcome: OUTCOMES.REFUSED },
                      { address: juror2000, weight: 4, outcome: OUTCOMES.REFUSED },
                      { address: juror2500, weight: 1, outcome: OUTCOMES.REFUSED },
                      { address: juror4000, weight: 2, outcome: OUTCOMES.REFUSED },
                      { address: juror3000, weight: 1, outcome: OUTCOMES.REFUSED }
                    ]

                    itHandlesRoundsSettlesProperly(newRoundVoters, expectedFinalRuling)
                  })

                  context('when no one voted', async () => {
                    const expectedFinalRuling = OUTCOMES.REFUSED
                    const [firstRoundWinners, firstRoundLosers] = filterWinningJurors(voters, expectedFinalRuling)
                    const newRoundDraftedJurors = [
                      { address: juror500,  weight: 1 },
                      { address: juror2000, weight: 4 },
                      { address: juror2500, weight: 1 },
                      { address: juror4000, weight: 2 },
                      { address: juror3000, weight: 1 }
                    ]

                    beforeEach('pass second round', async () => {
                      await courtHelper.draft({ disputeId, maxJurorsToBeDrafted: 0, draftedJurors: newRoundDraftedJurors })
                      await courtHelper.passTerms(courtHelper.commitTerms.add(courtHelper.revealTerms).add(courtHelper.appealTerms).add(courtHelper.appealConfirmTerms))
                    })

                    itExecutesFinalRulingProperly(expectedFinalRuling)

                    context('when settling first round', () => {
                      itSettlesPenaltiesAndRewardsProperly(roundId, firstRoundWinners, firstRoundLosers)
                    })

                    context('when settling second round', () => {
                      beforeEach('settle first round', async () => {
                        await disputeManager.settlePenalties(disputeId, roundId, 0)
                        for (const { address } of firstRoundWinners) {
                          await disputeManager.settleReward(disputeId, roundId, address)
                        }
                      })

                      itSettlesPenaltiesAndRewardsProperly(newRoundId, [], newRoundDraftedJurors)
                    })
                  })
                })

                context('when the next round is a final round', () => {
                  const finalRoundId = DEFAULTS.maxRegularAppealRounds.toNumber()

                  const itHandlesRoundsSettlesProperly = (finalRoundVoters, expectedFinalRuling) => {
                    const previousRoundsVoters = { [roundId]: voters }
                    const [expectedWinners, expectedLosers] = filterWinningJurors(finalRoundVoters, expectedFinalRuling)

                    beforeEach('move to final round', async () => {
                      // appeal until we reach the final round, always flipping the previous round winning ruling
                      let previousWinningRuling = await voting.getWinningOutcome(voteId)
                      for (let nextRoundId = roundId + 1; nextRoundId < finalRoundId; nextRoundId++) {
                        const roundWinningRuling = oppositeOutcome(previousWinningRuling)
                        const roundVoters = await courtHelper.draft({ disputeId })
                        roundVoters.forEach(voter => voter.outcome = roundWinningRuling)
                        previousRoundsVoters[nextRoundId] = roundVoters

                        await courtHelper.commit({ disputeId, roundId: nextRoundId, voters: roundVoters })
                        await courtHelper.reveal({ disputeId, roundId: nextRoundId, voters: roundVoters })
                        await courtHelper.appeal({ disputeId, roundId: nextRoundId, appealMaker, ruling: previousWinningRuling })
                        await courtHelper.confirmAppeal({ disputeId, roundId: nextRoundId, appealTaker, ruling: roundWinningRuling })
                        previousWinningRuling = roundWinningRuling
                      }
                    })

                    beforeEach('end final round', async () => {
                      // commit and reveal votes, and pass appeal and confirmation periods to end dispute
                      await courtHelper.commit({ disputeId, roundId: finalRoundId, voters: finalRoundVoters })
                      await courtHelper.reveal({ disputeId, roundId: finalRoundId, voters: finalRoundVoters })
                      await courtHelper.passTerms(courtHelper.appealTerms.add(courtHelper.appealConfirmTerms))
                    })

                    beforeEach('settle previous rounds', async () => {
                      for (let nextRoundId = 0; nextRoundId < finalRoundId; nextRoundId++) {
                        await disputeManager.settlePenalties(disputeId, nextRoundId, 0)
                        const [winners] = filterWinningJurors(previousRoundsVoters[nextRoundId], expectedFinalRuling)
                        for (const { address } of winners) {
                          await disputeManager.settleReward(disputeId, nextRoundId, address)
                        }
                      }
                    })

                    itExecutesFinalRulingProperly(expectedFinalRuling)
                    itSettlesPenaltiesAndRewardsProperly(finalRoundId, expectedWinners, expectedLosers)
                  }

                  context('when the ruling is sustained', async () => {
                    const expectedFinalRuling = OUTCOMES.LOW
                    const finalRoundVoters = [
                      { address: juror500,  outcome: OUTCOMES.HIGH },
                      { address: juror2000, outcome: OUTCOMES.LOW },
                      { address: juror2500, outcome: OUTCOMES.HIGH },
                      { address: juror4000, outcome: OUTCOMES.LOW },
                      { address: juror3000, outcome: OUTCOMES.LOW }
                    ]

                    itHandlesRoundsSettlesProperly(finalRoundVoters, expectedFinalRuling)
                  })

                  context('when the ruling is flipped', async () => {
                    const expectedFinalRuling = appealedRuling
                    const finalRoundVoters = [
                      { address: juror500,  outcome: OUTCOMES.HIGH },
                      { address: juror2000, outcome: OUTCOMES.HIGH },
                      { address: juror2500, outcome: OUTCOMES.HIGH },
                      { address: juror4000, outcome: OUTCOMES.HIGH },
                      { address: juror3000, outcome: OUTCOMES.HIGH }
                    ]

                    itHandlesRoundsSettlesProperly(finalRoundVoters, expectedFinalRuling)
                  })

                  context('when the ruling is refused', async () => {
                    const expectedFinalRuling = OUTCOMES.REFUSED
                    const finalRoundVoters = [
                      { address: juror500,  outcome: OUTCOMES.REFUSED },
                      { address: juror2000, outcome: OUTCOMES.REFUSED },
                      { address: juror2500, outcome: OUTCOMES.REFUSED },
                      { address: juror4000, outcome: OUTCOMES.REFUSED },
                      { address: juror3000, outcome: OUTCOMES.REFUSED }
                    ]

                    itHandlesRoundsSettlesProperly(finalRoundVoters, expectedFinalRuling)
                  })
                })
              })
            })
          })
        })
      })

      context('when the given round is not valid', () => {
        const roundId = 5

        it('reverts', async () => {
          await assertRevert(disputeManager.createAppeal(disputeId, roundId, OUTCOMES.LOW), DISPUTE_MANAGER_ERRORS.ROUND_DOES_NOT_EXIST)
        })
      })
    })

    context('when the given dispute does not exist', () => {
      it('reverts', async () => {
        await assertRevert(disputeManager.createAppeal(0, 0, OUTCOMES.LOW), DISPUTE_MANAGER_ERRORS.DISPUTE_DOES_NOT_EXIST)
      })
    })
  })
})
