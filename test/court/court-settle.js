const { bn, bigExp } = require('../helpers/numbers')
const { assertRevert } = require('../helpers/assertThrow')
const { decodeEventsOfType } = require('../helpers/decodeEvent')
const { filterJurors, filterWinningJurors } = require('../helpers/jurors')
const { assertAmountOfEvents, assertEvent } = require('../helpers/assertEvent')
const { getVoteId, oppositeOutcome, OUTCOMES } = require('../helpers/crvoting')
const { buildHelper, DEFAULTS, ROUND_STATES, DISPUTE_STATES } = require('../helpers/court')(web3, artifacts)

const Arbitrable = artifacts.require('Arbitrable')

contract('Court', ([_, disputer, drafter, appealMaker, appealTaker, juror500, juror1000, juror1500, juror2000, juror2500, juror3000, juror3500, juror4000, anyone]) => {
  let courtHelper, court, voting

  const jurors = [
    { address: juror3000, initialActiveBalance: bigExp(3000, 18) },
    { address: juror500,  initialActiveBalance: bigExp(500,  18) },
    { address: juror1000, initialActiveBalance: bigExp(1000, 18) },
    { address: juror2000, initialActiveBalance: bigExp(2000, 18) },
    { address: juror4000, initialActiveBalance: bigExp(4000, 18) },
    { address: juror1500, initialActiveBalance: bigExp(1500, 18) },
    { address: juror3500, initialActiveBalance: bigExp(3500, 18) },
    { address: juror2500, initialActiveBalance: bigExp(2500, 18) },
  ]

  beforeEach('create court', async () => {
    courtHelper = buildHelper()
    court = await courtHelper.deploy()
    voting = courtHelper.voting
  })

  describe('settle', () => {
    context('when the given dispute exists', () => {
      let disputeId, voteId
      const draftTermId = 4, jurorsNumber = 3

      beforeEach('activate jurors and create dispute', async () => {
        await courtHelper.activate(jurors)

        await courtHelper.setTerm(1)
        disputeId = await courtHelper.dispute({ jurorsNumber, draftTermId, disputer })
        await courtHelper.passTerms(bn(draftTermId - 1)) // court is already at term one
      })

      context('when the given round is valid', () => {
        const roundId = 0
        const voters = [
          { address: juror1000, weight: 1, outcome: OUTCOMES.LOW },
          { address: juror2000, weight: 1, outcome: OUTCOMES.HIGH },
          { address: juror4000, weight: 1, outcome: OUTCOMES.LOW },
        ]

        const itIsAtState = (roundId, state) => {
          it(`round is at state ${state}`, async () => {
            const { roundState } = await courtHelper.getRound(disputeId, roundId)
            assert.equal(roundState.toString(), state.toString(), 'round state does not match')
          })
        }

        const itFailsToExecuteRuling = () => {
          it('fails to execute ruling', async () => {
            await assertRevert(court.executeRuling(disputeId), 'CT_INVALID_ADJUDICATION_STATE')
          })
        }

        const itFailsToSettlePenalties = (roundId) => {
          it('fails to settle penalties', async () => {
            await assertRevert(court.settlePenalties(disputeId, roundId, jurorsNumber), 'CT_INVALID_ADJUDICATION_STATE')
          })
        }

        const itFailsToSettleRewards = (roundId) => {
          it('fails to settle rewards', async () => {
            await assertRevert(court.settleReward(disputeId, roundId, anyone), 'CT_ROUND_PENALTIES_NOT_SETTLED')
          })
        }

        const itFailsToSettleAppealDeposits = (roundId) => {
          it('fails to settle appeal deposits', async () => {
            await assertRevert(court.settleAppealDeposit(disputeId, roundId), 'CT_ROUND_PENALTIES_NOT_SETTLED')
          })
        }

        const itFailsToSettleAll = (roundId) => {
          itFailsToSettlePenalties(roundId)
          itFailsToSettleRewards(roundId)
          itFailsToSettleAppealDeposits(roundId)
        }

        const itExecutesFinalRulingProperly = expectedFinalRuling => {
          describe('executeRuling', () => {
            it('emits an event', async () => {
              const receipt = await court.executeRuling(disputeId)

              assertAmountOfEvents(receipt, 'RulingExecuted')
              assertEvent(receipt, 'RulingExecuted', { disputeId, ruling: expectedFinalRuling })
            })

            it('executes the associated arbitrable', async () => {
              const receipt = await court.executeRuling(disputeId)

              const logs = decodeEventsOfType(receipt, Arbitrable.abi, 'CourtRuling')
              assertAmountOfEvents({ logs }, 'CourtRuling')
              assertEvent({ logs }, 'CourtRuling', { court: court.address, disputeId, ruling: expectedFinalRuling })
            })

            it('marks the dispute as executed', async () => {
              await court.executeRuling(disputeId)

              const { possibleRulings, state, finalRuling } = await courtHelper.getDispute(disputeId)
              assert.equal(state.toString(), DISPUTE_STATES.EXECUTED.toString(), 'dispute state does not match')
              assert.equal(possibleRulings.toString(), 2, 'dispute possible rulings do not match')
              assert.equal(finalRuling.toString(), expectedFinalRuling.toString(), 'dispute final ruling does not match')
            })

            it('cannot be executed twice', async () => {
              await court.executeRuling(disputeId)

              await assertRevert(court.executeRuling(disputeId), 'CT_INVALID_DISPUTE_STATE')
            })
          })
        }

        const itSettlesPenaltiesAndRewardsProperly = (roundId, expectedWinningJurors, expectedLosingJurors) => {
          let previousBalances = {}, expectedCoherentJurors, expectedCollectedTokens

          beforeEach('load previous balances', async () => {
            previousBalances = {}
            for (const { address } of jurors) {
              const { active, available, locked } = await courtHelper.jurorsRegistry.balanceOf(address)
              previousBalances[address] = { active, available, locked }
            }
          })

          beforeEach('load expected coherent jurors', async () => {
            // for final rounds compute voter's weight
            if (roundId >= courtHelper.maxRegularAppealRounds.toNumber()) {
              for (const juror of expectedWinningJurors) {
                juror.weight = (await courtHelper.getFinalRoundWeight(disputeId, roundId, juror.address)).toNumber()
              }
            }

            expectedCoherentJurors = expectedWinningJurors.reduce((total, { weight }) => total + weight, 0)

            expectedCollectedTokens = bn(0)
            for (const { address } of expectedLosingJurors) {
              const roundLockedBalance = await courtHelper.getRoundLockBalance(disputeId, roundId, address)
              expectedCollectedTokens = expectedCollectedTokens.add(roundLockedBalance)
            }

            // for final rounds all voter's tokens are collected before hand, then, add the balances of the winning jurors as well
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
                  const { active: currentActiveBalance, locked: currentLockedBalance } =await courtHelper.jurorsRegistry.balanceOf(address)
                  assert.equal(currentActiveBalance.toString(), previousActiveBalance.toString(), 'current active balance does not match')

                  // for the final round tokens are slashed before hand, thus they are not considered as locked tokens
                  const expectedLockedBalance = roundId < courtHelper.maxRegularAppealRounds ? previousLockedBalance.sub(roundLockedBalance).toString() : 0
                  assert.equal(currentLockedBalance.toString(), expectedLockedBalance, 'current locked balance does not match')
                }
              })

              it('slashes the losing jurors', async () => {
                for (const { address } of expectedLosingJurors) {
                  const roundLockedBalance = await courtHelper.getRoundLockBalance(disputeId, roundId, address)

                  const { locked: previousLockedBalance, active: previousActiveBalance } = previousBalances[address]
                  const { active: currentActiveBalance, locked: currentLockedBalance } =await courtHelper.jurorsRegistry.balanceOf(address)

                  // for the final round tokens are slashed before hand, thus the active tokens for slashed jurors stays equal
                  const expectedActiveBalance = roundId < courtHelper.maxRegularAppealRounds
                    ? previousActiveBalance.sub(roundLockedBalance)
                    : previousActiveBalance
                  assert.equal(currentActiveBalance.toString(), expectedActiveBalance.toString(), 'current active balance does not match')

                  // for the final round tokens are slashed before hand, thus they are not considered as locked tokens
                  const expectedLockedBalance = roundId < courtHelper.maxRegularAppealRounds
                    ? previousLockedBalance.sub(roundLockedBalance)
                    : 0
                  assert.equal(currentLockedBalance.toString(), expectedLockedBalance.toString(), 'current locked balance does not match')
                }
              })

              it('emits an event', async () => {
                assertAmountOfEvents(receipt, 'PenaltiesSettled')
                assertEvent(receipt, 'PenaltiesSettled', { disputeId, roundId, collectedTokens: expectedCollectedTokens })
              })

              it('updates the given round', async () => {
                const { settledPenalties, collectedTokens, coherentJurors } = await courtHelper.getRound(disputeId, roundId)
                assert.equal(settledPenalties, true, 'current round penalties should be settled')
                assert.equal(collectedTokens.toString(), expectedCollectedTokens.toString(), 'current round collected tokens does not match')
                assert.equal(coherentJurors.toString(), expectedCoherentJurors, 'current round coherent jurors does not match')
              })

              it('cannot be settled twice', async () => {
                await assertRevert(court.settlePenalties(disputeId, roundId, 0), 'CT_ROUND_ALREADY_SETTLED')
              })
            }

            context('when settling in one batch', () => {
              beforeEach('settle penalties', async () => {
                receipt = await court.settlePenalties(disputeId, roundId, 0)
              })

              itSettlesPenaltiesProperly()
            })

            context('when settling in multiple batches', () => {
              if (roundId < DEFAULTS.maxRegularAppealRounds.toNumber()) {
                beforeEach('settle penalties', async () => {
                  const batches = expectedWinningJurors.length + expectedLosingJurors.length
                  for (let batch = 0; batch < batches; batch++) {
                    receipt = await court.settlePenalties(disputeId, roundId, 1)
                    // assert round is not settle in the middle batches
                    if (batch < batches - 1) assertAmountOfEvents(receipt, 'PenaltiesSettled', 0)
                  }
                })

                itSettlesPenaltiesProperly()

              } else {
                it('reverts', async () => {
                  await court.settlePenalties(disputeId, roundId, 1)

                  await assertRevert(court.settlePenalties(disputeId, roundId, 1), 'CT_ROUND_ALREADY_SETTLED')
                })
              }
            })
          })

          describe('settleReward', () => {
            context('when penalties have been settled', () => {
              beforeEach('settle penalties', async () => {
                await court.settlePenalties(disputeId, roundId, 0)
              })

              if (expectedWinningJurors.length > 0) {
                it('emits an event for each juror', async () => {
                  for(const { address } of expectedWinningJurors) {
                    const receipt = await court.settleReward(disputeId, roundId, address)

                    assertAmountOfEvents(receipt, 'RewardSettled')
                    assertEvent(receipt, 'RewardSettled', { disputeId, roundId, juror: address })
                  }
                })

                it('rewards the winning jurors', async () => {
                  for(const { address, weight } of expectedWinningJurors) {
                    await court.settleReward(disputeId, roundId, address)

                    const { available } = await courtHelper.jurorsRegistry.balanceOf(address)
                    const expectedReward = expectedCollectedTokens.mul(bn(weight)).div(bn(expectedCoherentJurors))
                    const expectedCurrentAvailableBalance = previousBalances[address].available.add(expectedReward);

                    assert.equal(expectedCurrentAvailableBalance.toString(), available.toString(), 'current available balance does not match')
                  }
                })

                it('updates the juror state of the round', async () => {
                  for(const { address, weight } of expectedWinningJurors) {
                    await court.settleReward(disputeId, roundId, address)

                    const { weight: actualWeight, rewarded } = await courtHelper.getRoundJuror(disputeId, roundId, address)
                    assert.isTrue(rewarded, 'juror should have been rewarded')
                    assert.equal(actualWeight.toString(), weight, 'juror weight should not have changed')
                  }
                })

                it('does not allow settling non-winning jurors', async () => {
                  for(const { address } of expectedLosingJurors) {
                    await assertRevert(court.settleReward(disputeId, roundId, address), 'CT_WONT_REWARD_INCOHERENT_JUROR')
                  }
                })

                it('cannot be settled twice', async () => {
                  const { address } = expectedWinningJurors[0]
                  await court.settleReward(disputeId, roundId, address)

                  await assertRevert(court.settleReward(disputeId, roundId, address), 'CT_JUROR_ALREADY_REWARDED')
                })
              } else {
                it('does not allow settling non-winning jurors', async () => {
                  for(const { address } of expectedLosingJurors) {
                    await assertRevert(court.settleReward(disputeId, roundId, address), 'CT_WONT_REWARD_INCOHERENT_JUROR')
                  }
                })
              }

              it('does not allow settling non-voting jurors', async () => {
                const nonVoters = filterJurors(jurors, expectedWinningJurors.concat(expectedLosingJurors))

                for(const { address } of nonVoters) {
                  await assertRevert(court.settleReward(disputeId, roundId, address), 'CT_WONT_REWARD_NON_VOTER_JUROR')
                }
              })
            })

            context('when penalties have not been settled yet', () => {
              it('reverts', async () => {
                for (const { address } of expectedWinningJurors) {
                  await assertRevert(court.settleReward(disputeId, roundId, address), 'CT_ROUND_PENALTIES_NOT_SETTLED')
                }
              })
            })
          })
        }

        const itCannotSettleAppealDeposits = (roundId) => {
          describe('settleAppealDeposit', () => {
            context('when penalties have been settled', () => {
              beforeEach('settle penalties', async () => {
                await court.settlePenalties(disputeId, roundId, 0)
              })

              it('reverts', async () => {
                await assertRevert(court.settleAppealDeposit(disputeId, roundId), 'CT_ROUND_NOT_APPEALED')
              })
            })

            context('when penalties have not been settled yet', () => {
              it('reverts', async () => {
                await assertRevert(court.settleAppealDeposit(disputeId, roundId), 'CT_ROUND_PENALTIES_NOT_SETTLED')
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
          itFailsToExecuteRuling()
          itFailsToSettleAll(roundId)
        })

        context('during reveal period', () => {
          beforeEach('commit votes', async () => {
            await courtHelper.commit({ disputeId, roundId, voters })
          })

          itIsAtState(roundId, ROUND_STATES.REVEALING)
          itFailsToExecuteRuling()
          itFailsToSettleAll(roundId)
        })

        context('during appeal period', () => {
          beforeEach('commit and reveal votes', async () => {
            await courtHelper.commit({ disputeId, roundId, voters })
            await courtHelper.reveal({ disputeId, roundId, voters })
          })

          itIsAtState(roundId, ROUND_STATES.APPEALING)
          itFailsToExecuteRuling()
          itFailsToSettleAll(roundId)
        })

        context('during the appeal confirmation period', () => {
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
            itCannotSettleAppealDeposits(roundId)
          })

          context('when the round was appealed', () => {
            beforeEach('appeal', async () => {
              await courtHelper.appeal({ disputeId, roundId, appealMaker })
            })

            itIsAtState(roundId, ROUND_STATES.CONFIRMING_APPEAL)
            itFailsToExecuteRuling()
            itFailsToSettleAll(roundId)
          })
        })

        context('after the appeal confirmation period', () => {
          beforeEach('commit and reveal votes', async () => {
            await courtHelper.commit({ disputeId, roundId, voters })
            await courtHelper.reveal({ disputeId, roundId, voters })
          })

          const itSettlesAppealDeposits = (roundId, itTransferAppealsDeposits) => {
            describe('settleAppealDeposit', () => {
              context('when penalties have been settled', () => {
                beforeEach('settle penalties', async () => {
                  await court.settlePenalties(disputeId, roundId, 0)
                })

                itTransferAppealsDeposits()

                it('emits an event', async () => {
                  const receipt = await court.settleAppealDeposit(disputeId, roundId)

                  assertAmountOfEvents(receipt, 'AppealDepositSettled')
                  assertEvent(receipt, 'AppealDepositSettled', { disputeId, roundId })
                })

                it('does not affect the balances of the court', async () => {
                  const { accounting, feeToken } = courtHelper
                  const previousCourtBalance = await feeToken.balanceOf(court.address)
                  const previousAccountingBalance = await feeToken.balanceOf(accounting.address)

                  await court.settleAppealDeposit(disputeId, roundId)

                  const currentCourtBalance = await feeToken.balanceOf(court.address)
                  assert.equal(previousCourtBalance.toString(), currentCourtBalance.toString(), 'court balances do not match')

                  const currentAccountingBalance = await feeToken.balanceOf(accounting.address)
                  assert.equal(previousAccountingBalance.toString(), currentAccountingBalance.toString(), 'court accounting balances do not match')
                })

                it('cannot be settled twice', async () => {
                  await court.settleAppealDeposit(disputeId, roundId)

                  await assertRevert(court.settleAppealDeposit(disputeId, roundId), 'CT_APPEAL_ALREADY_SETTLED')
                })
              })

              context('when penalties have not been settled yet', () => {
                it('reverts', async () => {
                  await assertRevert(court.settleAppealDeposit(disputeId, roundId), 'CT_ROUND_PENALTIES_NOT_SETTLED')
                })
              })
            })
          }

          const itReturnsAppealDepositsToMaker = (roundId) => {
            itSettlesAppealDeposits(roundId, () => {
              it('returns the deposit to the appeal maker', async () => {
                const { accounting, feeToken } = courtHelper
                const { appealDeposit } = await courtHelper.getAppealFees(disputeId, roundId)

                const previousBalance = await accounting.balanceOf(feeToken.address, appealMaker)

                await court.settleAppealDeposit(disputeId, roundId)

                const currentBalance = await accounting.balanceOf(feeToken.address, appealMaker)
                assert.equal(previousBalance.add(appealDeposit).toString(), currentBalance.toString(), 'appeal maker balances do not match')
              })
            })
          }

          const itSettlesAppealDepositsToMaker = (roundId) => {
            itSettlesAppealDeposits(roundId, () => {
              it('settles the total deposit to the appeal taker', async () => {
                const { accounting, feeToken } = courtHelper
                const { appealFees, appealDeposit, confirmAppealDeposit } = await courtHelper.getAppealFees(disputeId, roundId)

                const expectedAppealReward = appealDeposit.add(confirmAppealDeposit).sub(appealFees)
                const previousAppealTakerBalance = await accounting.balanceOf(feeToken.address, appealTaker)

                await court.settleAppealDeposit(disputeId, roundId)

                const currentAppealTakerBalance = await accounting.balanceOf(feeToken.address, appealTaker)
                assert.equal(previousAppealTakerBalance.add(expectedAppealReward).toString(), currentAppealTakerBalance.toString(), 'appeal maker balances do not match')
              })
            })
          }

          const itSettlesAppealDepositsToTaker = (roundId) => {
            itSettlesAppealDeposits(roundId, () => {
              it('settles the total deposit to the appeal maker', async () => {
                const { accounting, feeToken } = courtHelper
                const { appealFees, appealDeposit, confirmAppealDeposit } = await courtHelper.getAppealFees(disputeId, roundId)

                const expectedAppealReward = appealDeposit.add(confirmAppealDeposit).sub(appealFees)
                const previousAppealMakerBalance = await accounting.balanceOf(feeToken.address, appealMaker)

                await court.settleAppealDeposit(disputeId, roundId)

                const currentAppealMakerBalance = await accounting.balanceOf(feeToken.address, appealMaker)
                assert.equal(previousAppealMakerBalance.add(expectedAppealReward).toString(), currentAppealMakerBalance.toString(), 'appeal maker balances do not match')
              })
            })
          }

          const itReturnsAppealDepositsToBoth = (roundId) => {
            itSettlesAppealDeposits(roundId, () => {
              it('splits the appeal deposit', async () => {
                const { accounting, feeToken } = courtHelper
                const { appealFees, appealDeposit, confirmAppealDeposit } = await courtHelper.getAppealFees(disputeId, roundId)

                const expectedAppealMakerReward = appealDeposit.sub(appealFees.div(bn(2)))
                const previousAppealMakerBalance = await accounting.balanceOf(feeToken.address, appealMaker)

                const expectedAppealTakerReward = confirmAppealDeposit.sub(appealFees.div(bn(2)))
                const previousAppealTakerBalance = await accounting.balanceOf(feeToken.address, appealTaker)

                await court.settleAppealDeposit(disputeId, roundId)

                const currentAppealMakerBalance = await accounting.balanceOf(feeToken.address, appealMaker)
                assert.equal(previousAppealMakerBalance.add(expectedAppealMakerReward).toString(), currentAppealMakerBalance.toString(), 'appeal maker balances do not match')

                const currentAppealTakerBalance = await accounting.balanceOf(feeToken.address, appealTaker)
                assert.equal(previousAppealTakerBalance.add(expectedAppealTakerReward).toString(), currentAppealTakerBalance.toString(), 'appeal taker balances do not match')
              })
            })
          }

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
            itCannotSettleAppealDeposits(roundId)
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
              itReturnsAppealDepositsToMaker(roundId)
            })

            context('when the appeal was confirmed', () => {
              beforeEach('confirm appeal', async () => {
                await courtHelper.confirmAppeal({ disputeId, roundId, appealTaker })
              })

              itIsAtState(roundId, ROUND_STATES.ENDED)
              itFailsToExecuteRuling()
              itFailsToSettleAll(roundId)

              context('when the next round is a regular round', () => {
                const newRoundId = roundId + 1

                const itHandlesRoundsSettlesProperly = (newRoundVoters, expectedFinalRuling) => {
                  const [firstRoundWinners, firstRoundLosers] = filterWinningJurors(voters, expectedFinalRuling)
                  const [secondRoundWinners, secondRoundLosers] = filterWinningJurors(newRoundVoters, expectedFinalRuling)

                  beforeEach('draft and vote second round', async () => {
                    const expectedNewRoundJurorsNumber = 9 // previous jurors * 3 + 1
                    const { roundJurorsNumber } = await courtHelper.getRound(disputeId, newRoundId)
                    assert.equal(roundJurorsNumber.toString(), expectedNewRoundJurorsNumber, 'new round jurors number does not match')

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
                      await court.settlePenalties(disputeId, roundId, 0)
                      for (const { address } of firstRoundWinners) {
                        await court.settleReward(disputeId, roundId, address)
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
                    { address: juror3000, weight: 1, outcome: OUTCOMES.LOW },
                  ]

                  itHandlesRoundsSettlesProperly(newRoundVoters, expectedFinalRuling)
                  itSettlesAppealDepositsToMaker(roundId)
                })

                context('when the ruling is flipped', async () => {
                  const expectedFinalRuling = appealedRuling
                  const newRoundVoters = [
                    { address: juror500,  weight: 1, outcome: OUTCOMES.HIGH },
                    { address: juror2000, weight: 4, outcome: OUTCOMES.HIGH },
                    { address: juror2500, weight: 1, outcome: OUTCOMES.HIGH },
                    { address: juror4000, weight: 2, outcome: OUTCOMES.HIGH },
                    { address: juror3000, weight: 1, outcome: OUTCOMES.HIGH },
                  ]

                  itHandlesRoundsSettlesProperly(newRoundVoters, expectedFinalRuling)
                  itSettlesAppealDepositsToTaker(roundId)
                })

                context('when the ruling is refused', async () => {
                  const expectedFinalRuling = OUTCOMES.REFUSED
                  const newRoundVoters = [
                    { address: juror500,  weight: 1, outcome: OUTCOMES.REFUSED },
                    { address: juror2000, weight: 4, outcome: OUTCOMES.REFUSED },
                    { address: juror2500, weight: 1, outcome: OUTCOMES.REFUSED },
                    { address: juror4000, weight: 2, outcome: OUTCOMES.REFUSED },
                    { address: juror3000, weight: 1, outcome: OUTCOMES.REFUSED },
                  ]

                  itHandlesRoundsSettlesProperly(newRoundVoters, expectedFinalRuling)
                  itReturnsAppealDepositsToBoth(roundId)
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
                      await court.settlePenalties(disputeId, nextRoundId, 0)
                      const [winners] = filterWinningJurors(previousRoundsVoters[nextRoundId], expectedFinalRuling)
                      for (const { address } of winners) {
                        await court.settleReward(disputeId, nextRoundId, address)
                      }
                    }
                  })

                  itExecutesFinalRulingProperly(expectedFinalRuling)
                  itSettlesPenaltiesAndRewardsProperly(finalRoundId, expectedWinners, expectedLosers)
                  itCannotSettleAppealDeposits(finalRoundId)
                }

                context('when the ruling is sustained', async () => {
                  const expectedFinalRuling = OUTCOMES.LOW
                  const finalRoundVoters = [
                    { address: juror500,  outcome: OUTCOMES.HIGH },
                    { address: juror2000, outcome: OUTCOMES.LOW },
                    { address: juror2500, outcome: OUTCOMES.HIGH },
                    { address: juror4000, outcome: OUTCOMES.LOW },
                    { address: juror3000, outcome: OUTCOMES.LOW },
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
                    { address: juror3000, outcome: OUTCOMES.HIGH },
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
                    { address: juror3000, outcome: OUTCOMES.REFUSED },
                  ]

                  itHandlesRoundsSettlesProperly(finalRoundVoters, expectedFinalRuling)
                })
              })
            })
          })
        })
      })

      // TODO: this scenario is not implemented in the contracts yet
      context.skip('when the given round is not valid', () => {
        const roundId = 5

        it('reverts', async () => {
          await assertRevert(court.createAppeal(disputeId, roundId, OUTCOMES.LOW), 'CT_ROUND_DOES_NOT_EXIST')
        })
      })
    })

    // TODO: this scenario is not implemented in the contracts yet
    context.skip('when the given dispute does not exist', () => {
      it('reverts', async () => {
        await assertRevert(court.createAppeal(0, 0, OUTCOMES.LOW), 'CT_DISPUTE_DOES_NOT_EXIST')
      })
    })
  })
})
