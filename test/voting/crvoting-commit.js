const { assertRevert } = require('@aragon/test-helpers/assertThrow')
const { SALT, OUTCOMES, encryptVote } = require('../helpers/crvoting')
const { assertEvent, assertAmountOfEvents } = require('@aragon/test-helpers/assertEvent')(web3)

const CRVoting = artifacts.require('CRVoting')
const CRVotingOwner = artifacts.require('CRVotingOwnerMock')

const POSSIBLE_OUTCOMES = 2

contract('CRVoting commit', ([_, voter, anotherVoter]) => {
  let voting, votingOwner

  beforeEach('create base contracts', async () => {
    voting = await CRVoting.new()
    votingOwner = await CRVotingOwner.new(voting.address)
  })

  describe('commit', () => {
    context('when the voting is initialized', () => {
      beforeEach('initialize registry', async () => {
        await voting.init(votingOwner.address)
      })

      context('when the given voting ID is valid', () => {
        const votingId = 0

        beforeEach('create voting', async () => {
          await votingOwner.create(votingId, POSSIBLE_OUTCOMES)
        })

        context('when the voter has not voted before', () => {
          context('when the owner does not revert when checking the weight of the voter', () => {
            context('when the owner tells a weight greater than zero', () => {
              const weight = 10

              beforeEach('mock the owner to revert', async () => {
                await votingOwner.mockVoterWeight(voter, weight)
              })

              const itHandlesCommitmentsProperly = outcome => {
                const commitment = encryptVote(outcome)

                it('commits the voter vote', async () => {
                  const receipt = await voting.commit(votingId, commitment, { from: voter })

                  assertAmountOfEvents(receipt, 'VoteCommitted')
                  assertEvent(receipt, 'VoteCommitted', { votingId, voter, commitment })
                })

                it('does not affect the outcomes tally', async () => {
                  const previousTally = await voting.getOutcomeTally(votingId, outcome)

                  await voting.commit(votingId, commitment, { from: voter })

                  const currentTally = await voting.getOutcomeTally(votingId, outcome)
                  assert.equal(previousTally.toString(), currentTally.toString(), 'tallies do not match')
                })

                it('does not affect the winning outcome', async () => {
                  const previousWinningOutcome = await voting.getWinningOutcome(votingId)
                  const previousWinningOutcomeTally = await voting.getWinningOutcomeTally(votingId)

                  await voting.commit(votingId, commitment, { from: voter })

                  const currentWinningOutcome = await voting.getWinningOutcome(votingId)
                  assert.equal(previousWinningOutcome.toString(), currentWinningOutcome.toString(), 'winning outcomes do not match')

                  const currentWinningOutcomeTally = await voting.getWinningOutcomeTally(votingId)
                  assert.equal(previousWinningOutcomeTally.toString(), currentWinningOutcomeTally.toString(), 'winning outcome tallies do not match')
                })

                context('when there was no reveal vote yet', () => {
                  it('does not consider the voter a winner nor a loser', async () => {
                    await voting.commit(votingId, commitment, { from: voter })

                    assert.isFalse(await voting.isWinningVoter(votingId, voter), 'voter should not be a winner')
                    assert.isFalse((await voting.getLosingVoters(votingId, [voter]))[0], 'voter should not be a loser')
                  })
                })

                context('when there was at least another vote already revealed', () => {
                  beforeEach('allow committing another voter', async () => {
                    await votingOwner.mockVoterWeight(anotherVoter, weight)
                  })

                  context('when the revealed vote was a valid outcome', () => {
                    beforeEach('commit and reveal a valid vote', async () => {
                      await voting.commit(votingId, encryptVote(OUTCOMES.LOW), { from: anotherVoter })
                      await voting.reveal(votingId, OUTCOMES.LOW, SALT, { from: anotherVoter })
                    })

                    it('considers the voter as a loser', async () => {
                      await voting.commit(votingId, commitment, { from: voter })

                      assert.isFalse(await voting.isWinningVoter(votingId, voter), 'voter should not be a winner')
                      assert.isTrue((await voting.getLosingVoters(votingId, [voter]))[0], 'voter should be a loser')
                    })
                  })

                  context('when the revealed vote was a refused outcome', () => {
                    beforeEach('commit and reveal an invalid vote', async () => {
                      await voting.commit(votingId, encryptVote(OUTCOMES.REFUSED), { from: anotherVoter })
                      await voting.reveal(votingId, OUTCOMES.REFUSED, SALT, { from: anotherVoter })
                    })

                    it('does not consider the voter a winner nor a loser', async () => {
                      await voting.commit(votingId, commitment, { from: voter })

                      assert.isFalse(await voting.isWinningVoter(votingId, voter), 'voter should not be a winner')
                      assert.isFalse((await voting.getLosingVoters(votingId, [voter]))[0], 'voter should not be a loser')
                    })
                  })

                  context('when the revealed vote was leaked', () => {
                    beforeEach('commit and leak an invalid vote', async () => {
                      await voting.commit(votingId, encryptVote(OUTCOMES.LOW), { from: anotherVoter })
                      await voting.leak(votingId, anotherVoter, OUTCOMES.LOW, SALT, { from: voter })
                    })

                    it('does not consider the voter a winner nor a loser', async () => {
                      await voting.commit(votingId, commitment, { from: voter })

                      assert.isFalse(await voting.isWinningVoter(votingId, voter), 'voter should not be a winner')
                      assert.isFalse((await voting.getLosingVoters(votingId, [voter]))[0], 'voter should not be a loser')
                    })
                  })
                })
              }

              context('when the given commitment is equal to the missing outcome', async () => {
                itHandlesCommitmentsProperly(OUTCOMES.MISSING)
              })

              context('when the given commitment is equal to the leaked outcome', async () => {
                itHandlesCommitmentsProperly(OUTCOMES.LEAKED)
              })

              context('when the given commitment is equal to the refused outcome', async () => {
                itHandlesCommitmentsProperly(OUTCOMES.REFUSED)
              })

              context('when the given commitment is a valid outcome', async () => {
                itHandlesCommitmentsProperly(OUTCOMES.LOW)
              })
            })

            context('when the owner tells a zeroed weight', () => {
              const weight = 0

              beforeEach('mock the owner to revert', async () => {
                await votingOwner.mockVoterWeight(voter, weight)
              })

              it('reverts', async () => {
                await assertRevert(voting.commit(votingId, '0x', { from: voter }), 'CRV_COMMIT_DENIED_BY_OWNER')
              })
            })
          })

          context('when the owner reverts when checking the weight of the voter', () => {
            beforeEach('mock the owner to revert', async () => {
              await votingOwner.mockChecksFailing(true)
            })

            it('reverts', async () => {
              await assertRevert(voting.commit(votingId, '0x', { from: voter }), 'CRV_OWNER_MOCK_COMMIT_CHECK_REVERTED')
            })
          })
        })

        context('when the voter has already voted', () => {
          const commitment = encryptVote(0)

          beforeEach('mock the owner to revert', async () => {
            const weight = 10
            await votingOwner.mockVoterWeight(voter, weight)
            await voting.commit(votingId, commitment, { from: voter })
          })

          context('when the new commitment is the same as the previous one', () => {
            it('reverts', async () => {
              await assertRevert(voting.commit(votingId, commitment, { from: voter }), 'CRV_VOTE_ALREADY_COMMITTED')
            })
          })

          context('when the new commitment is different than the previous one', () => {
            it('reverts', async () => {
              await assertRevert(voting.commit(votingId, encryptVote(100), { from: voter }), 'CRV_VOTE_ALREADY_COMMITTED')
            })
          })
        })
      })

      context('when the given voting ID is not valid', () => {
        it('reverts', async () => {
          await assertRevert(voting.commit(0, '0x', { from: voter }), 'CRV_VOTING_DOES_NOT_EXIST')
        })
      })

      context('when the registry is not initialized', () => {
        it('reverts', async () => {
          await assertRevert(voting.commit(0, '0x', { from: voter }), 'CRV_VOTING_DOES_NOT_EXIST')
        })
      })
    })
  })
})
