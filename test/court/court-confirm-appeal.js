const { DEFAULTS } = require('../helpers/wrappers/controller')(web3, artifacts)
const { assertBn } = require('../helpers/asserts/assertBn')
const { bn, bigExp } = require('../helpers/lib/numbers')
const { assertRevert } = require('../helpers/asserts/assertThrow')
const { assertAmountOfEvents, assertEvent } = require('../helpers/asserts/assertEvent')
const { oppositeOutcome, outcomeFor, OUTCOMES } = require('../helpers/utils/crvoting')
const { buildHelper, ROUND_STATES, DISPUTE_STATES } = require('../helpers/wrappers/court')(web3, artifacts)

contract('Court', ([_, disputer, drafter, appealMaker, appealTaker, juror500, juror1000, juror1500, juror2000, juror2500, juror3000, juror3500, juror4000]) => {
  let courtHelper, court

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

  beforeEach('create court', async () => {
    courtHelper = buildHelper()
    court = await courtHelper.deploy()
  })

  describe('confirmAppeal', () => {
    context('when the given dispute exists', () => {
      let disputeId
      const draftTermId = 4

      beforeEach('activate jurors and create dispute', async () => {
        await courtHelper.activate(jurors)

        disputeId = await courtHelper.dispute({ draftTermId, disputer })
        await courtHelper.passTerms(bn(1)) // court is already at term previous to dispute start
      })

      context('when the given round is valid', () => {
        let voters

        const itIsAtState = (roundId, state) => {
          it(`round is at state ${state}`, async () => {
            const { roundState } = await courtHelper.getRound(disputeId, roundId)
            assertBn(roundState, state, 'round state does not match')
          })
        }

        const itFailsToConfirmAppeal = (roundId, reason = 'CT_INVALID_ADJUDICATION_STATE') => {
          it('fails to confirm appeals', async () => {
            await assertRevert(court.confirmAppeal(disputeId, roundId, OUTCOMES.REFUSED), reason)
          })
        }

        context('for a regular round', () => {
          const roundId = 0
          let draftedJurors

          beforeEach('draft round', async () => {
            draftedJurors = await courtHelper.draft({ disputeId, drafter })
          })

          beforeEach('define a group of voters', async () => {
            // pick the first 3 drafted jurors to vote
            voters = draftedJurors.slice(0, 3)
            voters.forEach((voter, i) => voter.outcome = outcomeFor(i))
          })

          context('during commit period', () => {
            itIsAtState(roundId, ROUND_STATES.COMMITTING)
            itFailsToConfirmAppeal(roundId)
          })

          context('during reveal period', () => {
            beforeEach('commit votes', async () => {
              await courtHelper.commit({ disputeId, roundId, voters })
            })

            itIsAtState(roundId, ROUND_STATES.REVEALING)
            itFailsToConfirmAppeal(roundId)
          })

          context('during appeal period', () => {
            beforeEach('commit and reveal votes', async () => {
              await courtHelper.commit({ disputeId, roundId, voters })
              await courtHelper.reveal({ disputeId, roundId, voters })
            })

            itIsAtState(roundId, ROUND_STATES.APPEALING)
            itFailsToConfirmAppeal(roundId)
          })

          context('during the appeal confirmation period', () => {
            beforeEach('commit and reveal votes', async () => {
              await courtHelper.commit({ disputeId, roundId, voters })
              await courtHelper.reveal({ disputeId, roundId, voters })
            })

            context('when the round was not appealed', () => {
              beforeEach('pass appeal period', async () => {
                await courtHelper.passTerms(courtHelper.appealTerms)
              })

              itIsAtState(roundId, ROUND_STATES.ENDED)
              itFailsToConfirmAppeal(roundId)
            })

            context('when the round was appealed', () => {
              let appealMakerRuling

              beforeEach('appeal and move to appeal confirmation period', async () => {
                await courtHelper.appeal({ disputeId, roundId, appealMaker })
                const { appealedRuling } = await courtHelper.getAppeal(disputeId, roundId)
                appealMakerRuling = appealedRuling
              })

              context('when the confirmed ruling is valid', () => {
                let appealTakerRuling

                context('when the confirmed ruling is different from the appealed one', () => {
                  beforeEach('set confirmed ruling', async () => {
                    appealTakerRuling = oppositeOutcome(appealMakerRuling)
                  })

                  context('when the appeal taker has enough balance', () => {
                    beforeEach('mint fee tokens for appeal taker', async () => {
                      const { confirmAppealDeposit } = await courtHelper.getAppealFees(disputeId, roundId)
                      await courtHelper.mintAndApproveFeeTokens(appealTaker, court.address, confirmAppealDeposit)
                    })

                    const itCreatesNewRoundSuccessfully = roundId => {
                      it('computes next round details successfully', async () => {
                        const { nextRoundStartTerm, nextRoundJurorsNumber, newDisputeState, feeToken, totalFees, jurorFees, appealDeposit, confirmAppealDeposit } = await court.getNextRoundDetails(disputeId, roundId)

                        const expectedStartTerm = await courtHelper.getNextRoundStartTerm(disputeId, roundId)
                        assertBn(nextRoundStartTerm, expectedStartTerm, 'next round start term does not match')

                        const expectedJurorsNumber = await courtHelper.getNextRoundJurorsNumber(disputeId, roundId)
                        assertBn(nextRoundJurorsNumber, expectedJurorsNumber, 'next round jurors number does not match')

                        const expectedDisputeState = (roundId < courtHelper.maxRegularAppealRounds.toNumber() - 1) ? DISPUTE_STATES.PRE_DRAFT : DISPUTE_STATES.ADJUDICATING
                        assertBn(newDisputeState, expectedDisputeState, 'next round jurors number does not match')

                        const expectedJurorFees = await courtHelper.getNextRoundJurorFees(disputeId, roundId)
                        assertBn(jurorFees, expectedJurorFees, 'juror fees does not match')

                        const { appealFees, appealDeposit: expectedAppealDeposit, confirmAppealDeposit: expectedConfirmAppealDeposit } = await courtHelper.getAppealFees(disputeId, roundId)
                        assert.equal(feeToken, courtHelper.feeToken.address, 'fee token does not match')
                        assertBn(totalFees, appealFees, 'appeal fees does not match')
                        assertBn(appealDeposit, expectedAppealDeposit, 'appeal deposit does not match')
                        assertBn(confirmAppealDeposit, expectedConfirmAppealDeposit, 'confirm appeal deposit does not match')
                      })

                      it('computes final jurors number nevertheless the court current term', async () => {
                        const previousTermId = await courtHelper.controller.getCurrentTermId()
                        const previousActiveBalance = await courtHelper.jurorsRegistry.totalActiveBalanceAt(previousTermId)
                        const previousJurorsNumber = await courtHelper.getNextRoundJurorsNumber(disputeId, roundId)

                        await courtHelper.passTerms(bn(1))
                        await courtHelper.activate(jurors)
                        await courtHelper.passTerms(bn(1))

                        const currentTermId = await courtHelper.controller.getCurrentTermId()
                        const currentActiveBalance = await courtHelper.jurorsRegistry.totalActiveBalanceAt(currentTermId)
                        assertBn(currentActiveBalance, previousActiveBalance.mul(bn(2)), 'new total active balance does not match')

                        if (roundId < DEFAULTS.maxRegularAppealRounds.toNumber() - 1) {
                          const currentJurorsNumber = await courtHelper.getNextRoundJurorsNumber(disputeId, roundId)
                          assertBn(currentJurorsNumber, previousJurorsNumber, 'next round jurors number does not match')
                        } else {
                          const currentJurorsNumber = await courtHelper.getNextRoundJurorsNumber(disputeId, roundId)
                          // for the final round the number of activated tokens is contemplated, we are duplicating it above
                          assertBn(currentJurorsNumber, previousJurorsNumber.mul(bn(2)), 'next round jurors number does not match')
                        }
                      })

                      it('emits an event', async () => {
                        const receipt = await court.confirmAppeal(disputeId, roundId, appealTakerRuling, { from: appealTaker })

                        assertAmountOfEvents(receipt, 'RulingAppealConfirmed')

                        const nextRoundStartTerm = await courtHelper.getNextRoundStartTerm(disputeId, roundId)
                        const nextRoundJurorsNumber = await courtHelper.getNextRoundJurorsNumber(disputeId, roundId)
                        assertEvent(receipt, 'RulingAppealConfirmed', {
                          disputeId,
                          roundId: roundId + 1,
                          draftTermId: nextRoundStartTerm,
                          jurorsNumber: nextRoundJurorsNumber
                        })
                      })

                      it('confirms the given appealed round', async () => {
                        await court.confirmAppeal(disputeId, roundId, appealTakerRuling, { from: appealTaker })

                        const { appealer, appealedRuling, taker, opposedRuling } = await courtHelper.getAppeal(disputeId, roundId)
                        assert.equal(appealer, appealMaker, 'appeal maker does not match')
                        assertBn(appealedRuling, appealMakerRuling, 'appealed ruling does not match')
                        assertBn(taker, appealTaker, 'appeal taker does not match')
                        assertBn(opposedRuling, appealTakerRuling, 'opposed ruling does not match')
                      })

                      it('creates a new round for the given dispute', async () => {
                        await court.confirmAppeal(disputeId, roundId, appealTakerRuling, { from: appealTaker })

                        const { draftTerm, delayedTerms, roundJurorsNumber, selectedJurors, triggeredBy, settledPenalties, jurorFees, collectedTokens } = await courtHelper.getRound(disputeId, roundId + 1)

                        const nextRoundStartTerm = await courtHelper.getNextRoundStartTerm(disputeId, roundId)
                        assertBn(draftTerm, nextRoundStartTerm, 'new round draft term does not match')
                        assertBn(delayedTerms, 0, 'new round delay term does not match')

                        const nextRoundJurorsNumber = await courtHelper.getNextRoundJurorsNumber(disputeId, roundId)
                        assertBn(roundJurorsNumber, nextRoundJurorsNumber, 'new round jurors number does not match')

                        const nextRoundJurorFees = await courtHelper.getNextRoundJurorFees(disputeId, roundId)
                        assertBn(jurorFees, nextRoundJurorFees, 'new round juror fees do not match')

                        assertBn(selectedJurors, 0, 'new round selected jurors number does not match')
                        assert.equal(triggeredBy, appealTaker, 'new round trigger does not match')
                        assert.equal(settledPenalties, false, 'new round penalties should not be settled')
                        assertBn(collectedTokens, 0, 'new round collected tokens should be zero')
                      })

                      it('does not modify the current round of the dispute', async () => {
                        const { draftTerm: previousDraftTerm, delayedTerms: previousDelayedTerms, roundJurorsNumber: previousJurorsNumber, jurorFees: previousJurorFees, triggeredBy: previousTriggeredBy } = await courtHelper.getRound(disputeId, roundId)

                        await court.confirmAppeal(disputeId, roundId, appealTakerRuling, { from: appealTaker })

                        const { draftTerm, delayedTerms, roundJurorsNumber, selectedJurors, jurorFees, triggeredBy, settledPenalties, collectedTokens } = await courtHelper.getRound(disputeId, roundId)
                        assertBn(draftTerm, previousDraftTerm, 'current round draft term does not match')
                        assertBn(delayedTerms, previousDelayedTerms, 'current round delay term does not match')
                        assertBn(roundJurorsNumber, previousJurorsNumber, 'current round jurors number does not match')
                        assertBn(selectedJurors, previousJurorsNumber, 'current round selected jurors number does not match')
                        assertBn(jurorFees, previousJurorFees, 'current round juror fees do not match')
                        assert.equal(triggeredBy, previousTriggeredBy, 'current round trigger does not match')
                        assert.equal(settledPenalties, false, 'current round penalties should not be settled')
                        assertBn(collectedTokens, 0, 'current round collected tokens should be zero')
                      })

                      it('updates the dispute state', async () => {
                        await court.confirmAppeal(disputeId, roundId, appealTakerRuling, { from: appealTaker })

                        const { possibleRulings, state, finalRuling } = await courtHelper.getDispute(disputeId)

                        const expectedDisputeState = (roundId < courtHelper.maxRegularAppealRounds.toNumber() - 1) ? DISPUTE_STATES.PRE_DRAFT : DISPUTE_STATES.ADJUDICATING
                        assertBn(state, expectedDisputeState, 'dispute state does not match')
                        assertBn(possibleRulings, 2, 'dispute possible rulings do not match')
                        assertBn(finalRuling, 0, 'dispute final ruling does not match')
                      })

                      it('cannot be confirmed twice', async () => {
                        await court.confirmAppeal(disputeId, roundId, appealTakerRuling, { from: appealTaker })

                        await assertRevert(court.confirmAppeal(disputeId, roundId, appealTakerRuling, { from: appealTaker }), 'CT_INVALID_ADJUDICATION_STATE')
                      })
                    }

                    context('when the next round is a regular round', () => {
                      itCreatesNewRoundSuccessfully(roundId)
                    })

                    context('when the next round is a final round', () => {
                      const finalRoundId = DEFAULTS.maxRegularAppealRounds.toNumber()

                      beforeEach('move to final round', async () => {
                        // appeal until we reach the final round, always flipping the previous round winning ruling
                        for (let nextRoundId = roundId + 1; nextRoundId < finalRoundId; nextRoundId++) {
                          await courtHelper.confirmAppeal({ disputeId, roundId: nextRoundId - 1, appealTaker, ruling: appealTakerRuling })
                          const roundVoters = await courtHelper.draft({ disputeId })
                          roundVoters.forEach(voter => voter.outcome = appealTakerRuling)
                          await courtHelper.commit({ disputeId, roundId: nextRoundId, voters: roundVoters })
                          await courtHelper.reveal({ disputeId, roundId: nextRoundId, voters: roundVoters })
                          await courtHelper.appeal({ disputeId, roundId: nextRoundId, appealMaker, ruling: appealMakerRuling })
                        }

                        // mint fee tokens for last appeal taker
                        const { confirmAppealDeposit } = await courtHelper.getAppealFees(disputeId, finalRoundId - 1)
                        await courtHelper.mintAndApproveFeeTokens(appealTaker, court.address, confirmAppealDeposit)
                      })

                      itCreatesNewRoundSuccessfully(finalRoundId - 1)
                    })
                  })

                  context('when the appeal taker does not have enough balance', () => {
                    it('reverts', async () => {
                      await assertRevert(court.confirmAppeal(disputeId, roundId, appealTakerRuling, { from: appealTaker }), 'CT_DEPOSIT_FAILED')
                    })
                  })
                })

                context('when the confirmed ruling is equal to the appealed one', () => {
                  beforeEach('set confirmed ruling', async () => {
                    appealTakerRuling = appealMakerRuling
                  })

                  it('reverts', async () => {
                    await assertRevert(court.confirmAppeal(disputeId, roundId, appealMakerRuling, { from: appealTaker }), 'CT_INVALID_APPEAL_RULING')
                  })
                })
              })

              context('when the confirmed ruling is not valid', () => {
                const invalidRuling = 10

                it('reverts', async () => {
                  await assertRevert(court.confirmAppeal(disputeId, roundId, invalidRuling, { from: appealTaker }), 'CT_INVALID_APPEAL_RULING')
                })
              })
            })
          })

          context('after the appeal confirmation period', () => {
            beforeEach('commit and reveal votes', async () => {
              await courtHelper.commit({ disputeId, roundId, voters })
              await courtHelper.reveal({ disputeId, roundId, voters })
            })

            context('when the round was not appealed', () => {
              beforeEach('pass appeal and confirmation periods', async () => {
                await courtHelper.passTerms(courtHelper.appealTerms.add(courtHelper.appealConfirmTerms))
              })

              itIsAtState(roundId, ROUND_STATES.ENDED)
              itFailsToConfirmAppeal(roundId)
            })

            context('when the round was appealed', () => {
              beforeEach('appeal', async () => {
                await courtHelper.appeal({ disputeId, roundId, appealMaker })
              })

              context('when the appeal was not confirmed', () => {
                beforeEach('pass confirmation period', async () => {
                  await courtHelper.passTerms(courtHelper.appealConfirmTerms)
                })

                itIsAtState(roundId, ROUND_STATES.ENDED)
                itFailsToConfirmAppeal(roundId)
              })

              context('when the appeal was confirmed', () => {
                beforeEach('confirm appeal', async () => {
                  await courtHelper.confirmAppeal({ disputeId, roundId, appealTaker })
                })

                itIsAtState(roundId, ROUND_STATES.ENDED)
                itFailsToConfirmAppeal(roundId)
              })
            })
          })
        })

        context('for a final round', () => {
          const roundId = DEFAULTS.maxRegularAppealRounds.toNumber()

          beforeEach('move to final round', async () => {
            await courtHelper.moveToFinalRound({ disputeId })
          })

          beforeEach('define a group of voters', async () => {
            voters = [
              { address: juror1000, outcome: OUTCOMES.LOW },
              { address: juror4000, outcome: OUTCOMES.LOW },
              { address: juror2000, outcome: OUTCOMES.HIGH },
              { address: juror1500, outcome: OUTCOMES.REFUSED }
            ]
          })

          const itCannotComputeNextRoundDetails = () => {
            it('cannot compute next round details', async () => {
              await assertRevert(court.getNextRoundDetails(disputeId, roundId), 'CT_ROUND_IS_FINAL')
            })
          }

          context('during commit period', () => {
            itIsAtState(roundId, ROUND_STATES.COMMITTING)
            itFailsToConfirmAppeal(roundId)
            itCannotComputeNextRoundDetails()
          })

          context('during reveal period', () => {
            beforeEach('commit votes', async () => {
              await courtHelper.commit({ disputeId, roundId, voters })
            })

            itIsAtState(roundId, ROUND_STATES.REVEALING)
            itFailsToConfirmAppeal(roundId)
            itCannotComputeNextRoundDetails()
          })

          context('during appeal period', () => {
            beforeEach('commit and reveal votes', async () => {
              await courtHelper.commit({ disputeId, roundId, voters })
              await courtHelper.reveal({ disputeId, roundId, voters })
            })

            itIsAtState(roundId, ROUND_STATES.ENDED)
            itFailsToConfirmAppeal(roundId)
            itCannotComputeNextRoundDetails()
          })

          context('during the appeal confirmation period', () => {
            beforeEach('commit and reveal votes, and pass appeal period', async () => {
              await courtHelper.commit({ disputeId, roundId, voters })
              await courtHelper.reveal({ disputeId, roundId, voters })
              await courtHelper.passTerms(courtHelper.appealTerms)
            })

            itIsAtState(roundId, ROUND_STATES.ENDED)
            itFailsToConfirmAppeal(roundId)
            itCannotComputeNextRoundDetails()
          })

          context('after the appeal confirmation period', () => {
            beforeEach('commit and reveal votes, and pass appeal and confirmation periods', async () => {
              await courtHelper.commit({ disputeId, roundId, voters })
              await courtHelper.reveal({ disputeId, roundId, voters })
              await courtHelper.passTerms(courtHelper.appealTerms.add(courtHelper.appealConfirmTerms))
            })

            itIsAtState(roundId, ROUND_STATES.ENDED)
            itFailsToConfirmAppeal(roundId)
            itCannotComputeNextRoundDetails()
          })
        })
      })

      context('when the given round is not valid', () => {
        const roundId = 5

        it('reverts', async () => {
          await assertRevert(court.confirmAppeal(disputeId, roundId, OUTCOMES.LOW), 'CT_ROUND_DOES_NOT_EXIST')
        })
      })
    })

    context('when the given dispute does not exist', () => {
      it('reverts', async () => {
        await assertRevert(court.confirmAppeal(0, 0, OUTCOMES.LOW), 'CT_DISPUTE_DOES_NOT_EXIST')
      })
    })
  })
})
