const { bn, bigExp } = require('../helpers/numbers')
const { filterJurors } = require('../helpers/jurors')
const { assertRevert } = require('../helpers/assertThrow')
const { assertAmountOfEvents, assertEvent } = require('../helpers/assertEvent')
const { getVoteId, oppositeOutcome, outcomeFor, OUTCOMES } = require('../helpers/crvoting')
const { buildHelper, DEFAULTS, ROUND_STATES, DISPUTE_STATES } = require('../helpers/court')(web3, artifacts)

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

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

  describe('appeal', () => {
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

        const itFailsToAppeal = (roundId) => {
          it('fails to appeal', async () => {
            await assertRevert(court.createAppeal(disputeId, roundId, OUTCOMES.REFUSED), 'CT_INVALID_ADJUDICATION_STATE')
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
            itFailsToAppeal(roundId)
          })

          context('during reveal period', () => {
            beforeEach('commit votes', async () => {
              await courtHelper.commit({ disputeId, roundId, voters })
            })

            itIsAtState(roundId, ROUND_STATES.REVEALING)
            itFailsToAppeal(roundId)
          })

          context('during appeal period', () => {
            let winningRuling

            beforeEach('commit and reveal votes', async () => {
              await courtHelper.commit({ disputeId, roundId, voters })
              await courtHelper.reveal({ disputeId, roundId, voters })

              winningRuling = await voting.getWinningOutcome(voteId)
            })

            itIsAtState(roundId, ROUND_STATES.APPEALING)

            context('when the appeal ruling is valid', () => {
              let appealMakerRuling

              context('when the appeal ruling is different from the winning one', () => {
                beforeEach('set confirmed ruling', async () => {
                  appealMakerRuling = oppositeOutcome(winningRuling)
                })

                context('when the appeal maker has enough balance', () => {
                  beforeEach('mint fee tokens for appeal maker', async () => {
                    const { appealDeposit } = await courtHelper.getAppealFees(disputeId, roundId)
                    await courtHelper.mintAndApproveFeeTokens(appealMaker, court.address, appealDeposit)
                  })

                  it('emits an event', async () => {
                    const receipt = await court.createAppeal(disputeId, roundId, appealMakerRuling, { from: appealMaker })

                    assertAmountOfEvents(receipt, 'RulingAppealed')
                    assertEvent(receipt, 'RulingAppealed', { disputeId, roundId, ruling: appealMakerRuling })
                  })

                  it('appeals the given round', async () => {
                    await court.createAppeal(disputeId, roundId, appealMakerRuling, { from: appealMaker })

                    const { appealer, appealedRuling, taker, opposedRuling } = await courtHelper.getAppeal(disputeId, roundId)
                    assert.equal(appealer, appealMaker, 'appeal maker does not match')
                    assert.equal(appealedRuling.toString(), appealMakerRuling, 'appealed ruling does not match')
                    assert.equal(taker.toString(), ZERO_ADDRESS, 'appeal taker does not match')
                    assert.equal(opposedRuling.toString(), 0, 'opposed ruling does not match')
                  })

                  it('transfers the appeal deposit to the court', async () => {
                    const { accounting, feeToken } = courtHelper
                    const { appealDeposit } = await courtHelper.getAppealFees(disputeId, roundId)

                    const previousCourtBalance = await feeToken.balanceOf(court.address)
                    const previousAccountingBalance = await feeToken.balanceOf(accounting.address)
                    const previousAppealerBalance = await feeToken.balanceOf(appealMaker)

                    await court.createAppeal(disputeId, roundId, appealMakerRuling, { from: appealMaker })

                    const currentCourtBalance = await feeToken.balanceOf(court.address)
                    assert.equal(previousCourtBalance.toString(), currentCourtBalance.toString(), 'court balances do not match')

                    const currentAccountingBalance = await feeToken.balanceOf(accounting.address)
                    assert.equal(previousAccountingBalance.add(appealDeposit).toString(), currentAccountingBalance.toString(), 'court accounting balances do not match')

                    const currentAppealerBalance = await feeToken.balanceOf(appealMaker)
                    assert.equal(previousAppealerBalance.sub(appealDeposit).toString(), currentAppealerBalance.toString(), 'sender balances do not match')
                  })

                  it('does not create a new round for the dispute', async () => {
                    await court.createAppeal(disputeId, roundId, appealMakerRuling, { from: appealMaker })

                    await assertRevert(court.getRound(disputeId, roundId + 1), 'CT_ROUND_DOES_NOT_EXIST')
                  })

                  it('does not modify the current round of the dispute', async () => {
                    await court.createAppeal(disputeId, roundId, appealMakerRuling, { from: appealMaker })

                    const { draftTerm, delayedTerms, roundJurorsNumber, selectedJurors, triggeredBy, settledPenalties, collectedTokens } = await courtHelper.getRound(disputeId, roundId)
                    assert.equal(draftTerm.toString(), draftTermId, 'current round draft term does not match')
                    assert.equal(delayedTerms.toString(), 0, 'current round delay term does not match')
                    assert.equal(roundJurorsNumber.toString(), jurorsNumber, 'current round jurors number does not match')
                    assert.equal(selectedJurors.toString(), jurorsNumber, 'current round selected jurors number does not match')
                    assert.equal(triggeredBy, disputer, 'current round trigger does not match')
                    assert.equal(settledPenalties, false, 'current round penalties should not be settled')
                    assert.equal(collectedTokens.toString(), 0, 'current round collected tokens should be zero')
                  })

                  it('does not modify core dispute information', async () => {
                    await court.createAppeal(disputeId, roundId, appealMakerRuling, { from: appealMaker })

                    const { possibleRulings, state, finalRuling } = await courtHelper.getDispute(disputeId)
                    assert.equal(state.toString(), DISPUTE_STATES.ADJUDICATING.toString(), 'dispute state does not match')
                    assert.equal(possibleRulings.toString(), 2, 'dispute possible rulings do not match')
                    assert.equal(finalRuling.toString(), 0, 'dispute final ruling does not match')
                  })

                  it('cannot be appealed twice', async () => {
                    await court.createAppeal(disputeId, roundId, appealMakerRuling, { from: appealMaker })

                    await assertRevert(court.createAppeal(disputeId, roundId, appealMakerRuling, { from: appealMaker }), 'CT_INVALID_ADJUDICATION_STATE')
                  })
                })

                context('when the appeal maker does not have enough balance', () => {
                  it('reverts', async () => {
                    await assertRevert(court.createAppeal(disputeId, roundId, appealMakerRuling, { from: appealMaker }), 'CT_DEPOSIT_FAILED')
                  })
                })
              })

              context('when the appeal ruling is equal to the winning one', () => {
                beforeEach('set confirmed ruling', async () => {
                  appealMakerRuling = winningRuling
                })

                it('reverts', async () => {
                  await assertRevert(court.createAppeal(disputeId, roundId, appealMakerRuling, { from: appealMaker }), 'CT_INVALID_APPEAL_RULING')
                })
              })
            })

            context('when the appeal ruling is not valid', () => {
              const invalidRuling = 10

              it('reverts', async () => {
                await assertRevert(court.createAppeal(disputeId, roundId, invalidRuling, { from: appealMaker }), 'CT_INVALID_APPEAL_RULING')
              })
            })
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
              itFailsToAppeal(roundId)
            })

            context('when the round was appealed', () => {
              beforeEach('appeal', async () => {
                await courtHelper.appeal({ disputeId, roundId, appealMaker })
              })

              itIsAtState(roundId, ROUND_STATES.CONFIRMING_APPEAL)
              itFailsToAppeal(roundId)
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
              itFailsToAppeal(roundId)
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
                itFailsToAppeal(roundId)
              })

              context('when the appeal was confirmed', () => {
                beforeEach('confirm appeal', async () => {
                  await courtHelper.confirmAppeal({ disputeId, roundId, appealTaker })
                })

                itIsAtState(roundId, ROUND_STATES.ENDED)
                itFailsToAppeal(roundId)
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

          context('during commit period', () => {
            itIsAtState(roundId, ROUND_STATES.COMMITTING)
            itFailsToAppeal(roundId)
          })

          context('during reveal period', () => {
            beforeEach('commit votes', async () => {
              await courtHelper.commit({ disputeId, roundId, voters })
            })

            itIsAtState(roundId, ROUND_STATES.REVEALING)
            itFailsToAppeal(roundId)
          })

          context('during appeal period', () => {
            beforeEach('commit and reveal votes', async () => {
              await courtHelper.commit({ disputeId, roundId, voters })
              await courtHelper.reveal({ disputeId, roundId, voters })
            })

            itIsAtState(roundId, ROUND_STATES.ENDED)
            itFailsToAppeal(roundId)
          })

          context('during the appeal confirmation period', () => {
            beforeEach('commit and reveal votes, and pass appeal period', async () => {
              await courtHelper.commit({ disputeId, roundId, voters })
              await courtHelper.reveal({ disputeId, roundId, voters })
              await courtHelper.passTerms(courtHelper.appealTerms)
            })

            itIsAtState(roundId, ROUND_STATES.ENDED)
            itFailsToAppeal(roundId)
          })

          context('after the appeal confirmation period', () => {
            beforeEach('commit and reveal votes, and pass appeal and confirmation periods', async () => {
              await courtHelper.commit({ disputeId, roundId, voters })
              await courtHelper.reveal({ disputeId, roundId, voters })
              await courtHelper.passTerms(courtHelper.appealTerms.add(courtHelper.appealConfirmTerms))
            })

            itIsAtState(roundId, ROUND_STATES.ENDED)
            itFailsToAppeal(roundId)
          })
        })
      })

      context('when the given round is not valid', () => {
        const roundId = 5

        it('reverts', async () => {
          await assertRevert(court.createAppeal(disputeId, roundId, OUTCOMES.LOW), 'CT_ROUND_DOES_NOT_EXIST')
        })
      })
    })

    context('when the given dispute does not exist', () => {
      it('reverts', async () => {
        await assertRevert(court.createAppeal(0, 0, OUTCOMES.LOW), 'CT_DISPUTE_DOES_NOT_EXIST')
      })
    })
  })
})
