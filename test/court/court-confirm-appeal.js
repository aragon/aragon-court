const { bn, bigExp } = require('../helpers/numbers')
const { filterJurors } = require('../helpers/jurors')
const { assertRevert } = require('../helpers/assertThrow')
const { assertAmountOfEvents, assertEvent } = require('../helpers/assertEvent')
const { getVoteId, oppositeOutcome, outcomeFor, OUTCOMES } = require('../helpers/crvoting')
const { buildHelper, DEFAULTS, ROUND_STATES, DISPUTE_STATES } = require('../helpers/court')(web3, artifacts)

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

  beforeEach('create court', async () => {
    courtHelper = buildHelper()
    court = await courtHelper.deploy()
    voting = courtHelper.voting
  })

  describe('confirmAppeal', () => {
    context('when the given dispute exists', () => {
      let disputeId
      const draftTermId = 4, jurorsNumber = 3

      beforeEach('activate jurors and create dispute', async () => {
        await courtHelper.activate(jurors)

        await courtHelper.setTerm(1)
        disputeId = await courtHelper.dispute({ jurorsNumber, draftTermId, disputer })
        await courtHelper.passTerms(bn(draftTermId - 1)) // court is already at term one
      })

      context('when the given round is valid', () => {
        let voteId, voters, nonVoters

        const itIsAtState = (roundId, state) => {
          it(`round is at state ${state}`, async () => {
            const { roundState } = await courtHelper.getRound(disputeId, roundId)
            assert.equal(roundState.toString(), state.toString(), 'round state does not match')
          })
        }

        const itFailsToConfirmAppeal = (roundId, reason = 'CT_INVALID_ADJUDICATION_STATE') => {
          it('fails to confirm appeals', async () => {
            await assertRevert(court.confirmAppeal(disputeId, roundId, OUTCOMES.REFUSED), reason)
          })
        }

        context('for a regular round', () => {
          const roundId = 0
          let draftedJurors, nonDraftedJurors

          beforeEach('draft round', async () => {
            draftedJurors = await courtHelper.draft({ disputeId, drafter })
            nonDraftedJurors = jurors.filter(juror => !draftedJurors.map(j => j.address).includes(juror.address))
          })

          beforeEach('define a group of voters', async () => {
            voteId = getVoteId(disputeId, roundId)
            // pick the first 3 drafted jurors to vote
            voters = draftedJurors.slice(0, 3)
            voters.forEach((voter, i) => voter.outcome = outcomeFor(i))
            nonVoters = filterJurors(draftedJurors, voters)
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
                        assert.equal(nextRoundStartTerm.toString(), expectedStartTerm.toString(), 'next round start term does not match')

                        const expectedJurorsNumber = await courtHelper.getNextRoundJurorsNumber(disputeId, roundId)
                        assert.equal(nextRoundJurorsNumber.toString(), expectedJurorsNumber.toString(), 'next round jurors number does not match')

                        const expectedDisputeState = (roundId < courtHelper.maxRegularAppealRounds.toNumber() - 1) ? DISPUTE_STATES.PRE_DRAFT : DISPUTE_STATES.ADJUDICATING
                        assert.equal(newDisputeState.toString(), expectedDisputeState.toString(), 'next round jurors number does not match')

                        const expectedJurorFees = await courtHelper.getNextRoundJurorFees(disputeId, roundId)
                        assert.equal(jurorFees.toString(), expectedJurorFees.toString(), 'juror fees does not match')

                        const { appealFees, appealDeposit: expectedAppealDeposit, confirmAppealDeposit: expectedConfirmAppealDeposit } = await courtHelper.getAppealFees(disputeId, roundId)
                        assert.equal(feeToken, courtHelper.feeToken.address, 'fee token does not match')
                        assert.equal(totalFees.toString(), appealFees.toString(), 'appeal fees does not match')
                        assert.equal(appealDeposit.toString(), expectedAppealDeposit.toString(), 'appeal deposit does not match')
                        assert.equal(confirmAppealDeposit.toString(), expectedConfirmAppealDeposit.toString(), 'confirm appeal deposit does not match')
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
                        assert.equal(appealedRuling.toString(), appealMakerRuling, 'appealed ruling does not match')
                        assert.equal(taker.toString(), appealTaker, 'appeal taker does not match')
                        assert.equal(opposedRuling.toString(), appealTakerRuling, 'opposed ruling does not match')
                      })

                      it('creates a new round for the given dispute', async () => {
                        await court.confirmAppeal(disputeId, roundId, appealTakerRuling, { from: appealTaker })

                        const { draftTerm, delayedTerms, roundJurorsNumber, selectedJurors, triggeredBy, settledPenalties, collectedTokens } = await courtHelper.getRound(disputeId, roundId + 1)

                        const nextRoundStartTerm = await courtHelper.getNextRoundStartTerm(disputeId, roundId)
                        assert.equal(draftTerm.toString(), nextRoundStartTerm.toString(), 'new round draft term does not match')
                        assert.equal(delayedTerms.toString(), 0, 'new round delay term does not match')

                        const nextRoundJurorsNumber = await courtHelper.getNextRoundJurorsNumber(disputeId, roundId)
                        assert.equal(roundJurorsNumber.toString(), nextRoundJurorsNumber.toString(), 'new round jurors number does not match')
                        assert.equal(selectedJurors.toString(), 0, 'new round selected jurors number does not match')
                        assert.equal(triggeredBy, appealTaker, 'new round trigger does not match')
                        assert.equal(settledPenalties, false, 'new round penalties should not be settled')
                        assert.equal(collectedTokens.toString(), 0, 'new round collected tokens should be zero')
                      })

                      it('does not modify the current round of the dispute', async () => {
                        const { draftTerm: previousDraftTerm, delayedTerms: previousDelayedTerms, roundJurorsNumber: previousJurorsNumber, triggeredBy: previousTriggeredBy } = await courtHelper.getRound(disputeId, roundId)

                        await court.confirmAppeal(disputeId, roundId, appealTakerRuling, { from: appealTaker })

                        const { draftTerm, delayedTerms, roundJurorsNumber, selectedJurors, triggeredBy, settledPenalties, collectedTokens } = await courtHelper.getRound(disputeId, roundId)
                        assert.equal(draftTerm.toString(), previousDraftTerm.toString(), 'current round draft term does not match')
                        assert.equal(delayedTerms.toString(), previousDelayedTerms.toString(), 'current round delay term does not match')
                        assert.equal(roundJurorsNumber.toString(), previousJurorsNumber.toString(), 'current round jurors number does not match')
                        assert.equal(selectedJurors.toString(), previousJurorsNumber.toString(), 'current round selected jurors number does not match')
                        assert.equal(triggeredBy, previousTriggeredBy, 'current round trigger does not match')
                        assert.equal(settledPenalties, false, 'current round penalties should not be settled')
                        assert.equal(collectedTokens.toString(), 0, 'current round collected tokens should be zero')
                      })

                      it('updates the dispute state', async () => {
                        await court.confirmAppeal(disputeId, roundId, appealTakerRuling, { from: appealTaker })

                        const { possibleRulings, state, finalRuling } = await courtHelper.getDispute(disputeId)

                        const expectedDisputeState = (roundId < courtHelper.maxRegularAppealRounds.toNumber() - 1) ? DISPUTE_STATES.PRE_DRAFT : DISPUTE_STATES.ADJUDICATING
                        assert.equal(state.toString(), expectedDisputeState.toString(), 'dispute state does not match')
                        assert.equal(possibleRulings.toString(), 2, 'dispute possible rulings do not match')
                        assert.equal(finalRuling.toString(), 0, 'dispute final ruling does not match')
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
            voteId = getVoteId(disputeId, roundId)
            voters = [
              { address: juror1000, outcome: OUTCOMES.LOW },
              { address: juror4000, outcome: OUTCOMES.LOW },
              { address: juror2000, outcome: OUTCOMES.HIGH },
              { address: juror1500, outcome: OUTCOMES.REFUSED },
            ]
            nonVoters = filterJurors(jurors, voters)
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

    // TODO: this scenario is not implemented in the contracts yet
    context.skip('when the given dispute does not exist', () => {
      it('reverts', async () => {
        await assertRevert(court.confirmAppeal(0, 0, OUTCOMES.LOW), 'CT_DISPUTE_DOES_NOT_EXIST')
      })
    })
  })
})
