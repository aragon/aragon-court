const { bn } = require('../helpers/lib/numbers')
const { assertBn } = require('../helpers/asserts/assertBn')
const { buildHelper } = require('../helpers/wrappers/controller')(web3, artifacts)
const { assertRevert } = require('../helpers/asserts/assertThrow')
const { VOTING_ERRORS } = require('../helpers/utils/errors')
const { SALT, OUTCOMES, encryptVote } = require('../helpers/utils/crvoting')
const { assertEvent, assertAmountOfEvents } = require('../helpers/asserts/assertEvent')

const CRVoting = artifacts.require('CRVoting')
const Court = artifacts.require('CourtMockForVoting')

contract('CRVoting reveal', ([_, voter]) => {
  let controller, voting, court

  const POSSIBLE_OUTCOMES = 2

  beforeEach('create base contracts', async () => {
    controller = await buildHelper().deploy()

    voting = await CRVoting.new(controller.address)
    await controller.setVoting(voting.address)

    court = await Court.new(controller.address)
    await controller.setCourt(court.address)
  })

  describe('reveal', () => {
    context('when the given vote ID is valid', () => {
      const voteId = 0

      beforeEach('create voting', async () => {
        await court.create(voteId, POSSIBLE_OUTCOMES)
      })

      context('when the given voter has not voted before', () => {
        it('reverts', async () => {
          await assertRevert(voting.reveal(voteId, OUTCOMES.LOW, SALT, { from: voter }), VOTING_ERRORS.INVALID_COMMITMENT_SALT)
        })
      })

      context('when the given voter has already voted', () => {
        const itHandlesValidRevealedVotesFor = committedOutcome => {
          const commitment = encryptVote(committedOutcome)

          beforeEach('commit a vote', async () => {
            await court.mockVoterWeight(voter, 10)
            await voting.commit(voteId, commitment, { from: voter })
          })

          context('when the owner does not revert when checking the weight of the voter', () => {
            context('when the owner tells a weight greater than zero', () => {
              const weight = 10

              beforeEach('mock voter weight', async () => {
                await court.mockVoterWeight(voter, weight)
              })

              context('when the given outcome matches the one committed', () => {
                const outcome = committedOutcome

                context('when the given salt matches the one used', () => {
                  const salt = SALT

                  it('reveals the given vote', async () => {
                    await voting.reveal(voteId, outcome, salt, { from: voter })

                    const voterOutcome = await voting.getVoterOutcome(voteId, voter)
                    assertBn(voterOutcome, outcome, 'voter outcome does not match')
                  })

                  it('emits an event', async () => {
                    const receipt = await voting.reveal(voteId, outcome, salt, { from: voter })

                    assertAmountOfEvents(receipt, 'VoteRevealed')
                    assertEvent(receipt, 'VoteRevealed', { voteId, voter, outcome })
                  })

                  it('updates the outcomes tally', async () => {
                    const previousTally = await voting.getOutcomeTally(voteId, outcome)

                    await voting.reveal(voteId, outcome, salt, { from: voter })

                    const currentTally = await voting.getOutcomeTally(voteId, outcome)
                    assertBn(previousTally.add(bn(weight)), currentTally, 'tallies do not match')
                  })

                  it('computes the new winning outcome', async () => {
                    await voting.reveal(voteId, outcome, salt, { from: voter })

                    assertBn((await voting.getWinningOutcome(voteId)), outcome, 'winning outcomes does not match')
                  })

                  it('considers the voter as a winner', async () => {
                    await voting.reveal(voteId, outcome, salt, { from: voter })

                    const winningOutcome = await voting.getWinningOutcome(voteId)
                    assert.isTrue(await voting.hasVotedInFavorOf(voteId, winningOutcome, voter), 'voter should be a winner')
                  })
                })

                context('when the given salt does not match the one used', () => {
                  const salt = '0x'

                  it('reverts', async () => {
                    await assertRevert(voting.reveal(voteId, outcome, salt, { from: voter }), VOTING_ERRORS.INVALID_COMMITMENT_SALT)
                  })
                })
              })

              context('when the given outcome does not match the one committed', () => {
                const outcome = committedOutcome + 1

                context('when the given salt matches the one used', () => {
                  const salt = SALT

                  it('reverts', async () => {
                    await assertRevert(voting.reveal(voteId, outcome, salt, { from: voter }), VOTING_ERRORS.INVALID_COMMITMENT_SALT)
                  })
                })

                context('when the given salt does not match the one used', () => {
                  const salt = '0x'

                  it('reverts', async () => {
                    await assertRevert(voting.reveal(voteId, outcome, salt, { from: voter }), VOTING_ERRORS.INVALID_COMMITMENT_SALT)
                  })
                })
              })
            })
          })

          context('when the owner reverts when checking the weight of the voter', () => {
            beforeEach('mock the owner to revert', async () => {
              await court.mockChecksFailing(true)
            })

            it('reverts', async () => {
              await assertRevert(voting.reveal(voteId, committedOutcome, SALT, { from: voter }), VOTING_ERRORS.OWNER_MOCK_REVEAL_CHECK_REVERTED)
            })
          })
        }

        const itHandlesInvalidOutcomeRevealedVotesFor = committedOutcome => {
          const commitment = encryptVote(committedOutcome)

          beforeEach('commit a vote', async () => {
            await court.mockVoterWeight(voter, 10)
            await voting.commit(voteId, commitment, { from: voter })
          })

          it('reverts', async () => {
            await assertRevert(voting.reveal(voteId, committedOutcome, SALT, { from: voter }), VOTING_ERRORS.INVALID_OUTCOME)
          })
        }

        context('when the given voter committed a valid outcome', async () => {
          itHandlesValidRevealedVotesFor(OUTCOMES.LOW)
        })

        context('when the given voter committed a refused outcome', async () => {
          itHandlesValidRevealedVotesFor(OUTCOMES.REFUSED)
        })

        context('when the given voter committed a missing outcome', async () => {
          itHandlesInvalidOutcomeRevealedVotesFor(OUTCOMES.MISSING)
        })

        context('when the given voter committed a leaked outcome', async () => {
          itHandlesInvalidOutcomeRevealedVotesFor(OUTCOMES.LEAKED)
        })

        context('when the given voter committed an out-of-bounds outcome', async () => {
          itHandlesInvalidOutcomeRevealedVotesFor(OUTCOMES.HIGH.add(bn(1)))
        })
      })
    })

    context('when the given vote ID is not valid', () => {
      it('reverts', async () => {
        await assertRevert(voting.reveal(0, 0, '0x', { from: voter }), VOTING_ERRORS.VOTE_DOES_NOT_EXIST)
      })
    })
  })
})
