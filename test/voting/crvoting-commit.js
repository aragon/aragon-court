const { bn } = require('../helpers/numbers')
const { buildHelper } = require('../helpers/controller')(web3, artifacts)
const { assertRevert } = require('../helpers/assertThrow')
const { OUTCOMES, encryptVote } = require('../helpers/crvoting')
const { assertEvent, assertAmountOfEvents } = require('../helpers/assertEvent')

const CRVoting = artifacts.require('CRVoting')
const Court = artifacts.require('CourtMockForVoting')

contract('CRVoting commit', ([_, voter]) => {
  let controller, voting, court

  const POSSIBLE_OUTCOMES = 2

  beforeEach('create base contracts', async () => {
    controller = await buildHelper().deploy()

    voting = await CRVoting.new(controller.address)
    await controller.setVoting(voting.address)

    court = await Court.new(controller.address)
    await controller.setCourt(court.address)
  })

  describe('commit', () => {
    context('when the given vote ID is valid', () => {
      const voteId = 0

      beforeEach('create voting', async () => {
        await court.create(voteId, POSSIBLE_OUTCOMES)
      })

      context('when the voter has not voted before', () => {
        context('when the owner does not revert when checking the weight of the voter', () => {
          context('when the owner tells a weight greater than zero', () => {
            const weight = 10

            beforeEach('mock voter weight', async () => {
              await court.mockVoterWeight(voter, weight)
            })

            const itHandlesCommittedVotesFor = outcome => {
              const commitment = encryptVote(outcome)

              it('does not affect the voter outcome yet', async () => {
                await voting.commit(voteId, commitment, { from: voter })

                const voterOutcome = await voting.getVoterOutcome(voteId, voter)
                assert.equal(voterOutcome.toString(), OUTCOMES.MISSING, 'voter outcome should be missing')
              })

              it('emits an event', async () => {
                const receipt = await voting.commit(voteId, commitment, { from: voter })

                assertAmountOfEvents(receipt, 'VoteCommitted')
                assertEvent(receipt, 'VoteCommitted', { voteId, voter, commitment })
              })

              it('does not affect the outcomes tally', async () => {
                const previousTally = await voting.getOutcomeTally(voteId, outcome)

                await voting.commit(voteId, commitment, { from: voter })

                const currentTally = await voting.getOutcomeTally(voteId, outcome)
                assert.equal(previousTally.toString(), currentTally.toString(), 'tallies do not match')
              })

              it('does not affect the winning outcome', async () => {
                const previousWinningOutcome = await voting.getWinningOutcome(voteId)
                const previousWinningOutcomeTally = await voting.getOutcomeTally(voteId, previousWinningOutcome)

                await voting.commit(voteId, commitment, { from: voter })

                const currentWinningOutcome = await voting.getWinningOutcome(voteId)
                assert.equal(previousWinningOutcome.toString(), currentWinningOutcome.toString(), 'winning outcomes do not match')

                const currentWinningOutcomeTally = await voting.getOutcomeTally(voteId, currentWinningOutcome)
                assert.equal(previousWinningOutcomeTally.toString(), currentWinningOutcomeTally.toString(), 'winning outcome tallies do not match')
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
              await court.mockVoterWeight(voter, weight)
            })

            it('reverts', async () => {
              await assertRevert(voting.commit(voteId, '0x', { from: voter }), 'CRV_COMMIT_DENIED_BY_OWNER')
            })
          })
        })

        context('when the owner reverts when checking the weight of the voter', () => {
          beforeEach('mock the owner to revert', async () => {
            await court.mockChecksFailing(true)
          })

          it('reverts', async () => {
            await assertRevert(voting.commit(voteId, '0x', { from: voter }), 'CRV_OWNER_MOCK_COMMIT_CHECK_REVERTED')
          })
        })
      })

      context('when the voter has already voted', () => {
        const commitment = encryptVote(0)

        beforeEach('mock voter weight and commit', async () => {
          const weight = 10
          await court.mockVoterWeight(voter, weight)
          await voting.commit(voteId, commitment, { from: voter })
        })

        context('when the new commitment is the same as the previous one', () => {
          it('reverts', async () => {
            await assertRevert(voting.commit(voteId, commitment, { from: voter }), 'CRV_VOTE_ALREADY_COMMITTED')
          })
        })

        context('when the new commitment is different than the previous one', () => {
          it('reverts', async () => {
            await assertRevert(voting.commit(voteId, encryptVote(100), { from: voter }), 'CRV_VOTE_ALREADY_COMMITTED')
          })
        })
      })
    })

    context('when the given vote ID is not valid', () => {
      it('reverts', async () => {
        await assertRevert(voting.commit(0, '0x', { from: voter }), 'CRV_VOTE_DOES_NOT_EXIST')
      })
    })
  })
})
