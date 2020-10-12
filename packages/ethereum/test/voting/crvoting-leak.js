const { bn } = require('@aragon/contract-helpers-test')
const { assertRevert, assertBn, assertAmountOfEvents, assertEvent } = require('@aragon/contract-helpers-test/src/asserts')

const { buildHelper } = require('../helpers/wrappers/court')
const { VOTING_ERRORS } = require('../helpers/utils/errors')
const { VOTING_EVENTS } = require('../helpers/utils/events')
const { SALT, OUTCOMES, hashVote } = require('../helpers/utils/crvoting')

const CRVoting = artifacts.require('CRVoting')
const Court = artifacts.require('DisputeManagerMockForVoting')

contract('CRVoting leak', ([_, voter, someone]) => {
  let controller, voting, disputeManager

  const POSSIBLE_OUTCOMES = 2

  beforeEach('create base contracts', async () => {
    controller = await buildHelper().deploy()

    voting = await CRVoting.new(controller.address)
    await controller.setVoting(voting.address)

    disputeManager = await Court.new(controller.address)
    await controller.setDisputeManager(disputeManager.address)
  })

  describe('leak', () => {
    context('when the given vote ID is valid', () => {
      const voteId = 0

      beforeEach('create voting', async () => {
        await disputeManager.create(voteId, POSSIBLE_OUTCOMES)
      })

      context('when the given voter has not voted before', () => {
        it('reverts', async () => {
          await assertRevert(voting.leak(voteId, voter, OUTCOMES.LOW, SALT, { from: someone }), VOTING_ERRORS.INVALID_COMMITMENT_SALT)
        })
      })

      context('when the given voter has already voted', () => {
        const itHandlesLeakedVotesFor = committedOutcome => {
          const commitment = hashVote(committedOutcome)

          beforeEach('commit a vote', async () => {
            await disputeManager.mockVoterWeight(voter, 10)
            await voting.commit(voteId, commitment, { from: voter })
          })

          context('when the owner does not revert when checking the weight of the voter', () => {
            context('when the owner tells a weight greater than zero', () => {
              const weight = 10

              beforeEach('mock voter weight', async () => {
                await disputeManager.mockVoterWeight(voter, weight)
              })

              context('when the given outcome matches the one committed by the voter', () => {
                const outcome = committedOutcome

                context('when the given salt matches the one used by the voter', () => {
                  const salt = SALT

                  it('leaks the given vote', async () => {
                    await voting.leak(voteId, voter, outcome, salt, { from: someone })

                    const voterOutcome = await voting.getVoterOutcome(voteId, voter)
                    assertBn(voterOutcome, OUTCOMES.LEAKED, 'voter outcome should be leaked')
                  })

                  it('emits an event', async () => {
                    const receipt = await voting.leak(voteId, voter, outcome, salt, { from: someone })

                    assertAmountOfEvents(receipt, VOTING_EVENTS.VOTE_LEAKED)
                    assertEvent(receipt, VOTING_EVENTS.VOTE_LEAKED, { expectedArgs: { voteId, voter, outcome, leaker: someone } })
                  })

                  it('does not affect the outcomes tally', async () => {
                    const previousTally = await voting.getOutcomeTally(voteId, outcome)

                    await voting.leak(voteId, voter, outcome, salt, { from: someone })

                    const currentTally = await voting.getOutcomeTally(voteId, outcome)
                    assertBn(previousTally, currentTally, 'tallies do not match')
                  })

                  it('does not affect the winning outcome', async () => {
                    const previousWinningOutcome = await voting.getWinningOutcome(voteId)
                    const previousWinningOutcomeTally = await voting.getOutcomeTally(voteId, previousWinningOutcome)

                    await voting.leak(voteId, voter, outcome, salt, { from: someone })

                    const currentWinningOutcome = await voting.getWinningOutcome(voteId)
                    assertBn(previousWinningOutcome, currentWinningOutcome, 'winning outcomes do not match')

                    const currentWinningOutcomeTally = await voting.getOutcomeTally(voteId, currentWinningOutcome)
                    assertBn(previousWinningOutcomeTally, currentWinningOutcomeTally, 'winning outcome tallies do not match')
                  })

                  it('does not consider the voter a winner', async () => {
                    await voting.leak(voteId, voter, outcome, salt, { from: someone })

                    const winningOutcome = await voting.getWinningOutcome(voteId)
                    assert.isFalse(await voting.hasVotedInFavorOf(voteId, winningOutcome, voter), 'voter should not be a winner')
                  })
                })

                context('when the given salt does not match the one used by the voter', () => {
                  const salt = '0x'

                  it('reverts', async () => {
                    await assertRevert(voting.leak(voteId, voter, outcome, salt, { from: someone }), VOTING_ERRORS.INVALID_COMMITMENT_SALT)
                  })
                })
              })

              context('when the given outcome does not match the one committed by the voter', () => {
                const outcome = committedOutcome + 1

                context('when the given salt matches the one used by the voter', () => {
                  const salt = SALT

                  it('reverts', async () => {
                    await assertRevert(voting.leak(voteId, voter, outcome, salt, { from: someone }), VOTING_ERRORS.INVALID_COMMITMENT_SALT)
                  })
                })

                context('when the given salt does not match the one used by the voter', () => {
                  const salt = '0x'

                  it('reverts', async () => {
                    await assertRevert(voting.leak(voteId, voter, outcome, salt, { from: someone }), VOTING_ERRORS.INVALID_COMMITMENT_SALT)
                  })
                })
              })
            })
          })

          context('when the owner reverts when checking the weight of the voter', () => {
            beforeEach('mock the owner to revert', async () => {
              await disputeManager.mockChecksFailing(true)
            })

            it('reverts', async () => {
              await assertRevert(voting.leak(voteId, voter, committedOutcome, SALT, { from: someone }), VOTING_ERRORS.OWNER_MOCK_COMMIT_CHECK_REVERTED)
            })
          })
        }

        context('when the given voter committed a missing outcome', async () => {
          itHandlesLeakedVotesFor(OUTCOMES.MISSING)
        })

        context('when the given voter committed a leaked outcome', async () => {
          itHandlesLeakedVotesFor(OUTCOMES.LEAKED)
        })

        context('when the given voter committed a refused outcome', async () => {
          itHandlesLeakedVotesFor(OUTCOMES.REFUSED)
        })

        context('when the given voter committed a valid outcome', async () => {
          itHandlesLeakedVotesFor(OUTCOMES.LOW)
        })

        context('when the given voter committed an out-of-bounds outcome', async () => {
          itHandlesLeakedVotesFor(OUTCOMES.HIGH.add(bn(1)))
        })
      })
    })

    context('when the given vote ID is not valid', () => {
      it('reverts', async () => {
        await assertRevert(voting.leak(0, voter, 0, '0x', { from: someone }), VOTING_ERRORS.VOTE_DOES_NOT_EXIST)
      })
    })
  })
})
