const { assertBn } = require('../helpers/asserts/assertBn')
const { bn, bigExp } = require('../helpers/lib/numbers')
const { assertRevert } = require('../helpers/asserts/assertThrow')
const { DISPUTES_MANAGER_ERRORS } = require('../helpers/utils/errors')
const { DISPUTES_MANAGER_EVENTS } = require('../helpers/utils/events')
const { assertAmountOfEvents, assertEvent } = require('../helpers/asserts/assertEvent')
const { getVoteId, oppositeOutcome, outcomeFor, OUTCOMES } = require('../helpers/utils/crvoting')
const { buildHelper, ROUND_STATES, DISPUTE_STATES, DEFAULTS } = require('../helpers/wrappers/court')(web3, artifacts)

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

contract('DisputesManager', ([_, drafter, appealMaker, appealTaker, juror500, juror1000, juror1500, juror2000, juror2500, juror3000, juror3500, juror4000]) => {
  let courtHelper, disputesManager, voting

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
    await courtHelper.deploy()
    voting = courtHelper.voting
    disputesManager = courtHelper.disputesManager
  })

  describe('createAppeal', () => {
    context('when the given dispute exists', () => {
      let disputeId
      const draftTermId = 4

      beforeEach('activate jurors and create dispute', async () => {
        await courtHelper.activate(jurors)

        disputeId = await courtHelper.dispute({ draftTermId })
        await courtHelper.passTerms(bn(1)) // court is already at term previous to dispute start
      })

      context('when the given round is valid', () => {
        let voteId, voters

        const itIsAtState = (roundId, state) => {
          it(`round is at state ${state}`, async () => {
            const { roundState } = await courtHelper.getRound(disputeId, roundId)
            assertBn(roundState, state, 'round state does not match')
          })
        }

        const itFailsToAppeal = (roundId) => {
          it('fails to appeal', async () => {
            await assertRevert(disputesManager.createAppeal(disputeId, roundId, OUTCOMES.REFUSED), DISPUTES_MANAGER_ERRORS.INVALID_ADJUDICATION_STATE)
          })
        }

        context('for a regular round', () => {
          let draftedJurors
          const roundId = 0

          beforeEach('draft round', async () => {
            draftedJurors = await courtHelper.draft({ disputeId, drafter })
          })

          beforeEach('define a group of voters', async () => {
            voteId = getVoteId(disputeId, roundId)
            // pick the first 3 drafted jurors to vote
            voters = draftedJurors.slice(0, 3)
            voters.forEach((voter, i) => voter.outcome = outcomeFor(i))
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
                    await courtHelper.mintAndApproveFeeTokens(appealMaker, disputesManager.address, appealDeposit)
                  })

                  it('emits an event', async () => {
                    const receipt = await disputesManager.createAppeal(disputeId, roundId, appealMakerRuling, { from: appealMaker })

                    assertAmountOfEvents(receipt, DISPUTES_MANAGER_EVENTS.RULING_APPEALED)
                    assertEvent(receipt, DISPUTES_MANAGER_EVENTS.RULING_APPEALED, { disputeId, roundId, ruling: appealMakerRuling })
                  })

                  it('appeals the given round', async () => {
                    await disputesManager.createAppeal(disputeId, roundId, appealMakerRuling, { from: appealMaker })

                    const { appealer, appealedRuling, taker, opposedRuling } = await courtHelper.getAppeal(disputeId, roundId)
                    assert.equal(appealer, appealMaker, 'appeal maker does not match')
                    assertBn(appealedRuling, appealMakerRuling, 'appealed ruling does not match')
                    assertBn(taker, ZERO_ADDRESS, 'appeal taker does not match')
                    assertBn(opposedRuling, 0, 'opposed ruling does not match')
                  })

                  it('transfers the appeal deposit to the disputes manager', async () => {
                    const { treasury, feeToken } = courtHelper
                    const { appealDeposit } = await courtHelper.getAppealFees(disputeId, roundId)

                    const previousDisputesManagerBalance = await feeToken.balanceOf(disputesManager.address)
                    const previousTreasuryBalance = await feeToken.balanceOf(treasury.address)
                    const previousAppealerBalance = await feeToken.balanceOf(appealMaker)

                    await disputesManager.createAppeal(disputeId, roundId, appealMakerRuling, { from: appealMaker })

                    const currentDisputesManagerBalance = await feeToken.balanceOf(disputesManager.address)
                    assertBn(previousDisputesManagerBalance, currentDisputesManagerBalance, 'disputes manager balances do not match')

                    const currentTreasuryBalance = await feeToken.balanceOf(treasury.address)
                    assertBn(previousTreasuryBalance.add(appealDeposit), currentTreasuryBalance, 'treasury balances do not match')

                    const currentAppealerBalance = await feeToken.balanceOf(appealMaker)
                    assertBn(previousAppealerBalance.sub(appealDeposit), currentAppealerBalance, 'sender balances do not match')
                  })

                  it('does not create a new round for the dispute', async () => {
                    await disputesManager.createAppeal(disputeId, roundId, appealMakerRuling, { from: appealMaker })

                    await assertRevert(disputesManager.getRound(disputeId, roundId + 1), DISPUTES_MANAGER_ERRORS.ROUND_DOES_NOT_EXIST)
                  })

                  it('does not modify the current round of the dispute', async () => {
                    await disputesManager.createAppeal(disputeId, roundId, appealMakerRuling, { from: appealMaker })

                    const { draftTerm, delayedTerms, roundJurorsNumber, selectedJurors, jurorFees, settledPenalties, collectedTokens } = await courtHelper.getRound(disputeId, roundId)
                    assertBn(draftTerm, draftTermId, 'current round draft term does not match')
                    assertBn(delayedTerms, 0, 'current round delay term does not match')
                    assertBn(roundJurorsNumber, DEFAULTS.firstRoundJurorsNumber, 'current round jurors number does not match')
                    assertBn(selectedJurors, DEFAULTS.firstRoundJurorsNumber, 'current round selected jurors number does not match')
                    assertBn(jurorFees, courtHelper.jurorFee.mul(bn(DEFAULTS.firstRoundJurorsNumber)), 'current round juror fees do not match')
                    assert.equal(settledPenalties, false, 'current round penalties should not be settled')
                    assertBn(collectedTokens, 0, 'current round collected tokens should be zero')
                  })

                  it('does not modify core dispute information', async () => {
                    await disputesManager.createAppeal(disputeId, roundId, appealMakerRuling, { from: appealMaker })

                    const { possibleRulings, state, finalRuling } = await courtHelper.getDispute(disputeId)
                    assertBn(state, DISPUTE_STATES.ADJUDICATING, 'dispute state does not match')
                    assertBn(possibleRulings, 2, 'dispute possible rulings do not match')
                    assertBn(finalRuling, 0, 'dispute final ruling does not match')
                  })

                  it('cannot be appealed twice', async () => {
                    await disputesManager.createAppeal(disputeId, roundId, appealMakerRuling, { from: appealMaker })

                    await assertRevert(disputesManager.createAppeal(disputeId, roundId, appealMakerRuling, { from: appealMaker }), DISPUTES_MANAGER_ERRORS.INVALID_ADJUDICATION_STATE)
                  })
                })

                context('when the appeal maker does not have enough balance', () => {
                  it('reverts', async () => {
                    await assertRevert(disputesManager.createAppeal(disputeId, roundId, appealMakerRuling, { from: appealMaker }), DISPUTES_MANAGER_ERRORS.DEPOSIT_FAILED)
                  })
                })
              })

              context('when the appeal ruling is equal to the winning one', () => {
                beforeEach('set confirmed ruling', async () => {
                  appealMakerRuling = winningRuling
                })

                it('reverts', async () => {
                  await assertRevert(disputesManager.createAppeal(disputeId, roundId, appealMakerRuling, { from: appealMaker }), DISPUTES_MANAGER_ERRORS.INVALID_APPEAL_RULING)
                })
              })
            })

            context('when the appeal ruling is not valid', () => {
              const invalidRuling = 10

              it('reverts', async () => {
                await assertRevert(disputesManager.createAppeal(disputeId, roundId, invalidRuling, { from: appealMaker }), DISPUTES_MANAGER_ERRORS.INVALID_APPEAL_RULING)
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
              { address: juror1500, outcome: OUTCOMES.REFUSED }
            ]
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
          await assertRevert(disputesManager.createAppeal(disputeId, roundId, OUTCOMES.LOW), DISPUTES_MANAGER_ERRORS.ROUND_DOES_NOT_EXIST)
        })
      })
    })

    context('when the given dispute does not exist', () => {
      it('reverts', async () => {
        await assertRevert(disputesManager.createAppeal(0, 0, OUTCOMES.LOW), DISPUTES_MANAGER_ERRORS.DISPUTE_DOES_NOT_EXIST)
      })
    })
  })
})
