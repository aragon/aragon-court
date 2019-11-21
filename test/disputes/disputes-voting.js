const { assertBn } = require('../helpers/asserts/assertBn')
const { bn, bigExp } = require('../helpers/lib/numbers')
const { filterJurors } = require('../helpers/utils/jurors')
const { assertRevert } = require('../helpers/asserts/assertThrow')
const { VOTING_EVENTS } = require('../helpers/utils/events')
const { VOTING_ERRORS, DISPUTE_MANAGER_ERRORS } = require('../helpers/utils/errors')
const { assertAmountOfEvents, assertEvent } = require('../helpers/asserts/assertEvent')
const { buildHelper, ROUND_STATES, DEFAULTS } = require('../helpers/wrappers/court')(web3, artifacts)
const { getVoteId, hashVote, outcomeFor, SALT, OUTCOMES } = require('../helpers/utils/crvoting')

contract('DisputeManager', ([_, drafter, juror100, juror500, juror1000, juror1500, juror2000, juror2500, juror3000, juror3500, juror4000]) => {
  let courtHelper, voting

  const jurors = [
    { address: juror100,  initialActiveBalance: bigExp(100,  18) },
    { address: juror3000, initialActiveBalance: bigExp(3000, 18) },
    { address: juror500,  initialActiveBalance: bigExp(500,  18) },
    { address: juror1000, initialActiveBalance: bigExp(1000, 18) },
    { address: juror2000, initialActiveBalance: bigExp(2000, 18) },
    { address: juror4000, initialActiveBalance: bigExp(4000, 18) },
    { address: juror1500, initialActiveBalance: bigExp(1500, 18) },
    { address: juror3500, initialActiveBalance: bigExp(3500, 18) },
    { address: juror2500, initialActiveBalance: bigExp(2500, 18) }
  ]

  before('create base contracts and activate jurors', async () => {
    courtHelper = buildHelper()
    await courtHelper.deploy()
    voting = courtHelper.voting
    await courtHelper.activate(jurors)
  })

  describe('voting', () => {
    let disputeId, voteId, voters, nonVoters

    beforeEach('activate jurors and create dispute', async () => {
      disputeId = await courtHelper.dispute()
    })

    const itIsAtState = (roundId, state) => {
      it(`round is at state ${state}`, async () => {
        const { roundState } = await courtHelper.getRound(disputeId, roundId)
        assertBn(roundState, state, 'round state does not match')
      })
    }

    const itFailsToCommitVotes = (commited = true) => {
      it('fails to commit votes', async () => {
        const voterAddresses = voters.map(v => v.address.toLowerCase())
        for (const { address } of jurors) {
          const expectedErrorMessage = (commited && voterAddresses.includes(address.toLowerCase()))
            ? VOTING_ERRORS.VOTE_ALREADY_COMMITTED
            : DISPUTE_MANAGER_ERRORS.INVALID_ADJUDICATION_STATE

          await assertRevert(voting.commit(voteId, hashVote(OUTCOMES.LOW), { from: address }), expectedErrorMessage)
        }
      })
    }

    const itFailsToRevealVotes = (commited = true, revealed = true) => {
      it('fails to reveal votes', async () => {
        const voterAddresses = voters.map(v => v.address.toLowerCase())
        for (const { outcome, address } of voters) {
          const expectedErrorMessage = (commited && voterAddresses.includes(address.toLowerCase()))
            ? (revealed ? VOTING_ERRORS.VOTE_ALREADY_REVEALED : DISPUTE_MANAGER_ERRORS.INVALID_ADJUDICATION_STATE)
            : VOTING_ERRORS.INVALID_COMMITMENT_SALT

          await assertRevert(voting.reveal(voteId, outcome, SALT, { from: address }), expectedErrorMessage)
        }
      })
    }

    context('for regular rounds', () => {
      const roundId = 0
      let draftedJurors, nonDraftedJurors

      beforeEach('draft round', async () => {
        draftedJurors = await courtHelper.draft({ disputeId, drafter })
        nonDraftedJurors = filterJurors(jurors, draftedJurors)
      })

      beforeEach('define a group of voters', async () => {
        voteId = getVoteId(disputeId, roundId)
        // pick the first 3 drafted jurors to vote
        voters = draftedJurors.slice(0, 3)
        voters.forEach((voter, i) => voter.outcome = outcomeFor(i))
        nonVoters = filterJurors(draftedJurors, voters)
      })

      context('during commit period', () => {
        const outcome = OUTCOMES.LOW
        const vote = hashVote(outcome)

        itIsAtState(roundId, ROUND_STATES.COMMITTING)
        itFailsToRevealVotes(false, false)

        context('when the sender was drafted', () => {
          it('allows to commit a vote', async () => {
            for (const { address } of draftedJurors) {
              const receipt = await voting.commit(voteId, vote, { from: address })
              assertAmountOfEvents(receipt, VOTING_EVENTS.VOTE_COMMITTED)
            }
          })
        })

        context('when the sender was not drafted', () => {
          it('reverts', async () => {
            for (const { address } of nonDraftedJurors) {
              await assertRevert(voting.commit(voteId, vote, { from: address }), DISPUTE_MANAGER_ERRORS.VOTER_WEIGHT_ZERO)
            }
          })
        })
      })

      context('during reveal period', () => {
        beforeEach('commit votes', async () => {
          await courtHelper.commit({ disputeId, roundId, voters })
        })

        itIsAtState(roundId, ROUND_STATES.REVEALING)
        itFailsToCommitVotes()

        context('when the sender was drafted', () => {
          context('when the sender voted', () => {
            let receipts, expectedTally

            beforeEach('reveal votes', async () => {
              receipts = []
              expectedTally = { [OUTCOMES.LOW]: 0, [OUTCOMES.HIGH]: 0 }

              for (const { address, weight, outcome } of voters) {
                expectedTally[outcome] += weight.toNumber()
                receipts.push(await voting.reveal(voteId, outcome, SALT, { from: address }))
              }
            })

            it('allows voters to reveal their vote', async () => {
              for (let i = 0; i < voters.length; i++) {
                const { address, outcome } = voters[i]
                assertEvent(receipts[i], VOTING_EVENTS.VOTE_REVEALED, { voteId, voter: address, outcome })
              }
            })

            it('computes tallies properly', async () => {
              const lowOutcomeTally = await voting.getOutcomeTally(voteId, OUTCOMES.LOW)
              assertBn(lowOutcomeTally, expectedTally[OUTCOMES.LOW], 'low outcome tally does not match')

              const highOutcomeTally = await voting.getOutcomeTally(voteId, OUTCOMES.HIGH)
              assertBn(highOutcomeTally, expectedTally[OUTCOMES.HIGH], 'high outcome tally does not match')

              const winningOutcome = await voting.getWinningOutcome(voteId)
              const expectedWinningOutcome = highOutcomeTally > lowOutcomeTally ? OUTCOMES.HIGH : OUTCOMES.LOW
              assertBn(winningOutcome, expectedWinningOutcome, 'winning outcome does not match')
            })
          })

          context('when the sender did not vote', () => {
            it('reverts', async () => {
              for (const { address } of nonVoters) {
                await assertRevert(voting.reveal(voteId, OUTCOMES.LOW, SALT, { from: address }), VOTING_ERRORS.INVALID_COMMITMENT_SALT)
              }
            })
          })
        })
      })

      context('during appeal period', () => {
        beforeEach('commit and reveal votes', async () => {
          await courtHelper.commit({ disputeId, roundId, voters })
          await courtHelper.reveal({ disputeId, roundId, voters })
        })

        itIsAtState(roundId, ROUND_STATES.APPEALING)
        itFailsToCommitVotes()
        itFailsToRevealVotes()
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
          itFailsToCommitVotes()
          itFailsToRevealVotes()
        })

        context('when the round was appealed', () => {
          beforeEach('appeal', async () => {
            await courtHelper.appeal({ disputeId, roundId })
          })

          itIsAtState(roundId, ROUND_STATES.CONFIRMING_APPEAL)
          itFailsToCommitVotes()
          itFailsToRevealVotes()
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
          itFailsToCommitVotes()
          itFailsToRevealVotes()
        })

        context('when the round was appealed', () => {
          beforeEach('appeal', async () => {
            await courtHelper.appeal({ disputeId, roundId })
          })

          context('when the appeal was not confirmed', () => {
            beforeEach('pass appeal confirmation period', async () => {
              await courtHelper.passTerms(courtHelper.appealConfirmTerms)
            })

            itIsAtState(roundId, ROUND_STATES.ENDED)
            itFailsToCommitVotes()
            itFailsToRevealVotes()
          })

          context('when the appeal was confirmed', () => {
            beforeEach('confirm appeal', async () => {
              await courtHelper.confirmAppeal({ disputeId, roundId })
            })

            itIsAtState(roundId, ROUND_STATES.ENDED)
            itFailsToCommitVotes()
            itFailsToRevealVotes()
          })
        })
      })
    })

    context('for a final round', () => {
      const roundId = DEFAULTS.maxRegularAppealRounds.toNumber(), poorJuror = juror100

      beforeEach('simulate juror without enough balance to vote on a final round', async () => {
        const expectedActiveBalance = bigExp(1, 18)
        const { active: previousActiveBalance } = await courtHelper.jurorsRegistry.balanceOf(poorJuror)

        if (previousActiveBalance.gt(expectedActiveBalance)) {
          await courtHelper.jurorsRegistry.collect(poorJuror, previousActiveBalance.sub(expectedActiveBalance))
          await courtHelper.passTerms(bn(1))
        }

        const { active: currentActiveBalance } = await courtHelper.jurorsRegistry.balanceOf(poorJuror)
        assertBn(currentActiveBalance, expectedActiveBalance, 'poor juror active balance does not match')
      })

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
        nonVoters = filterJurors(jurors, voters)
      })

      context('during commit period', () => {
        itIsAtState(roundId, ROUND_STATES.COMMITTING)
        itFailsToRevealVotes(false, false)

        context('when the sender has enough active balance', () => {
          it('allows to commit a vote', async () => {
            for (const { address, outcome } of voters) {
              const receipt = await voting.commit(voteId, hashVote(outcome), { from: address })
              assertAmountOfEvents(receipt, VOTING_EVENTS.VOTE_COMMITTED)
            }
          })
        })

        context('when the sender does not have enough active balance', () => {
          it('reverts', async () => {
            await assertRevert(voting.commit(voteId, hashVote(OUTCOMES.LOW), { from: poorJuror }), DISPUTE_MANAGER_ERRORS.VOTER_WEIGHT_ZERO)
          })
        })
      })

      context('during reveal period', () => {
        beforeEach('commit votes', async () => {
          await courtHelper.commit({ disputeId, roundId, voters })
        })

        itIsAtState(roundId, ROUND_STATES.REVEALING)
        itFailsToCommitVotes()

        context('when the sender voted', () => {
          let receipts, expectedTally

          beforeEach('reveal votes', async () => {
            receipts = []
            expectedTally = { [OUTCOMES.LOW]: 0, [OUTCOMES.HIGH]: 0 }

            for (const { address, outcome } of voters) {
              const { weight } = await courtHelper.getRoundJuror(disputeId, roundId, address)
              expectedTally[outcome] += weight.toNumber()
              receipts.push(await voting.reveal(voteId, outcome, SALT, { from: address }))
            }
          })

          it('allows voters to reveal their vote', async () => {
            for (let i = 0; i < voters.length; i++) {
              const { address, outcome } = voters[i]
              assertEvent(receipts[i], VOTING_EVENTS.VOTE_REVEALED, { voteId, voter: address, outcome })
            }
          })

          it('computes tallies properly', async () => {
            const lowOutcomeTally = await voting.getOutcomeTally(voteId, OUTCOMES.LOW)
            assertBn(lowOutcomeTally, expectedTally[OUTCOMES.LOW], 'low outcome tally does not match')

            const highOutcomeTally = await voting.getOutcomeTally(voteId, OUTCOMES.HIGH)
            assertBn(highOutcomeTally, expectedTally[OUTCOMES.HIGH], 'high outcome tally does not match')

            const winningOutcome = await voting.getWinningOutcome(voteId)
            const expectedWinningOutcome = highOutcomeTally > lowOutcomeTally ? OUTCOMES.HIGH : OUTCOMES.LOW
            assertBn(winningOutcome, expectedWinningOutcome, 'winning outcome does not match')
          })
        })

        context('when the sender did not vote', () => {
          it('reverts', async () => {
            for (const { address } of nonVoters) {
              await assertRevert(voting.reveal(voteId, OUTCOMES.LOW, SALT, { from: address }), VOTING_ERRORS.INVALID_COMMITMENT_SALT)
            }
          })
        })
      })

      context('during appeal period', () => {
        beforeEach('commit and reveal votes', async () => {
          await courtHelper.commit({ disputeId, roundId, voters })
          await courtHelper.reveal({ disputeId, roundId, voters })
        })

        itIsAtState(roundId, ROUND_STATES.ENDED)
        itFailsToCommitVotes()
        itFailsToRevealVotes()
      })

      context('during the appeal confirmation period', () => {
        beforeEach('commit and reveal votes, and pass appeal period', async () => {
          await courtHelper.commit({ disputeId, roundId, voters })
          await courtHelper.reveal({ disputeId, roundId, voters })
          await courtHelper.passTerms(courtHelper.appealTerms)
        })

        itIsAtState(roundId, ROUND_STATES.ENDED)
        itFailsToCommitVotes()
        itFailsToRevealVotes()
      })

      context('after the appeal confirmation period', () => {
        beforeEach('commit and reveal votes, and pass appeal and confirmation periods', async () => {
          await courtHelper.commit({ disputeId, roundId, voters })
          await courtHelper.reveal({ disputeId, roundId, voters })
          await courtHelper.passTerms(courtHelper.appealTerms.add(courtHelper.appealConfirmTerms))
        })

        itIsAtState(roundId, ROUND_STATES.ENDED)
        itFailsToCommitVotes()
        itFailsToRevealVotes()
      })
    })
  })
})
