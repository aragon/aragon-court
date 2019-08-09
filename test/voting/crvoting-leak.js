const { assertRevert } = require('@aragon/test-helpers/assertThrow')
const { SALT, OUTCOMES, encryptVote } = require('../helpers/crvoting')
const { assertEvent, assertAmountOfEvents } = require('@aragon/test-helpers/assertEvent')(web3)

const CRVoting = artifacts.require('CRVoting')
const CRVotingOwner = artifacts.require('CRVotingOwnerMock')

const POSSIBLE_OUTCOMES = 2

contract('CRVoting leak', ([_, voter, someone]) => {
  let voting, votingOwner

  beforeEach('create base contracts', async () => {
    voting = await CRVoting.new()
    votingOwner = await CRVotingOwner.new(voting.address)
  })

  describe('leak', () => {
    context('when the voting is initialized', () => {
      beforeEach('initialize registry', async () => {
        await voting.init(votingOwner.address)
      })

      context('when the given voting ID is valid', () => {
        const votingId = 0

        beforeEach('create voting', async () => {
          await votingOwner.create(votingId, POSSIBLE_OUTCOMES)
        })

        context('when the given voter has not voted before', () => {
          context('when the owner does not revert when checking the weight of the voter', () => {
            context('when the owner tells a weight greater than zero', () => {
              const weight = 10

              beforeEach('mock the owner to revert', async () => {
                await votingOwner.mockVoterWeight(voter, weight)
              })

              it('reverts', async () => {
                await assertRevert(voting.leak(votingId, voter, OUTCOMES.LOW, SALT, { from: someone }), 'CRV_INVALID_COMMITMENT_SALT')
              })
            })

            context('when the owner tells a zeroed weight', () => {
              const weight = 0

              beforeEach('mock the owner to revert', async () => {
                await votingOwner.mockVoterWeight(voter, weight)
              })

              it('reverts', async () => {
                await assertRevert(voting.leak(votingId, voter, OUTCOMES.LOW, SALT, { from: someone }), 'CRV_COMMIT_DENIED_BY_OWNER')
              })
            })
          })

          context('when the owner reverts when checking the weight of the voter', () => {
            beforeEach('mock the owner to revert', async () => {
              await votingOwner.mockChecksFailing(true)
            })

            it('reverts', async () => {
              await assertRevert(voting.leak(votingId, voter, OUTCOMES.LOW, SALT, { from: someone }), 'CRV_OWNER_MOCK_COMMIT_CHECK_REVERTED')
            })
          })
        })

        context('when the given voter has already voted', () => {
          const itHandlesLeakedVotesFor = committedOutcome => {
            const commitment = encryptVote(committedOutcome)

            beforeEach('commit a vote', async () => {
              await votingOwner.mockVoterWeight(voter, 10)
              await voting.commit(votingId, commitment, { from: voter })
            })

            context('when the owner does not revert when checking the weight of the voter', () => {
              context('when the owner tells a weight greater than zero', () => {
                const weight = 10

                beforeEach('mock the owner to revert', async () => {
                  await votingOwner.mockVoterWeight(voter, weight)
                })

                context('when the given outcome matches the one committed by the voter', () => {
                  const outcome = committedOutcome

                  context('when the given salt matches the one used by the voter', () => {
                    const salt = SALT

                    it('leaks the given vote', async () => {
                      await voting.leak(votingId, voter, outcome, salt, { from: someone })

                      const voterOutcome = await voting.getVoterOutcome(votingId, voter)
                      assert.equal(voterOutcome.toString(), OUTCOMES.LEAKED, 'voter outcome should be leaked')
                    })

                    it('emits an event', async () => {
                      const receipt = await voting.leak(votingId, voter, outcome, salt, { from: someone })

                      assertAmountOfEvents(receipt, 'VoteLeaked')
                      assertEvent(receipt, 'VoteLeaked', { votingId, voter, outcome, leaker: someone })
                    })

                    it('does not affect the outcomes tally', async () => {
                      const previousTally = await voting.getOutcomeTally(votingId, outcome)

                      await voting.leak(votingId, voter, outcome, salt, { from: someone })

                      const currentTally = await voting.getOutcomeTally(votingId, outcome)
                      assert.equal(previousTally.toString(), currentTally.toString(), 'tallies do not match')
                    })

                    it('does not affect the winning outcome', async () => {
                      const previousWinningOutcome = await voting.getWinningOutcome(votingId)
                      const previousWinningOutcomeTally = await voting.getWinningOutcomeTally(votingId)

                      await voting.leak(votingId, voter, outcome, salt, { from: someone })

                      const currentWinningOutcome = await voting.getWinningOutcome(votingId)
                      assert.equal(previousWinningOutcome.toString(), currentWinningOutcome.toString(), 'winning outcomes do not match')

                      const currentWinningOutcomeTally = await voting.getWinningOutcomeTally(votingId)
                      assert.equal(previousWinningOutcomeTally.toString(), currentWinningOutcomeTally.toString(), 'winning outcome tallies do not match')
                    })

                    it('does not consider the voter a winner', async () => {
                      await voting.leak(votingId, voter, outcome, salt, { from: someone })

                      const winningOutcome = await voting.getWinningOutcome(votingId)
                      assert.isFalse(await voting.hasVotedInFavorOf(votingId, winningOutcome, voter), 'voter should not be a winner')
                    })
                  })

                  context('when the given salt does not match the one used by the voter', () => {
                    const salt = '0x'

                    it('reverts', async () => {
                      await assertRevert(voting.leak(votingId, voter, outcome, salt, { from: someone }), 'CRV_INVALID_COMMITMENT_SALT')
                    })
                  })
                })

                context('when the given outcome does not match the one committed by the voter', () => {
                  const outcome = committedOutcome + 1

                  context('when the given salt matches the one used by the voter', () => {
                    const salt = SALT

                    it('reverts', async () => {
                      await assertRevert(voting.leak(votingId, voter, outcome, salt, { from: someone }), 'CRV_INVALID_COMMITMENT_SALT')
                    })
                  })

                  context('when the given salt does not match the one used by the voter', () => {
                    const salt = '0x'

                    it('reverts', async () => {
                      await assertRevert(voting.leak(votingId, voter, outcome, salt, { from: someone }), 'CRV_INVALID_COMMITMENT_SALT')
                    })
                  })
                })
              })

              context('when the owner tells a zeroed weight', () => {
                const weight = 0

                beforeEach('mock the owner to revert', async () => {
                  await votingOwner.mockVoterWeight(voter, weight)
                })

                it('reverts', async () => {
                  await assertRevert(voting.leak(votingId, voter, OUTCOMES.LOW, SALT, { from: someone }), 'CRV_COMMIT_DENIED_BY_OWNER')
                })
              })
            })

            context('when the owner reverts when checking the weight of the voter', () => {
              beforeEach('mock the owner to revert', async () => {
                await votingOwner.mockChecksFailing(true)
              })

              it('reverts', async () => {
                await assertRevert(voting.leak(votingId, voter, committedOutcome, SALT, { from: someone }), 'CRV_OWNER_MOCK_COMMIT_CHECK_REVERTED')
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
            itHandlesLeakedVotesFor(OUTCOMES.HIGH + 1)
          })
        })
      })

      context('when the given voting ID is not valid', () => {
        it('reverts', async () => {
          await assertRevert(voting.leak(0, voter, 0, '0x', { from: someone }), 'CRV_VOTING_DOES_NOT_EXIST')
        })
      })

      context('when the registry is not initialized', () => {
        it('reverts', async () => {
          await assertRevert(voting.leak(0, voter, 0, '0x', { from: someone }), 'CRV_VOTING_DOES_NOT_EXIST')
        })
      })
    })
  })
})
