const { bn } = require('../helpers/numbers')
const { assertRevert } = require('../helpers/assertThrow')
const { SALT, OUTCOMES, encryptVote } = require('../helpers/crvoting')
const { assertEvent, assertAmountOfEvents } = require('../helpers/assertEvent')

const CRVoting = artifacts.require('CRVoting')
const CRVotingOwner = artifacts.require('CRVotingOwnerMock')

contract('CRVoting reveal', ([_, voter]) => {
  let voting, votingOwner

  const POSSIBLE_OUTCOMES = 2

  beforeEach('create base contracts', async () => {
    voting = await CRVoting.new()
    votingOwner = await CRVotingOwner.new(voting.address)
  })

  describe('reveal', () => {
    context('when the voting is initialized', () => {
      beforeEach('initialize voting', async () => {
        await voting.init(votingOwner.address)
      })

      context('when the given vote ID is valid', () => {
        const voteId = 0

        beforeEach('create voting', async () => {
          await votingOwner.create(voteId, POSSIBLE_OUTCOMES)
        })

        context('when the given voter has not voted before', () => {
          context('when the owner does not revert when checking the weight of the voter', () => {
            context('when the owner tells a weight greater than zero', () => {
              const weight = 10

              beforeEach('mock voter weight', async () => {
                await votingOwner.mockVoterWeight(voter, weight)
              })

              it('reverts', async () => {
                await assertRevert(voting.reveal(voteId, OUTCOMES.LOW, SALT, { from: voter }), 'CRV_INVALID_COMMITMENT_SALT')
              })
            })

            context('when the owner tells a zeroed weight', () => {
              const weight = 0

              beforeEach('mock voter weight', async () => {
                await votingOwner.mockVoterWeight(voter, weight)
              })

              it('reverts', async () => {
                await assertRevert(voting.reveal(voteId, OUTCOMES.LOW, SALT, { from: voter }), 'CRV_REVEAL_DENIED_BY_OWNER')
              })
            })
          })

          context('when the owner reverts when checking the weight of the voter', () => {
            beforeEach('mock the owner to revert', async () => {
              await votingOwner.mockChecksFailing(true)
            })

            it('reverts', async () => {
              await assertRevert(voting.reveal(voteId, OUTCOMES.LOW, SALT, { from: voter }), 'CRV_OWNER_MOCK_REVEAL_CHECK_REVERTED')
            })
          })
        })

        context('when the given voter has already voted', () => {
          const itHandlesValidRevealedVotesFor = committedOutcome => {
            const commitment = encryptVote(committedOutcome)

            beforeEach('commit a vote', async () => {
              await votingOwner.mockVoterWeight(voter, 10)
              await voting.commit(voteId, commitment, { from: voter })
            })

            context('when the owner does not revert when checking the weight of the voter', () => {
              context('when the owner tells a weight greater than zero', () => {
                const weight = 10

                beforeEach('mock voter weight', async () => {
                  await votingOwner.mockVoterWeight(voter, weight)
                })

                context('when the given outcome matches the one committed', () => {
                  const outcome = committedOutcome

                  context('when the given salt matches the one used', () => {
                    const salt = SALT

                    it('reveals the given vote', async () => {
                      await voting.reveal(voteId, outcome, salt, { from: voter })

                      const voterOutcome = await voting.getVoterOutcome(voteId, voter)
                      assert.equal(voterOutcome.toString(), outcome, 'voter outcome does not match')
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
                      assert.equal(previousTally.add(bn(weight)).toString(), currentTally.toString(), 'tallies do not match')
                    })

                    it('computes the new winning outcome', async () => {
                      await voting.reveal(voteId, outcome, salt, { from: voter })

                      assert.equal((await voting.getWinningOutcome(voteId)).toString(), outcome, 'winning outcomes does not match')
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
                      await assertRevert(voting.reveal(voteId, outcome, salt, { from: voter }), 'CRV_INVALID_COMMITMENT_SALT')
                    })
                  })
                })

                context('when the given outcome does not match the one committed', () => {
                  const outcome = committedOutcome + 1

                  context('when the given salt matches the one used', () => {
                    const salt = SALT

                    it('reverts', async () => {
                      await assertRevert(voting.reveal(voteId, outcome, salt, { from: voter }), 'CRV_INVALID_COMMITMENT_SALT')
                    })
                  })

                  context('when the given salt does not match the one used', () => {
                    const salt = '0x'

                    it('reverts', async () => {
                      await assertRevert(voting.reveal(voteId, outcome, salt, { from: voter }), 'CRV_INVALID_COMMITMENT_SALT')
                    })
                  })
                })
              })

              context('when the owner tells a zeroed weight', () => {
                const weight = 0

                beforeEach('mock voter weight', async () => {
                  await votingOwner.mockVoterWeight(voter, weight)
                })

                it('reverts', async () => {
                  await assertRevert(voting.reveal(voteId, OUTCOMES.LOW, SALT, { from: voter }), 'CRV_REVEAL_DENIED_BY_OWNER')
                })
              })
            })

            context('when the owner reverts when checking the weight of the voter', () => {
              beforeEach('mock the owner to revert', async () => {
                await votingOwner.mockChecksFailing(true)
              })

              it('reverts', async () => {
                await assertRevert(voting.reveal(voteId, committedOutcome, SALT, { from: voter }), 'CRV_OWNER_MOCK_REVEAL_CHECK_REVERTED')
              })
            })
          }

          const itHandlesInvalidRevealedVotesFor = committedOutcome => {
            const commitment = encryptVote(committedOutcome)

            beforeEach('commit a vote', async () => {
              await votingOwner.mockVoterWeight(voter, 10)
              await voting.commit(voteId, commitment, { from: voter })
            })

            context('when the owner does not revert when checking the weight of the voter', () => {
              context('when the owner tells a weight greater than zero', () => {
                const weight = 10

                beforeEach('mock voter weight', async () => {
                  await votingOwner.mockVoterWeight(voter, weight)
                })

                context('when the given outcome matches the one committed by the voter', () => {
                  const outcome = committedOutcome

                  context('when the given salt matches the one used by the voter', () => {
                    const salt = SALT

                    it('reverts', async () => {
                      await assertRevert(voting.reveal(voteId, outcome, salt, { from: voter }), 'CRV_INVALID_OUTCOME')
                    })
                  })

                  context('when the given salt does not match the one used by the voter', () => {
                    const salt = '0x'

                    it('reverts', async () => {
                      await assertRevert(voting.reveal(voteId, outcome, salt, { from: voter }), 'CRV_INVALID_COMMITMENT_SALT')
                    })
                  })
                })

                context('when the given outcome does not match the one committed by the voter', () => {
                  const outcome = committedOutcome + 1

                  context('when the given salt matches the one used by the voter', () => {
                    const salt = SALT

                    it('reverts', async () => {
                      await assertRevert(voting.reveal(voteId, outcome, salt, { from: voter }), 'CRV_INVALID_COMMITMENT_SALT')
                    })
                  })

                  context('when the given salt does not match the one used by the voter', () => {
                    const salt = '0x'

                    it('reverts', async () => {
                      await assertRevert(voting.reveal(voteId, outcome, salt, { from: voter }), 'CRV_INVALID_COMMITMENT_SALT')
                    })
                  })
                })
              })

              context('when the owner tells a zeroed weight', () => {
                const weight = 0

                beforeEach('mock voter weight', async () => {
                  await votingOwner.mockVoterWeight(voter, weight)
                })

                it('reverts', async () => {
                  await assertRevert(voting.reveal(voteId, OUTCOMES.LOW, SALT, { from: voter }), 'CRV_REVEAL_DENIED_BY_OWNER')
                })
              })
            })

            context('when the owner reverts when checking the weight of the voter', () => {
              beforeEach('mock the owner to revert', async () => {
                await votingOwner.mockChecksFailing(true)
              })

              it('reverts', async () => {
                await assertRevert(voting.reveal(voteId, committedOutcome, SALT, { from: voter }), 'CRV_OWNER_MOCK_REVEAL_CHECK_REVERTED')
              })
            })
          }

          context('when the given voter committed a valid outcome', async () => {
            itHandlesValidRevealedVotesFor(OUTCOMES.LOW)
          })

          context('when the given voter committed a refused outcome', async () => {
            itHandlesValidRevealedVotesFor(OUTCOMES.REFUSED)
          })

          context('when the given voter committed a missing outcome', async () => {
            itHandlesInvalidRevealedVotesFor(OUTCOMES.MISSING)
          })

          context('when the given voter committed a leaked outcome', async () => {
            itHandlesInvalidRevealedVotesFor(OUTCOMES.LEAKED)
          })

          context('when the given voter committed an out-of-bounds outcome', async () => {
            itHandlesInvalidRevealedVotesFor(OUTCOMES.HIGH.add(bn(1)))
          })
        })
      })

      context('when the given vote ID is not valid', () => {
        it('reverts', async () => {
          await assertRevert(voting.reveal(0, 0, '0x', { from: voter }), 'CRV_VOTE_DOES_NOT_EXIST')
        })
      })
    })

    context('when the voting is not initialized', () => {
      it('reverts', async () => {
        await assertRevert(voting.reveal(0, 0, '0x', { from: voter }), 'CRV_VOTE_DOES_NOT_EXIST')
      })
    })
  })
})
