const { assertRevert } = require('@aragon/test-helpers/assertThrow')
const { SALT, OUTCOMES, encryptVote } = require('../helpers/crvoting')
const { assertEvent, assertAmountOfEvents } = require('@aragon/test-helpers/assertEvent')(web3)

const CRVoting = artifacts.require('CRVoting')
const CRVotingOwner = artifacts.require('CRVotingOwnerMock')

const POSSIBLE_OUTCOMES = 2

contract('CRVoting reveal', ([_, voter, anotherVoter]) => {
  let voting, votingOwner

  beforeEach('create base contracts', async () => {
    voting = await CRVoting.new()
    votingOwner = await CRVotingOwner.new(voting.address)
  })

  describe('reveal', () => {
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
                await assertRevert(voting.reveal(votingId, OUTCOMES.LOW, SALT, { from: voter }), 'CRV_INVALID_COMMITMENT_SALT')
              })
            })

            context('when the owner tells a zeroed weight', () => {
              const weight = 0

              beforeEach('mock the owner to revert', async () => {
                await votingOwner.mockVoterWeight(voter, weight)
              })

              it('reverts', async () => {
                await assertRevert(voting.reveal(votingId, OUTCOMES.LOW, SALT, { from: voter }), 'CRV_REVEAL_DENIED_BY_OWNER')
              })
            })
          })

          context('when the owner reverts when checking the weight of the voter', () => {
            beforeEach('mock the owner to revert', async () => {
              await votingOwner.mockChecksFailing(true)
            })

            it('reverts', async () => {
              await assertRevert(voting.reveal(votingId, OUTCOMES.LOW, SALT, { from: voter }), 'CRV_OWNER_MOCK_REVEAL_CHECK_REVERTED')
            })
          })
        })

        context('when the given voter has already voted', () => {
          const itHandlesValidRevealedVotesFor = committedOutcome => {
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

                context('when the given outcome matches the one committed', () => {
                  const outcome = committedOutcome

                  context('when the given salt matches the one used', () => {
                    const salt = SALT

                    const itHandlesRevealedVoteProperly = () => {
                      it('reveals the given vote', async () => {
                        await voting.reveal(votingId, outcome, salt, { from: voter })

                        const voterOutcome = await voting.getVoterOutcome(votingId, voter)
                        assert.equal(voterOutcome.toString(), outcome, 'voter outcome does not match')
                      })

                      it('emits an event', async () => {
                        const receipt = await voting.reveal(votingId, outcome, salt, { from: voter })

                        assertAmountOfEvents(receipt, 'VoteRevealed')
                        assertEvent(receipt, 'VoteRevealed', { votingId, voter, outcome })
                      })

                      if (outcome !== OUTCOMES.REFUSED) {
                        it('updates the outcomes tally', async () => {
                          const previousTally = await voting.getOutcomeTally(votingId, outcome)

                          await voting.reveal(votingId, outcome, salt, { from: voter })

                          const currentTally = await voting.getOutcomeTally(votingId, outcome)
                          assert.equal(previousTally.plus(weight).toString(), currentTally.toString(), 'tallies do not match')
                        })
                      } else {
                        it('does not affect the outcomes tally', async () => {
                          const previousTally = await voting.getOutcomeTally(votingId, outcome)

                          await voting.reveal(votingId, outcome, salt, { from: voter })

                          const currentTally = await voting.getOutcomeTally(votingId, outcome)
                          assert.equal(previousTally.toString(), currentTally.toString(), 'tallies do not match')
                        })
                      }
                    }

                    const itConsidersTheVoterWinner = (winner) => {
                      it('considers the voter as a winner', async () => {
                        await voting.reveal(votingId, outcome, salt, { from: voter })

                        assert.isTrue(await voting.isWinningVoter(votingId, winner), 'voter should be a winner')
                        assert.isFalse((await voting.getLosingVoters(votingId, [winner]))[0], 'voter should not be a loser')
                      })
                    }

                    const itConsidersTheVoterLoser = (loser) => {
                      it('considers the voter as a loser', async () => {
                        await voting.reveal(votingId, outcome, salt, { from: voter })

                        assert.isFalse(await voting.isWinningVoter(votingId, loser), 'voter should be not a winner')
                        assert.isTrue((await voting.getLosingVoters(votingId, [loser]))[0], 'voter should be a loser')
                      })
                    }

                    const itDoesNotConsiderVoterWinnerNorLoser = (notWinnerNorLoser) => {
                      it('does not consider the voter a winner nor a loser', async () => {
                        await voting.reveal(votingId, outcome, salt, { from: voter })

                        assert.isFalse(await voting.isWinningVoter(votingId, notWinnerNorLoser), 'voter should not be a winner')
                        assert.isFalse((await voting.getLosingVoters(votingId, [notWinnerNorLoser]))[0], 'voter should not be a loser')
                      })
                    }

                    const itComputesNewWinningOutcome = (winningOutcome) => {
                      it('computes the new winning outcome', async () => {
                        const previousWinningOutcome = await voting.getWinningOutcome(votingId)

                        await voting.reveal(votingId, outcome, salt, { from: voter })

                        const currentWinningOutcome = await voting.getWinningOutcome(votingId)
                        assert.equal(currentWinningOutcome.toString(), winningOutcome, 'winning outcomes do not match')
                        assert.notEqual(previousWinningOutcome.toString(), currentWinningOutcome.toString(), 'winning outcomes do not match')
                      })
                    }

                    const itDoesNotChangeTheWinningOutcome = (increasedWeight = 0) => {
                      it('does not affect the winning outcome', async () => {
                        const previousWinningOutcome = await voting.getWinningOutcome(votingId)
                        const previousWinningOutcomeTally = await voting.getWinningOutcomeTally(votingId)

                        await voting.reveal(votingId, outcome, salt, { from: voter })

                        const currentWinningOutcome = await voting.getWinningOutcome(votingId)
                        assert.equal(previousWinningOutcome.toString(), currentWinningOutcome.toString(), 'winning outcomes do not match')

                        const currentWinningOutcomeTally = await voting.getWinningOutcomeTally(votingId)
                        assert.equal(previousWinningOutcomeTally.plus(increasedWeight).toString(), currentWinningOutcomeTally.toString(), 'winning outcome tallies do not match')
                      })
                    }

                    if (outcome !== OUTCOMES.REFUSED) {
                      context('when there were no other votes yet', () => {
                        itHandlesRevealedVoteProperly()
                        itConsidersTheVoterWinner(voter)
                        itComputesNewWinningOutcome(outcome)
                      })

                      context('when there was another vote', () => {
                        context('when the other vote was a valid outcome', () => {
                          context('when the other vote was the other outcome', () => {
                            const anotherOutcome = OUTCOMES.HIGH
                            const anotherCommitment = encryptVote(anotherOutcome)

                            context('when the other voter has a lower weight', () => {
                              const anotherWeight = weight - 1

                              beforeEach('commit another vote', async () => {
                                await votingOwner.mockVoterWeight(anotherVoter, anotherWeight)
                                await voting.commit(votingId, anotherCommitment, { from: anotherVoter })
                              })

                              context('when the other vote was not revealed yet', () => {
                                itHandlesRevealedVoteProperly()
                                itConsidersTheVoterWinner(voter)
                                itConsidersTheVoterLoser(anotherVoter)
                                itComputesNewWinningOutcome(outcome)
                              })

                              context('when the other vote was leaked', () => {
                                beforeEach('leak vote', async () => {
                                  await voting.leak(votingId, anotherVoter, anotherOutcome, SALT, { from: voter })
                                })

                                itHandlesRevealedVoteProperly()
                                itConsidersTheVoterWinner(voter)
                                itConsidersTheVoterLoser(anotherVoter)
                                itComputesNewWinningOutcome(outcome)
                              })

                              context('when the other vote was revealed', () => {
                                beforeEach('reveal vote', async () => {
                                  await voting.reveal(votingId, anotherOutcome, SALT, { from: anotherVoter })
                                })

                                itHandlesRevealedVoteProperly()
                                itConsidersTheVoterWinner(voter)
                                itConsidersTheVoterLoser(anotherVoter)
                                itComputesNewWinningOutcome(outcome)
                              })
                            })

                            context('when the other voter has the same weight', () => {
                              const anotherWeight = weight

                              beforeEach('commit another vote', async () => {
                                await votingOwner.mockVoterWeight(anotherVoter, anotherWeight)
                                await voting.commit(votingId, anotherCommitment, { from: anotherVoter })
                              })

                              context('when the other vote was not revealed yet', () => {
                                itHandlesRevealedVoteProperly()
                                itConsidersTheVoterWinner(voter)
                                itConsidersTheVoterLoser(anotherVoter)
                                itComputesNewWinningOutcome(outcome)
                              })

                              context('when the other vote was leaked', () => {
                                beforeEach('leak vote', async () => {
                                  await voting.leak(votingId, anotherVoter, anotherOutcome, SALT, { from: voter })
                                })

                                itHandlesRevealedVoteProperly()
                                itConsidersTheVoterWinner(voter)
                                itConsidersTheVoterLoser(anotherVoter)
                                itComputesNewWinningOutcome(outcome)
                              })

                              context('when the other vote was revealed', () => {
                                beforeEach('reveal vote', async () => {
                                  await voting.reveal(votingId, anotherOutcome, SALT, { from: anotherVoter })
                                })

                                itHandlesRevealedVoteProperly()
                                itConsidersTheVoterWinner(voter)
                                itConsidersTheVoterLoser(anotherVoter)
                                itComputesNewWinningOutcome(outcome)
                              })
                            })

                            context('when the other voter has a higher weight', () => {
                              const anotherWeight = weight + 1

                              beforeEach('commit another vote', async () => {
                                await votingOwner.mockVoterWeight(anotherVoter, anotherWeight)
                                await voting.commit(votingId, anotherCommitment, { from: anotherVoter })
                              })

                              context('when the other vote was not revealed yet', () => {
                                itHandlesRevealedVoteProperly()
                                itConsidersTheVoterWinner(voter)
                                itConsidersTheVoterLoser(anotherVoter)
                                itComputesNewWinningOutcome(outcome)
                              })

                              context('when the other vote was leaked', () => {
                                beforeEach('leak vote', async () => {
                                  await voting.leak(votingId, anotherVoter, anotherOutcome, SALT, { from: voter })
                                })

                                itHandlesRevealedVoteProperly()
                                itConsidersTheVoterWinner(voter)
                                itConsidersTheVoterLoser(anotherVoter)
                                itComputesNewWinningOutcome(outcome)
                              })

                              context('when the other vote was revealed', () => {
                                beforeEach('reveal vote', async () => {
                                  await voting.reveal(votingId, anotherOutcome, SALT, { from: anotherVoter })
                                })

                                itHandlesRevealedVoteProperly()
                                itConsidersTheVoterWinner(anotherVoter)
                                itConsidersTheVoterLoser(voter)
                                itDoesNotChangeTheWinningOutcome()
                              })
                            })
                          })

                          context('when the other vote was the same outcome', () => {
                            const anotherOutcome = OUTCOMES.LOW
                            const anotherCommitment = encryptVote(anotherOutcome)

                            const itHandlesSameRevealedVotesProperly = () => {
                              context('when the other vote was not revealed yet', () => {
                                itHandlesRevealedVoteProperly()
                                itConsidersTheVoterWinner(voter)
                                itConsidersTheVoterLoser(anotherVoter)
                                itComputesNewWinningOutcome(outcome)
                              })

                              context('when the other vote was leaked', () => {
                                beforeEach('leak vote', async () => {
                                  await voting.leak(votingId, anotherVoter, anotherOutcome, SALT, { from: voter })
                                })

                                itHandlesRevealedVoteProperly()
                                itConsidersTheVoterWinner(voter)
                                itConsidersTheVoterLoser(anotherVoter)
                                itComputesNewWinningOutcome(outcome)
                              })

                              context('when the other vote was revealed', () => {
                                beforeEach('reveal vote', async () => {
                                  await voting.reveal(votingId, anotherOutcome, SALT, { from: anotherVoter })
                                })

                                itHandlesRevealedVoteProperly()
                                itConsidersTheVoterWinner(voter)
                                itConsidersTheVoterWinner(anotherVoter)
                                itDoesNotChangeTheWinningOutcome(weight)
                              })
                            }

                            context('when the voter has a lower weight', () => {
                              const anotherWeight = weight - 1

                              beforeEach('commit another vote', async () => {
                                await votingOwner.mockVoterWeight(anotherVoter, anotherWeight)
                                await voting.commit(votingId, anotherCommitment, { from: anotherVoter })
                              })

                              itHandlesSameRevealedVotesProperly()
                            })

                            context('when the voter has the same weight', () => {
                              const anotherWeight = weight

                              beforeEach('commit another vote', async () => {
                                await votingOwner.mockVoterWeight(anotherVoter, anotherWeight)
                                await voting.commit(votingId, anotherCommitment, { from: anotherVoter })
                              })

                              itHandlesSameRevealedVotesProperly()
                            })

                            context('when the voter has a higher weight', () => {
                              const anotherWeight = weight + 1

                              beforeEach('commit another vote', async () => {
                                await votingOwner.mockVoterWeight(anotherVoter, anotherWeight)
                                await voting.commit(votingId, anotherCommitment, { from: anotherVoter })
                              })

                              itHandlesSameRevealedVotesProperly()
                            })
                          })
                        })

                        context('when the other vote was an invalid outcome', () => {
                          const anotherOutcome = OUTCOMES.REFUSED
                          const anotherCommitment = encryptVote(anotherOutcome)

                          beforeEach('commit vote', async () => {
                            const anotherWeight = 10
                            await votingOwner.mockVoterWeight(anotherVoter, anotherWeight)
                            await voting.commit(votingId, anotherCommitment, { from: anotherVoter })
                          })

                          context('when the other vote was not revealed yet', () => {
                            itHandlesRevealedVoteProperly()
                            itConsidersTheVoterWinner(voter)
                            itConsidersTheVoterLoser(anotherVoter)
                            itComputesNewWinningOutcome(outcome)
                          })

                          context('when the other vote was leaked', () => {
                            beforeEach('leak vote', async () => {
                              await voting.leak(votingId, anotherVoter, anotherOutcome, SALT, { from: voter })
                            })

                            itHandlesRevealedVoteProperly()
                            itConsidersTheVoterWinner(voter)
                            itConsidersTheVoterLoser(anotherVoter)
                            itComputesNewWinningOutcome(outcome)
                          })

                          context('when the other vote was revealed', () => {
                            beforeEach('reveal vote', async () => {
                              await voting.reveal(votingId, anotherOutcome, SALT, { from: anotherVoter })
                            })

                            itHandlesRevealedVoteProperly()
                            itConsidersTheVoterWinner(voter)
                            itDoesNotConsiderVoterWinnerNorLoser(anotherVoter)
                            itComputesNewWinningOutcome(outcome)
                          })
                        })
                      })
                    } else {
                      context('when there were no other votes yet', () => {
                        itHandlesRevealedVoteProperly()
                        itDoesNotConsiderVoterWinnerNorLoser(voter)
                        itDoesNotChangeTheWinningOutcome()
                      })

                      context('when there was another vote', () => {
                        context('when the other vote was a valid outcome', () => {
                          const anotherOutcome = OUTCOMES.HIGH
                          const anotherCommitment = encryptVote(anotherOutcome)

                          beforeEach('commit another vote', async () => {
                            const anotherWeight = 10
                            await votingOwner.mockVoterWeight(anotherVoter, anotherWeight)
                            await voting.commit(votingId, anotherCommitment, { from: anotherVoter })
                          })

                          context('when the other vote was not revealed yet', () => {
                            itHandlesRevealedVoteProperly()
                            itDoesNotConsiderVoterWinnerNorLoser(voter)
                            itDoesNotConsiderVoterWinnerNorLoser(anotherVoter)
                            itDoesNotChangeTheWinningOutcome()
                          })

                          context('when the other vote was leaked', () => {
                            beforeEach('leak vote', async () => {
                              await voting.leak(votingId, anotherVoter, anotherOutcome, SALT, { from: voter })
                            })

                            itHandlesRevealedVoteProperly()
                            itDoesNotConsiderVoterWinnerNorLoser(voter)
                            itDoesNotConsiderVoterWinnerNorLoser(anotherVoter)
                            itDoesNotChangeTheWinningOutcome()
                          })

                          context('when the other vote was revealed', () => {
                            beforeEach('reveal vote', async () => {
                              await voting.reveal(votingId, anotherOutcome, SALT, { from: anotherVoter })
                            })

                            itHandlesRevealedVoteProperly()
                            itDoesNotConsiderVoterWinnerNorLoser(voter)
                            itConsidersTheVoterWinner(anotherVoter)
                            itDoesNotChangeTheWinningOutcome()
                          })
                        })

                        context('when the other vote was an invalid outcome', () => {
                          const anotherOutcome = OUTCOMES.REFUSED
                          const anotherCommitment = encryptVote(anotherOutcome)

                          beforeEach('commit vote', async () => {
                            const anotherWeight = 10
                            await votingOwner.mockVoterWeight(anotherVoter, anotherWeight)
                            await voting.commit(votingId, anotherCommitment, { from: anotherVoter })
                          })

                          context('when the other vote was not revealed yet', () => {
                            itHandlesRevealedVoteProperly()
                            itDoesNotConsiderVoterWinnerNorLoser(voter)
                            itDoesNotConsiderVoterWinnerNorLoser(anotherVoter)
                            itDoesNotChangeTheWinningOutcome()
                          })

                          context('when the other vote was leaked', () => {
                            beforeEach('leak vote', async () => {
                              await voting.leak(votingId, anotherVoter, anotherOutcome, SALT, { from: voter })
                            })

                            itHandlesRevealedVoteProperly()
                            itDoesNotConsiderVoterWinnerNorLoser(voter)
                            itDoesNotConsiderVoterWinnerNorLoser(anotherVoter)
                            itDoesNotChangeTheWinningOutcome()
                          })

                          context('when the other vote was revealed', () => {
                            beforeEach('reveal vote', async () => {
                              await voting.reveal(votingId, anotherOutcome, SALT, { from: anotherVoter })
                            })

                            itHandlesRevealedVoteProperly()
                            itDoesNotConsiderVoterWinnerNorLoser(voter)
                            itDoesNotConsiderVoterWinnerNorLoser(anotherVoter)
                            itDoesNotChangeTheWinningOutcome()
                          })
                        })
                      })
                    }
                  })

                  context('when the given salt does not match the one used', () => {
                    const salt = '0x'

                    it('reverts', async () => {
                      await assertRevert(voting.reveal(votingId, outcome, salt, { from: voter }), 'CRV_INVALID_COMMITMENT_SALT')
                    })
                  })
                })

                context('when the given outcome does not match the one committed', () => {
                  const outcome = committedOutcome + 1

                  context('when the given salt matches the one used', () => {
                    const salt = SALT

                    it('reverts', async () => {
                      await assertRevert(voting.reveal(votingId, outcome, salt, { from: voter }), 'CRV_INVALID_COMMITMENT_SALT')
                    })
                  })

                  context('when the given salt does not match the one used', () => {
                    const salt = '0x'

                    it('reverts', async () => {
                      await assertRevert(voting.reveal(votingId, outcome, salt, { from: voter }), 'CRV_INVALID_COMMITMENT_SALT')
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
                  await assertRevert(voting.reveal(votingId, OUTCOMES.LOW, SALT, { from: voter }), 'CRV_REVEAL_DENIED_BY_OWNER')
                })
              })
            })

            context('when the owner reverts when checking the weight of the voter', () => {
              beforeEach('mock the owner to revert', async () => {
                await votingOwner.mockChecksFailing(true)
              })

              it('reverts', async () => {
                await assertRevert(voting.reveal(votingId, committedOutcome, SALT, { from: voter }), 'CRV_OWNER_MOCK_REVEAL_CHECK_REVERTED')
              })
            })
          }

          const itHandlesInvalidRevealedVotesFor = committedOutcome => {
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

                    it('reverts', async () => {
                      await assertRevert(voting.reveal(votingId, outcome, salt, { from: voter }), 'CRV_INVALID_OUTCOME')
                    })
                  })

                  context('when the given salt does not match the one used by the voter', () => {
                    const salt = '0x'

                    it('reverts', async () => {
                      await assertRevert(voting.reveal(votingId, outcome, salt, { from: voter }), 'CRV_INVALID_COMMITMENT_SALT')
                    })
                  })
                })

                context('when the given outcome does not match the one committed by the voter', () => {
                  const outcome = committedOutcome + 1

                  context('when the given salt matches the one used by the voter', () => {
                    const salt = SALT

                    it('reverts', async () => {
                      await assertRevert(voting.reveal(votingId, outcome, salt, { from: voter }), 'CRV_INVALID_COMMITMENT_SALT')
                    })
                  })

                  context('when the given salt does not match the one used by the voter', () => {
                    const salt = '0x'

                    it('reverts', async () => {
                      await assertRevert(voting.reveal(votingId, outcome, salt, { from: voter }), 'CRV_INVALID_COMMITMENT_SALT')
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
                  await assertRevert(voting.reveal(votingId, OUTCOMES.LOW, SALT, { from: voter }), 'CRV_REVEAL_DENIED_BY_OWNER')
                })
              })
            })

            context('when the owner reverts when checking the weight of the voter', () => {
              beforeEach('mock the owner to revert', async () => {
                await votingOwner.mockChecksFailing(true)
              })

              it('reverts', async () => {
                await assertRevert(voting.reveal(votingId, committedOutcome, SALT, { from: voter }), 'CRV_OWNER_MOCK_REVEAL_CHECK_REVERTED')
              })
            })
          }

          context('when the given voter committed a missing outcome', async () => {
            itHandlesInvalidRevealedVotesFor(OUTCOMES.MISSING)
          })

          context('when the given voter committed a leaked outcome', async () => {
            itHandlesInvalidRevealedVotesFor(OUTCOMES.LEAKED)
          })

          context('when the given voter committed a refused outcome', async () => {
            itHandlesValidRevealedVotesFor(OUTCOMES.REFUSED)
          })

          context('when the given voter committed a valid outcome', async () => {
            itHandlesValidRevealedVotesFor(OUTCOMES.LOW)
          })

          context('when the given voter committed an out-of-bounds outcome', async () => {
            itHandlesInvalidRevealedVotesFor(OUTCOMES.HIGH + 1)
          })
        })
      })

      context('when the given voting ID is not valid', () => {
        it('reverts', async () => {
          await assertRevert(voting.reveal(0, 0, '0x', { from: voter }), 'CRV_VOTING_DOES_NOT_EXIST')
        })
      })

      context('when the registry is not initialized', () => {
        it('reverts', async () => {
          await assertRevert(voting.reveal(0, 0, '0x', { from: voter }), 'CRV_VOTING_DOES_NOT_EXIST')
        })
      })
    })
  })
})
