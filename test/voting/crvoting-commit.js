const { bn } = require('../helpers/lib/numbers')
const { assertBn } = require('../helpers/asserts/assertBn')
const { buildHelper } = require('../helpers/wrappers/court')(web3, artifacts)
const { assertRevert } = require('../helpers/asserts/assertThrow')
const { VOTING_EVENTS } = require('../helpers/utils/events')
const { OUTCOMES, hashVote } = require('../helpers/utils/crvoting')
const { DISPUTE_MANAGER_ERRORS, VOTING_ERRORS } = require('../helpers/utils/errors')
const { assertEvent, assertAmountOfEvents } = require('../helpers/asserts/assertEvent')

const CRVoting = artifacts.require('CRVoting')
const DisputeManager = artifacts.require('DisputeManagerMockForVoting')

contract('CRVoting', ([_, voter]) => {
  let controller, voting, disputeManager

  const POSSIBLE_OUTCOMES = 2

  beforeEach('create base contracts', async () => {
    controller = await buildHelper().deploy()
    disputeManager = await DisputeManager.new(controller.address)
    await controller.setDisputeManager(disputeManager.address)
  })

  beforeEach('create voting module', async () => {
    voting = await CRVoting.new(controller.address)
    await controller.setVoting(voting.address)
  })

  describe('commit', () => {
    context('when the given vote ID is valid', () => {
      const voteId = 0

      beforeEach('create voting', async () => {
        await disputeManager.create(voteId, POSSIBLE_OUTCOMES)
      })

      context('when the voter has not voted before', () => {
        context('when the owner does not revert when checking the weight of the voter', () => {
          context('when the owner tells a weight greater than zero', () => {
            const weight = 10

            beforeEach('mock voter weight', async () => {
              await disputeManager.mockVoterWeight(voter, weight)
            })

            const itHandlesCommittedVotesFor = outcome => {
              const commitment = hashVote(outcome)

              it('does not affect the voter outcome yet', async () => {
                await voting.commit(voteId, commitment, { from: voter })

                const voterOutcome = await voting.getVoterOutcome(voteId, voter)
                assertBn(voterOutcome, OUTCOMES.MISSING, 'voter outcome should be missing')
              })

              it('emits an event', async () => {
                const receipt = await voting.commit(voteId, commitment, { from: voter })

                assertAmountOfEvents(receipt, VOTING_EVENTS.VOTE_COMMITTED)
                assertEvent(receipt, VOTING_EVENTS.VOTE_COMMITTED, { voteId, voter, commitment })
              })

              it('does not affect the outcomes tally', async () => {
                const previousTally = await voting.getOutcomeTally(voteId, outcome)

                await voting.commit(voteId, commitment, { from: voter })

                const currentTally = await voting.getOutcomeTally(voteId, outcome)
                assertBn(previousTally, currentTally, 'tallies do not match')
              })

              it('does not affect the winning outcome', async () => {
                const previousWinningOutcome = await voting.getWinningOutcome(voteId)
                const previousWinningOutcomeTally = await voting.getOutcomeTally(voteId, previousWinningOutcome)

                await voting.commit(voteId, commitment, { from: voter })

                const currentWinningOutcome = await voting.getWinningOutcome(voteId)
                assertBn(previousWinningOutcome, currentWinningOutcome, 'winning outcomes do not match')

                const currentWinningOutcomeTally = await voting.getOutcomeTally(voteId, currentWinningOutcome)
                assertBn(previousWinningOutcomeTally, currentWinningOutcomeTally, 'winning outcome tallies do not match')
              })

              it('does not consider the voter a winner', async () => {
                await voting.commit(voteId, commitment, { from: voter })

                const winningOutcome = await voting.getWinningOutcome(voteId)
                assert.isFalse(await voting.hasVotedInFavorOf(voteId, winningOutcome, voter), 'voter should not be a winner')
              })
            }

            context('when the given commitment is equal to the missing outcome', async () => {
              itHandlesCommittedVotesFor(OUTCOMES.MISSING)
            })

            context('when the given commitment is equal to the leaked outcome', async () => {
              itHandlesCommittedVotesFor(OUTCOMES.LEAKED)
            })

            context('when the given commitment is equal to the refused outcome', async () => {
              itHandlesCommittedVotesFor(OUTCOMES.REFUSED)
            })

            context('when the given commitment is a valid outcome', async () => {
              itHandlesCommittedVotesFor(OUTCOMES.LOW)
            })

            context('when the given commitment is an out-of-bounds outcome', async () => {
              itHandlesCommittedVotesFor(OUTCOMES.HIGH.add(bn(1)))
            })
          })

          context('when the owner tells a zeroed weight', () => {
            const weight = 0

            beforeEach('mock voter weight', async () => {
              await disputeManager.mockVoterWeight(voter, weight)
            })

            it('reverts', async () => {
              await assertRevert(voting.commit(voteId, '0x', { from: voter }), DISPUTE_MANAGER_ERRORS.VOTER_WEIGHT_ZERO)
            })
          })
        })

        context('when the owner reverts when checking the weight of the voter', () => {
          beforeEach('mock the owner to revert', async () => {
            await disputeManager.mockChecksFailing(true)
          })

          it('reverts', async () => {
            await assertRevert(voting.commit(voteId, '0x', { from: voter }), VOTING_ERRORS.OWNER_MOCK_COMMIT_CHECK_REVERTED)
          })
        })
      })

      context('when the voter has already voted', () => {
        const commitment = hashVote(0)

        beforeEach('mock voter weight and commit', async () => {
          const weight = 10
          await disputeManager.mockVoterWeight(voter, weight)
          await voting.commit(voteId, commitment, { from: voter })
        })

        context('when the new commitment is the same as the previous one', () => {
          it('reverts', async () => {
            await assertRevert(voting.commit(voteId, commitment, { from: voter }), VOTING_ERRORS.VOTE_ALREADY_COMMITTED)
          })
        })

        context('when the new commitment is different than the previous one', () => {
          it('reverts', async () => {
            await assertRevert(voting.commit(voteId, hashVote(100), { from: voter }), VOTING_ERRORS.VOTE_ALREADY_COMMITTED)
          })
        })
      })
    })

    context('when the given vote ID is not valid', () => {
      it('reverts', async () => {
        await assertRevert(voting.commit(0, '0x', { from: voter }), VOTING_ERRORS.VOTE_DOES_NOT_EXIST)
      })
    })
  })
})
