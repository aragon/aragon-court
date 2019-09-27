const { bn, bigExp } = require('../helpers/numbers')
const { assertRevert } = require('../helpers/assertThrow')
const { filterWinningJurors } = require('../helpers/jurors')
const { assertAmountOfEvents, assertEvent } = require('../helpers/assertEvent')
const { getVoteId, oppositeOutcome, OUTCOMES } = require('../helpers/crvoting')
const { buildHelper, DEFAULTS, ROUND_STATES } = require('../helpers/court')(web3, artifacts)

contract('Court', ([_, disputer, drafter, appealMaker, appealTaker, juror500, juror1000, juror1500, juror2000, juror2500, juror3000, juror3500, juror4000]) => {
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
  const firstRoundJurorsNumber = 3

  beforeEach('create court', async () => {
    courtHelper = buildHelper()
    court = await courtHelper.deploy({ firstRoundJurorsNumber })
    voting = courtHelper.voting
  })

  describe('settle', () => {
    context('when the given dispute exists', () => {
      let disputeId, voteId
      const draftTermId = 4

      beforeEach('activate jurors and create dispute', async () => {
        await courtHelper.activate(jurors)

        await courtHelper.setTerm(1)
        disputeId = await courtHelper.dispute({ draftTermId, disputer })
        await courtHelper.passTerms(bn(draftTermId - 1)) // court is already at term one
      })

      context('when the given round is valid', () => {
        const roundId = 0
        const voters = [
          { address: juror1000, weight: 1, outcome: OUTCOMES.LEAKED },
          { address: juror2000, weight: 1, outcome: OUTCOMES.HIGH },
          { address: juror4000, weight: 1, outcome: OUTCOMES.LOW },
        ]

        const itIsAtState = (roundId, state) => {
          it(`round is at state ${state}`, async () => {
            const { roundState } = await courtHelper.getRound(disputeId, roundId)
            assert.equal(roundState.toString(), state.toString(), 'round state does not match')
          })
        }

        const itFailsToSettleAppealDeposits = (roundId) => {
          it('fails to settle appeal deposits', async () => {
            await assertRevert(court.settleAppealDeposit(disputeId, roundId), 'CT_ROUND_PENALTIES_NOT_SETTLED')
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
          itFailsToSettleAppealDeposits(roundId)
        })

        context('during reveal period', () => {
          beforeEach('commit votes', async () => {
            await courtHelper.commit({ disputeId, roundId, voters })
          })

          itIsAtState(roundId, ROUND_STATES.REVEALING)
          itFailsToSettleAppealDeposits(roundId)
        })

        context('during appeal period', () => {
          context('when there were no votes', () => {
            beforeEach('pass commit and reveal periods', async () => {
              await courtHelper.passTerms(courtHelper.commitTerms.add(courtHelper.revealTerms))
            })

            itIsAtState(roundId, ROUND_STATES.APPEALING)
            itFailsToSettleAppealDeposits(roundId)
          })

          context('when there were some votes', () => {
            beforeEach('commit and reveal votes', async () => {
              await courtHelper.commit({ disputeId, roundId, voters })
              await courtHelper.reveal({ disputeId, roundId, voters })
            })

            itIsAtState(roundId, ROUND_STATES.APPEALING)
            itFailsToSettleAppealDeposits(roundId)
          })
        })

        context('during the appeal confirmation period', () => {
          context('when there were no votes', () => {
            beforeEach('pass commit and reveal periods', async () => {
              await courtHelper.passTerms(courtHelper.commitTerms.add(courtHelper.revealTerms))
            })

            context('when the round was not appealed', () => {
              beforeEach('pass appeal period', async () => {
                await courtHelper.passTerms(courtHelper.appealTerms)
              })

              itIsAtState(roundId, ROUND_STATES.ENDED)
              itCannotSettleAppealDeposits(roundId)
            })

            context('when the round was appealed', () => {
              beforeEach('appeal', async () => {
                await courtHelper.appeal({ disputeId, roundId, appealMaker, ruling: OUTCOMES.LOW })
              })

              itIsAtState(roundId, ROUND_STATES.CONFIRMING_APPEAL)
              itFailsToSettleAppealDeposits(roundId)
            })
          })

          context('when there were some votes', () => {
            beforeEach('commit and reveal votes', async () => {
              await courtHelper.commit({ disputeId, roundId, voters })
              await courtHelper.reveal({ disputeId, roundId, voters })
            })

            context('when the round was not appealed', () => {
              beforeEach('pass appeal period', async () => {
                await courtHelper.passTerms(courtHelper.appealTerms)
              })

              itIsAtState(roundId, ROUND_STATES.ENDED)
              itCannotSettleAppealDeposits(roundId)
            })

            context('when the round was appealed', () => {
              beforeEach('appeal', async () => {
                await courtHelper.appeal({ disputeId, roundId, appealMaker })
              })

              itIsAtState(roundId, ROUND_STATES.CONFIRMING_APPEAL)
              itFailsToSettleAppealDeposits(roundId)
            })
          })
        })

        context('after the appeal confirmation period', () => {
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
                assert.equal(currentAppealTakerBalance.toString(), previousAppealTakerBalance.add(expectedAppealReward).toString(), 'appeal maker balances do not match')
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
                assert.equal(currentAppealMakerBalance.toString(), previousAppealMakerBalance.add(expectedAppealReward).toString(), 'appeal maker balances do not match')
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
                assert.equal(currentAppealMakerBalance.toString(), previousAppealMakerBalance.add(expectedAppealMakerReward).toString(), 'appeal maker balances do not match')

                const currentAppealTakerBalance = await accounting.balanceOf(feeToken.address, appealTaker)
                assert.equal(currentAppealTakerBalance.toString(), previousAppealTakerBalance.add(expectedAppealTakerReward).toString(), 'appeal taker balances do not match')
              })
            })
          }

          context('when there were no votes', () => {
            beforeEach('pass commit and reveal periods', async () => {
              await courtHelper.passTerms(courtHelper.commitTerms.add(courtHelper.revealTerms))
            })

            context('when the round was not appealed', () => {
              beforeEach('pass appeal and confirmation periods', async () => {
                await courtHelper.passTerms(courtHelper.appealTerms.add(courtHelper.appealConfirmTerms))
              })

              itIsAtState(roundId, ROUND_STATES.ENDED)
              itCannotSettleAppealDeposits(roundId)
            })

            context('when the round was appealed', () => {
              const appealedRuling = OUTCOMES.HIGH

              beforeEach('appeal', async () => {
                await courtHelper.appeal({ disputeId, roundId, appealMaker, ruling: appealedRuling })
              })

              context('when the appeal was not confirmed', () => {
                beforeEach('pass confirmation period', async () => {
                  await courtHelper.passTerms(courtHelper.appealConfirmTerms)
                })

                itIsAtState(roundId, ROUND_STATES.ENDED)
                itReturnsAppealDepositsToMaker(roundId)
              })

              context('when the appeal was confirmed', () => {
                beforeEach('confirm appeal', async () => {
                  await courtHelper.confirmAppeal({ disputeId, roundId, appealTaker })
                })

                itIsAtState(roundId, ROUND_STATES.ENDED)
                itFailsToSettleAppealDeposits(roundId)
              })
            })
          })

          context('when there were some votes', () => {
            beforeEach('commit and reveal votes', async () => {
              await courtHelper.commit({ disputeId, roundId, voters })
              await courtHelper.reveal({ disputeId, roundId, voters })
            })

            context('when the round was not appealed', () => {
              beforeEach('pass appeal and confirmation periods', async () => {
                await courtHelper.passTerms(courtHelper.appealTerms.add(courtHelper.appealConfirmTerms))
              })

              itIsAtState(roundId, ROUND_STATES.ENDED)
              itCannotSettleAppealDeposits(roundId)
            })

            context('when the round was appealed', () => {
              const appealedRuling = OUTCOMES.HIGH

              beforeEach('appeal', async () => {
                await courtHelper.appeal({ disputeId, roundId, appealMaker, ruling: appealedRuling })
              })

              context('when the appeal was not confirmed', () => {
                beforeEach('pass confirmation period', async () => {
                  await courtHelper.passTerms(courtHelper.appealConfirmTerms)
                })

                itIsAtState(roundId, ROUND_STATES.ENDED)
                itReturnsAppealDepositsToMaker(roundId)
              })

              context('when the appeal was confirmed', () => {
                beforeEach('confirm appeal', async () => {
                  await courtHelper.confirmAppeal({ disputeId, roundId, appealTaker })
                })

                itIsAtState(roundId, ROUND_STATES.ENDED)
                itFailsToSettleAppealDeposits(roundId)

                context('when the next round is a regular round', () => {
                  const newRoundId = roundId + 1

                  const draftAndVoteSecondRound = newRoundVoters => {
                    beforeEach('draft and vote second round', async () => {
                      const expectedNewRoundJurorsNumber = 9 // previous jurors * 3 + 1
                      const { roundJurorsNumber } = await courtHelper.getRound(disputeId, newRoundId)
                      assert.equal(roundJurorsNumber.toString(), expectedNewRoundJurorsNumber, 'new round jurors number does not match')

                      await courtHelper.draft({ disputeId, maxJurorsToBeDrafted: expectedNewRoundJurorsNumber, draftedJurors: newRoundVoters })
                      await courtHelper.commit({ disputeId, roundId: newRoundId, voters: newRoundVoters })
                      await courtHelper.reveal({ disputeId, roundId: newRoundId, voters: newRoundVoters })
                      await courtHelper.passTerms(courtHelper.appealTerms.add(courtHelper.appealConfirmTerms))
                    })
                  }

                  context('when the ruling is sustained', async () => {
                    const newRoundVoters = [
                      { address: juror500,  weight: 1, outcome: OUTCOMES.HIGH },
                      { address: juror2000, weight: 4, outcome: OUTCOMES.LOW },
                      { address: juror2500, weight: 1, outcome: OUTCOMES.HIGH },
                      { address: juror4000, weight: 2, outcome: OUTCOMES.LOW },
                      { address: juror3000, weight: 1, outcome: OUTCOMES.LOW },
                    ]

                    draftAndVoteSecondRound(newRoundVoters)
                    itSettlesAppealDepositsToMaker(roundId)
                  })

                  context('when the ruling is flipped', async () => {
                    const newRoundVoters = [
                      { address: juror500,  weight: 1, outcome: OUTCOMES.HIGH },
                      { address: juror2000, weight: 4, outcome: OUTCOMES.HIGH },
                      { address: juror2500, weight: 1, outcome: OUTCOMES.HIGH },
                      { address: juror4000, weight: 2, outcome: OUTCOMES.HIGH },
                      { address: juror3000, weight: 1, outcome: OUTCOMES.HIGH },
                    ]

                    draftAndVoteSecondRound(newRoundVoters)
                    itSettlesAppealDepositsToTaker(roundId)
                  })

                  context('when the ruling is refused', async () => {
                    const newRoundVoters = [
                      { address: juror500,  weight: 1, outcome: OUTCOMES.REFUSED },
                      { address: juror2000, weight: 4, outcome: OUTCOMES.REFUSED },
                      { address: juror2500, weight: 1, outcome: OUTCOMES.REFUSED },
                      { address: juror4000, weight: 2, outcome: OUTCOMES.REFUSED },
                      { address: juror3000, weight: 1, outcome: OUTCOMES.REFUSED },
                    ]

                    draftAndVoteSecondRound(newRoundVoters)
                    itReturnsAppealDepositsToBoth(roundId)
                  })

                  context('when no one voted', async () => {
                    const newRoundDraftedJurors = [
                      { address: juror500,  weight: 1 },
                      { address: juror2000, weight: 4 },
                      { address: juror2500, weight: 1 },
                      { address: juror4000, weight: 2 },
                      { address: juror3000, weight: 1 },
                    ]

                    beforeEach('pass second round', async () => {
                      await courtHelper.draft({ disputeId, maxJurorsToBeDrafted: 0, draftedJurors: newRoundDraftedJurors })
                      await courtHelper.passTerms(courtHelper.commitTerms.add(courtHelper.revealTerms).add(courtHelper.appealTerms).add(courtHelper.appealConfirmTerms))
                    })

                    itReturnsAppealDepositsToBoth(roundId)
                  })
                })

                context('when the next round is a final round', () => {
                  const finalRoundId = DEFAULTS.maxRegularAppealRounds.toNumber()

                  const itHandlesRoundsSettlesProperly = (finalRoundVoters, expectedFinalRuling) => {
                    const previousRoundsVoters = { [roundId]: voters }

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
