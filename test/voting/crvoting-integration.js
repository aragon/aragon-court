const { assertBn } = require('../helpers/asserts/assertBn')
const { buildHelper } = require('../helpers/wrappers/controller')(web3, artifacts)
const { SALT, OUTCOMES, encryptVote } = require('../helpers/utils/crvoting')

const CRVoting = artifacts.require('CRVoting')
const Court = artifacts.require('CourtMockForVoting')

const POSSIBLE_OUTCOMES = 2

contract('CRVoting', ([_, voterWeighted1, voterWeighted2, voterWeighted3, voterWeighted10, voterWeighted12, voterWeighted13, someone]) => {
  let controller, voting, court, voteId = 0

  beforeEach('create voting', async () => {
    controller = await buildHelper().deploy()

    voting = await CRVoting.new(controller.address)
    await controller.setVoting(voting.address)

    court = await Court.new(controller.address)
    await controller.setCourt(court.address)
    await court.create(voteId, POSSIBLE_OUTCOMES)
  })

  const submitVotes = async votes => {
    for (const voter in votes) {
      const { weight, outcome, reveal, leak } = votes[voter]
      await court.mockVoterWeight(voter, weight)
      if (outcome) await voting.commit(voteId, encryptVote(outcome), { from: voter })
      if (reveal) await voting.reveal(voteId, outcome, SALT, { from: voter })
      if (leak) await voting.leak(voteId, voter, outcome, SALT, { from: someone })
    }
  }

  const itConsidersVotersAsWinners = (votes, expectedWinners) => {
    it('marks voters as winners', async () => {
      await submitVotes(votes)
      const winningOutcome = await voting.getWinningOutcome(voteId)

      for (const voter of expectedWinners) {
        assert.isTrue(await voting.hasVotedInFavorOf(voteId, winningOutcome, voter), `voter with weight ${votes[voter].weight} should be considered a winner`)
      }
    })
  }

  const itConsidersVotersAsLosers = (votes, expectedLosers) => {
    it('marks voters as losers', async () => {
      await submitVotes(votes)
      const winningOutcome = await voting.getWinningOutcome(voteId)

      for (const voter of expectedLosers) {
        assert.isFalse(await voting.hasVotedInFavorOf(voteId, winningOutcome, voter), `voter with weight ${votes[voter].weight} should be considered a loser`)
      }
    })
  }

  const itSetsAWinningOutcome = (votes, expectedTallies, expectedWinningOutcome) => {
    it('computes the new winning outcome', async () => {
      await submitVotes(votes)

      const missingOutcomeTally = await voting.getOutcomeTally(voteId, OUTCOMES.MISSING)
      assertBn(missingOutcomeTally, 0, 'missing outcome should be zero')

      const leakedOutcomeTally = await voting.getOutcomeTally(voteId, OUTCOMES.LEAKED)
      assertBn(leakedOutcomeTally, 0, 'leaked outcome should be zero')

      const lowOutcomeTally = await voting.getOutcomeTally(voteId, OUTCOMES.LOW)
      assertBn(lowOutcomeTally, expectedTallies[OUTCOMES.LOW], 'low outcome tallies do not match')

      const highOutcomeTally = await voting.getOutcomeTally(voteId, OUTCOMES.HIGH)
      assertBn(highOutcomeTally, expectedTallies[OUTCOMES.HIGH], 'high outcome tallies do not match')

      const refusedOutcomeTally = await voting.getOutcomeTally(voteId, OUTCOMES.REFUSED)
      assertBn(refusedOutcomeTally, expectedTallies[OUTCOMES.REFUSED], 'refused tallies do not match')

      const winningOutcome = await voting.getWinningOutcome(voteId)
      assertBn(winningOutcome, expectedWinningOutcome, 'winning outcome does not match')

      const winningOutcomeTally = await voting.getOutcomeTally(voteId, winningOutcome)
      assertBn(winningOutcomeTally, expectedTallies[expectedWinningOutcome], 'winning outcome tally does not match')
    })
  }

  const itDoesNotSetAWinningOutcome = (votes) => {
    it('does not set a winning outcome', async () => {
      await submitVotes(votes)

      const missingOutcomeTally = await voting.getOutcomeTally(voteId, OUTCOMES.MISSING)
      assertBn(missingOutcomeTally, 0, 'missing outcome should be zero')

      const leakedOutcomeTally = await voting.getOutcomeTally(voteId, OUTCOMES.LEAKED)
      assertBn(leakedOutcomeTally, 0, 'leaked outcome should be zero')

      const currentLowOutcomeTally = await voting.getOutcomeTally(voteId, OUTCOMES.LOW)
      assertBn(currentLowOutcomeTally, 0, 'low outcome tallies do not match')

      const currentHighOutcomeTally = await voting.getOutcomeTally(voteId, OUTCOMES.HIGH)
      assertBn(currentHighOutcomeTally, 0, 'high outcome tallies do not match')

      const currentRefusedOutcomeTally = await voting.getOutcomeTally(voteId, OUTCOMES.REFUSED)
      assertBn(currentRefusedOutcomeTally, 0, 'refused tallies do not match')

      const winningOutcome = await voting.getWinningOutcome(voteId)
      assertBn(winningOutcome, OUTCOMES.REFUSED, 'refused should be the winning outcome')

      const winningOutcomeTally = await voting.getOutcomeTally(voteId, winningOutcome)
      assertBn(winningOutcomeTally, 0, 'winning outcome tally should be zero')
    })
  }

  describe('integration', () => {
    context('when none of the voters committed a vote', () => {
      const votes = {
        [voterWeighted1]:  { weight: 1,  outcome: undefined },
        [voterWeighted2]:  { weight: 2,  outcome: undefined },
        [voterWeighted3]:  { weight: 3,  outcome: undefined },
        [voterWeighted10]: { weight: 10, outcome: undefined },
        [voterWeighted12]: { weight: 12, outcome: undefined },
        [voterWeighted13]: { weight: 13, outcome: undefined }
      }

      itDoesNotSetAWinningOutcome(votes)
      itConsidersVotersAsLosers(votes, Object.keys(votes))
    })

    context('when only one voter committed a vote but no one revealed', () => {
      const votes = {
        [voterWeighted1]:  { weight: 1,  outcome: undefined },
        [voterWeighted2]:  { weight: 2,  outcome: undefined },
        [voterWeighted3]:  { weight: 3,  outcome: undefined },
        [voterWeighted10]: { weight: 10, outcome: undefined },
        [voterWeighted12]: { weight: 12, outcome: undefined },
        [voterWeighted13]: { weight: 13, outcome: OUTCOMES.LOW }
      }

      itDoesNotSetAWinningOutcome(votes)
      itConsidersVotersAsLosers(votes, Object.keys(votes))
    })

    context('when most of the voters committed a vote but no one revealed', () => {
      const votes = {
        [voterWeighted1]:  { weight: 1,  outcome: undefined },
        [voterWeighted2]:  { weight: 2,  outcome: undefined },
        [voterWeighted3]:  { weight: 3,  outcome: OUTCOMES.LOW },
        [voterWeighted10]: { weight: 10, outcome: OUTCOMES.HIGH },
        [voterWeighted12]: { weight: 12, outcome: OUTCOMES.HIGH },
        [voterWeighted13]: { weight: 13, outcome: OUTCOMES.REFUSED }
      }

      itDoesNotSetAWinningOutcome(votes)
      itConsidersVotersAsLosers(votes, Object.keys(votes))
    })

    context('when only one voter committed a vote but was leaked', () => {
      const votes = {
        [voterWeighted1]:  { weight: 1,  outcome: undefined },
        [voterWeighted2]:  { weight: 2,  outcome: undefined },
        [voterWeighted3]:  { weight: 3,  outcome: undefined },
        [voterWeighted10]: { weight: 10, outcome: undefined },
        [voterWeighted12]: { weight: 12, outcome: undefined },
        [voterWeighted13]: { weight: 13, outcome: OUTCOMES.LOW, leak: true }
      }

      itDoesNotSetAWinningOutcome(votes)
      itConsidersVotersAsLosers(votes, Object.keys(votes))
    })

    context('when most of the voters committed a vote but were leaked', () => {
      const votes = {
        [voterWeighted1]:  { weight: 1,  outcome: undefined },
        [voterWeighted2]:  { weight: 2,  outcome: undefined },
        [voterWeighted3]:  { weight: 3,  outcome: OUTCOMES.LOW,     leak: true },
        [voterWeighted10]: { weight: 10, outcome: OUTCOMES.HIGH,    leak: true },
        [voterWeighted12]: { weight: 12, outcome: OUTCOMES.HIGH,    leak: true },
        [voterWeighted13]: { weight: 13, outcome: OUTCOMES.REFUSED, leak: true }
      }

      itDoesNotSetAWinningOutcome(votes)
      itConsidersVotersAsLosers(votes, Object.keys(votes))
    })

    context('when only one voter committed and revealed a vote', () => {
      const votes = {
        [voterWeighted1]:  { weight: 1,  outcome: undefined },
        [voterWeighted2]:  { weight: 2,  outcome: undefined },
        [voterWeighted3]:  { weight: 3,  outcome: undefined },
        [voterWeighted10]: { weight: 10, outcome: undefined },
        [voterWeighted12]: { weight: 12, outcome: undefined },
        [voterWeighted13]: { weight: 13, outcome: OUTCOMES.LOW, reveal: true }
      }

      const expectedTallies = { [OUTCOMES.LOW]: 13, [OUTCOMES.HIGH]: 0, [OUTCOMES.REFUSED]: 0 }
      const expectedWinningOutcome = OUTCOMES.LOW
      itSetsAWinningOutcome(votes, expectedTallies, expectedWinningOutcome)

      const expectedWinners = [voterWeighted13]
      itConsidersVotersAsWinners(votes, expectedWinners)

      const expectedLosers = [voterWeighted1, voterWeighted2, voterWeighted3, voterWeighted10, voterWeighted12]
      itConsidersVotersAsLosers(votes, expectedLosers)
    })

    context('when many voters committed and revealed their votes', () => {
      context('when an outcome gets more support than other', () => {
        context('when the low outcome is the most supported, then the high outcome, and finally the refused', () => {
          const votes = {
            [voterWeighted1]:  { weight: 1,  outcome: undefined },
            [voterWeighted2]:  { weight: 2,  outcome: OUTCOMES.LOW },
            [voterWeighted3]:  { weight: 3,  outcome: OUTCOMES.REFUSED, reveal: true },
            [voterWeighted10]: { weight: 10, outcome: OUTCOMES.HIGH,    reveal: true },
            [voterWeighted12]: { weight: 12, outcome: undefined },
            [voterWeighted13]: { weight: 13, outcome: OUTCOMES.LOW,     reveal: true }
          }

          const expectedTallies = { [OUTCOMES.LOW]: 13, [OUTCOMES.HIGH]: 10, [OUTCOMES.REFUSED]: 3 }
          const expectedWinningOutcome = OUTCOMES.LOW
          itSetsAWinningOutcome(votes, expectedTallies, expectedWinningOutcome)

          const expectedWinners = [voterWeighted13]
          itConsidersVotersAsWinners(votes, expectedWinners)

          const expectedLosers = [voterWeighted1, voterWeighted2, voterWeighted3, voterWeighted10, voterWeighted12]
          itConsidersVotersAsLosers(votes, expectedLosers)
        })

        context('when the high outcome is the most supported and there is a tie between the low and the refused outcomes', () => {
          const votes = {
            [voterWeighted1]:  { weight: 1,  outcome: OUTCOMES.LOW,     reveal: true },
            [voterWeighted2]:  { weight: 2,  outcome: OUTCOMES.LOW,     reveal: true },
            [voterWeighted3]:  { weight: 3,  outcome: OUTCOMES.REFUSED, reveal: true },
            [voterWeighted10]: { weight: 10, outcome: OUTCOMES.HIGH,    leaked: true },
            [voterWeighted12]: { weight: 12, outcome: undefined },
            [voterWeighted13]: { weight: 13, outcome: OUTCOMES.HIGH,    reveal: true }
          }

          const expectedTallies = { [OUTCOMES.LOW]: 3, [OUTCOMES.HIGH]: 13, [OUTCOMES.REFUSED]: 3 }
          const expectedWinningOutcome = OUTCOMES.HIGH
          itSetsAWinningOutcome(votes, expectedTallies, expectedWinningOutcome)

          const expectedWinners = [voterWeighted13]
          itConsidersVotersAsWinners(votes, expectedWinners)

          const expectedLosers = [voterWeighted1, voterWeighted2, voterWeighted10, voterWeighted12]
          itConsidersVotersAsLosers(votes, expectedLosers)
        })

        context('when the high outcome is the most supported, then the refused outcome, and finally the low', () => {
          const votes = {
            [voterWeighted1]:  { weight: 1,  outcome: OUTCOMES.HIGH,    reveal: true },
            [voterWeighted2]:  { weight: 2,  outcome: OUTCOMES.HIGH,    reveal: true },
            [voterWeighted3]:  { weight: 3,  outcome: OUTCOMES.HIGH,    reveal: true },
            [voterWeighted10]: { weight: 10, outcome: OUTCOMES.HIGH,    reveal: true },
            [voterWeighted12]: { weight: 12, outcome: OUTCOMES.REFUSED, reveal: true },
            [voterWeighted13]: { weight: 13, outcome: OUTCOMES.LOW,     leaked: true }
          }

          const expectedTallies = { [OUTCOMES.LOW]: 0, [OUTCOMES.HIGH]: 16, [OUTCOMES.REFUSED]: 12 }
          const expectedWinningOutcome = OUTCOMES.HIGH
          itSetsAWinningOutcome(votes, expectedTallies, expectedWinningOutcome)

          const expectedWinners = [voterWeighted1, voterWeighted2, voterWeighted3, voterWeighted10]
          itConsidersVotersAsWinners(votes, expectedWinners)

          const expectedLosers = [voterWeighted12, voterWeighted13]
          itConsidersVotersAsLosers(votes, expectedLosers)
        })

        context('when the refused outcome is the most supported, then the low outcome, and finally the high', () => {
          const votes = {
            [voterWeighted1]:  { weight: 1,  outcome: OUTCOMES.HIGH,    reveal: true },
            [voterWeighted2]:  { weight: 2,  outcome: OUTCOMES.LOW,     reveal: true },
            [voterWeighted3]:  { weight: 3,  outcome: OUTCOMES.REFUSED, reveal: true },
            [voterWeighted10]: { weight: 10, outcome: OUTCOMES.HIGH,    leaked: true },
            [voterWeighted12]: { weight: 12, outcome: OUTCOMES.REFUSED, leaked: true },
            [voterWeighted13]: { weight: 13, outcome: undefined }
          }

          const expectedTallies = { [OUTCOMES.LOW]: 2, [OUTCOMES.HIGH]: 1, [OUTCOMES.REFUSED]: 3 }
          const expectedWinningOutcome = OUTCOMES.REFUSED
          itSetsAWinningOutcome(votes, expectedTallies, expectedWinningOutcome)

          const expectedWinners = [voterWeighted3]
          itConsidersVotersAsWinners(votes, expectedWinners)

          const expectedLosers = [voterWeighted1, voterWeighted2, voterWeighted10, voterWeighted12, voterWeighted13]
          itConsidersVotersAsLosers(votes, expectedLosers)
        })
      })

      context('when there is tie', () => {
        context('between the low and the high outcomes', () => {
          context('when votes are casted in weight-ascending order', () => {
            const votes = {
              [voterWeighted1]:  { weight: 1,  outcome: OUTCOMES.LOW,     reveal: true },
              [voterWeighted2]:  { weight: 2,  outcome: OUTCOMES.HIGH,    reveal: true },
              [voterWeighted3]:  { weight: 3,  outcome: undefined },
              [voterWeighted10]: { weight: 10, outcome: OUTCOMES.REFUSED, reveal: true },
              [voterWeighted12]: { weight: 12, outcome: OUTCOMES.HIGH,    reveal: true },
              [voterWeighted13]: { weight: 13, outcome: OUTCOMES.LOW,     reveal: true }
            }

            const expectedTallies = { [OUTCOMES.LOW]: 14, [OUTCOMES.HIGH]: 14, [OUTCOMES.REFUSED]: 10 }
            const expectedWinningOutcome = OUTCOMES.LOW
            itSetsAWinningOutcome(votes, expectedTallies, expectedWinningOutcome)

            const expectedWinners = [voterWeighted1, voterWeighted13]
            itConsidersVotersAsWinners(votes, expectedWinners)

            const expectedLosers = [voterWeighted2, voterWeighted3, voterWeighted10, voterWeighted12]
            itConsidersVotersAsLosers(votes, expectedLosers)
          })

          context('when votes are casted in weight-descending order', () => {
            const votes = {
              [voterWeighted13]: { weight: 13, outcome: OUTCOMES.LOW,     reveal: true },
              [voterWeighted12]: { weight: 12, outcome: OUTCOMES.HIGH,    reveal: true },
              [voterWeighted10]: { weight: 10, outcome: OUTCOMES.REFUSED, reveal: true },
              [voterWeighted3]:  { weight: 3,  outcome: undefined },
              [voterWeighted2]:  { weight: 2,  outcome: OUTCOMES.HIGH,    reveal: true },
              [voterWeighted1]:  { weight: 1,  outcome: OUTCOMES.LOW,     reveal: true }
            }

            const expectedTallies = { [OUTCOMES.LOW]: 14, [OUTCOMES.HIGH]: 14, [OUTCOMES.REFUSED]: 10 }
            const expectedWinningOutcome = OUTCOMES.LOW
            itSetsAWinningOutcome(votes, expectedTallies, expectedWinningOutcome)

            const expectedWinners = [voterWeighted1, voterWeighted13]
            itConsidersVotersAsWinners(votes, expectedWinners)

            const expectedLosers = [voterWeighted2, voterWeighted3, voterWeighted10, voterWeighted12]
            itConsidersVotersAsLosers(votes, expectedLosers)
          })

          context('when votes are casted unordered', () => {
            const votes = {
              [voterWeighted13]: { weight: 13, outcome: OUTCOMES.LOW,     reveal: true },
              [voterWeighted2]:  { weight: 2,  outcome: OUTCOMES.HIGH,    reveal: true },
              [voterWeighted10]: { weight: 10, outcome: OUTCOMES.REFUSED, reveal: true },
              [voterWeighted1]:  { weight: 1,  outcome: OUTCOMES.LOW,     reveal: true },
              [voterWeighted12]: { weight: 12, outcome: OUTCOMES.HIGH,    reveal: true },
              [voterWeighted3]:  { weight: 3,  outcome: undefined }
            }

            const expectedTallies = { [OUTCOMES.LOW]: 14, [OUTCOMES.HIGH]: 14, [OUTCOMES.REFUSED]: 10 }
            const expectedWinningOutcome = OUTCOMES.LOW
            itSetsAWinningOutcome(votes, expectedTallies, expectedWinningOutcome)

            const expectedWinners = [voterWeighted1, voterWeighted13]
            itConsidersVotersAsWinners(votes, expectedWinners)

            const expectedLosers = [voterWeighted2, voterWeighted3, voterWeighted10, voterWeighted12]
            itConsidersVotersAsLosers(votes, expectedLosers)
          })
        })

        context('between the refused and the low outcomes', () => {
          context('when votes are casted in weight-ascending order', () => {
            const votes = {
              [voterWeighted1]:  { weight: 1,  outcome: undefined },
              [voterWeighted2]:  { weight: 2,  outcome: OUTCOMES.REFUSED, reveal: true },
              [voterWeighted3]:  { weight: 3,  outcome: undefined },
              [voterWeighted10]: { weight: 10, outcome: OUTCOMES.REFUSED, reveal: true },
              [voterWeighted12]: { weight: 12, outcome: OUTCOMES.LOW,     reveal: true },
              [voterWeighted13]: { weight: 13, outcome: OUTCOMES.HIGH,    leaked: true }
            }

            const expectedTallies = { [OUTCOMES.LOW]: 12, [OUTCOMES.HIGH]: 0, [OUTCOMES.REFUSED]: 12 }
            const expectedWinningOutcome = OUTCOMES.REFUSED
            itSetsAWinningOutcome(votes, expectedTallies, expectedWinningOutcome)

            const expectedWinners = [voterWeighted2, voterWeighted10]
            itConsidersVotersAsWinners(votes, expectedWinners)

            const expectedLosers = [voterWeighted1, voterWeighted3, voterWeighted12, voterWeighted13]
            itConsidersVotersAsLosers(votes, expectedLosers)
          })

          context('when votes are casted in weight-descending order', () => {
            const votes = {
              [voterWeighted13]: { weight: 13, outcome: OUTCOMES.HIGH,    leaked: true },
              [voterWeighted12]: { weight: 12, outcome: OUTCOMES.LOW,     reveal: true },
              [voterWeighted10]: { weight: 10, outcome: OUTCOMES.REFUSED, reveal: true },
              [voterWeighted3]:  { weight: 3,  outcome: undefined },
              [voterWeighted2]:  { weight: 2,  outcome: OUTCOMES.REFUSED, reveal: true },
              [voterWeighted1]:  { weight: 1,  outcome: undefined }
            }

            const expectedTallies = { [OUTCOMES.LOW]: 12, [OUTCOMES.HIGH]: 0, [OUTCOMES.REFUSED]: 12 }
            const expectedWinningOutcome = OUTCOMES.REFUSED
            itSetsAWinningOutcome(votes, expectedTallies, expectedWinningOutcome)

            const expectedWinners = [voterWeighted2, voterWeighted10]
            itConsidersVotersAsWinners(votes, expectedWinners)

            const expectedLosers = [voterWeighted1, voterWeighted3, voterWeighted12, voterWeighted13]
            itConsidersVotersAsLosers(votes, expectedLosers)
          })

          context('when votes are casted unordered', () => {
            const votes = {
              [voterWeighted3]:  { weight: 3,  outcome: undefined },
              [voterWeighted12]: { weight: 12, outcome: OUTCOMES.LOW,     reveal: true },
              [voterWeighted13]: { weight: 13, outcome: OUTCOMES.HIGH,    leaked: true },
              [voterWeighted2]:  { weight: 2,  outcome: OUTCOMES.REFUSED, reveal: true },
              [voterWeighted10]: { weight: 10, outcome: OUTCOMES.REFUSED, reveal: true },
              [voterWeighted1]:  { weight: 1,  outcome: undefined }
            }

            const expectedTallies = { [OUTCOMES.LOW]: 12, [OUTCOMES.HIGH]: 0, [OUTCOMES.REFUSED]: 12 }
            const expectedWinningOutcome = OUTCOMES.REFUSED
            itSetsAWinningOutcome(votes, expectedTallies, expectedWinningOutcome)

            const expectedWinners = [voterWeighted2, voterWeighted10]
            itConsidersVotersAsWinners(votes, expectedWinners)

            const expectedLosers = [voterWeighted1, voterWeighted3, voterWeighted12, voterWeighted13]
            itConsidersVotersAsLosers(votes, expectedLosers)
          })
        })

        context('between the refused and the high outcomes', () => {
          context('when votes are casted in weight-ascending order', () => {
            const votes = {
              [voterWeighted1]:  { weight: 1,  outcome: undefined },
              [voterWeighted2]:  { weight: 2,  outcome: OUTCOMES.HIGH,    reveal: true },
              [voterWeighted3]:  { weight: 3,  outcome: undefined },
              [voterWeighted10]: { weight: 10, outcome: OUTCOMES.HIGH,    reveal: true },
              [voterWeighted12]: { weight: 12, outcome: OUTCOMES.REFUSED, reveal: true },
              [voterWeighted13]: { weight: 13, outcome: OUTCOMES.HIGH,    leaked: true }
            }

            const expectedTallies = { [OUTCOMES.LOW]: 0, [OUTCOMES.HIGH]: 12, [OUTCOMES.REFUSED]: 12 }
            const expectedWinningOutcome = OUTCOMES.REFUSED
            itSetsAWinningOutcome(votes, expectedTallies, expectedWinningOutcome)

            const expectedWinners = [voterWeighted12]
            itConsidersVotersAsWinners(votes, expectedWinners)

            const expectedLosers = [voterWeighted1, voterWeighted2, voterWeighted3, voterWeighted10, voterWeighted13]
            itConsidersVotersAsLosers(votes, expectedLosers)
          })

          context('when votes are casted in weight-descending order', () => {
            const votes = {
              [voterWeighted13]: { weight: 13, outcome: OUTCOMES.HIGH,    leaked: true },
              [voterWeighted12]: { weight: 12, outcome: OUTCOMES.REFUSED, reveal: true },
              [voterWeighted10]: { weight: 10, outcome: OUTCOMES.HIGH,    reveal: true },
              [voterWeighted3]:  { weight: 3,  outcome: undefined },
              [voterWeighted2]:  { weight: 2,  outcome: OUTCOMES.HIGH,    reveal: true },
              [voterWeighted1]:  { weight: 1,  outcome: undefined }
            }

            const expectedTallies = { [OUTCOMES.LOW]: 0, [OUTCOMES.HIGH]: 12, [OUTCOMES.REFUSED]: 12 }
            const expectedWinningOutcome = OUTCOMES.REFUSED
            itSetsAWinningOutcome(votes, expectedTallies, expectedWinningOutcome)

            const expectedWinners = [voterWeighted12]
            itConsidersVotersAsWinners(votes, expectedWinners)

            const expectedLosers = [voterWeighted1, voterWeighted2, voterWeighted3, voterWeighted10, voterWeighted13]
            itConsidersVotersAsLosers(votes, expectedLosers)
          })

          context('when votes are casted unordered', () => {
            const votes = {
              [voterWeighted12]: { weight: 12, outcome: OUTCOMES.REFUSED, reveal: true },
              [voterWeighted3]:  { weight: 3,  outcome: undefined },
              [voterWeighted1]:  { weight: 1,  outcome: undefined },
              [voterWeighted13]: { weight: 13, outcome: OUTCOMES.HIGH,    leaked: true },
              [voterWeighted2]:  { weight: 2,  outcome: OUTCOMES.HIGH,    reveal: true },
              [voterWeighted10]: { weight: 10, outcome: OUTCOMES.HIGH,    reveal: true }
            }

            const expectedTallies = { [OUTCOMES.LOW]: 0, [OUTCOMES.HIGH]: 12, [OUTCOMES.REFUSED]: 12 }
            const expectedWinningOutcome = OUTCOMES.REFUSED
            itSetsAWinningOutcome(votes, expectedTallies, expectedWinningOutcome)

            const expectedWinners = [voterWeighted12]
            itConsidersVotersAsWinners(votes, expectedWinners)

            const expectedLosers = [voterWeighted1, voterWeighted2, voterWeighted3, voterWeighted10, voterWeighted13]
            itConsidersVotersAsLosers(votes, expectedLosers)
          })
        })

        context('between the low, high, and refused outcomes', () => {
          context('when votes are casted in weight-ascending order', () => {
            const votes = {
              [voterWeighted1]:  { weight: 1,  outcome: OUTCOMES.REFUSED, reveal: true },
              [voterWeighted2]:  { weight: 2,  outcome: undefined },
              [voterWeighted3]:  { weight: 3,  outcome: OUTCOMES.LOW,     reveal: true },
              [voterWeighted10]: { weight: 10, outcome: OUTCOMES.LOW,     reveal: true },
              [voterWeighted12]: { weight: 12, outcome: OUTCOMES.REFUSED, reveal: true },
              [voterWeighted13]: { weight: 13, outcome: OUTCOMES.HIGH,    reveal: true }
            }

            const expectedTallies = { [OUTCOMES.LOW]: 13, [OUTCOMES.HIGH]: 13, [OUTCOMES.REFUSED]: 13 }
            const expectedWinningOutcome = OUTCOMES.REFUSED
            itSetsAWinningOutcome(votes, expectedTallies, expectedWinningOutcome)

            const expectedWinners = [voterWeighted1, voterWeighted12]
            itConsidersVotersAsWinners(votes, expectedWinners)

            const expectedLosers = [voterWeighted2, voterWeighted3, voterWeighted10, voterWeighted13]
            itConsidersVotersAsLosers(votes, expectedLosers)
          })
        })

        context('when votes are casted in weight-descending order', () => {
          const votes = {
            [voterWeighted13]: { weight: 13, outcome: OUTCOMES.HIGH,    reveal: true },
            [voterWeighted12]: { weight: 12, outcome: OUTCOMES.REFUSED, reveal: true },
            [voterWeighted10]: { weight: 10, outcome: OUTCOMES.LOW,     reveal: true },
            [voterWeighted3]:  { weight: 3,  outcome: OUTCOMES.LOW,     reveal: true },
            [voterWeighted2]:  { weight: 2,  outcome: undefined },
            [voterWeighted1]:  { weight: 1,  outcome: OUTCOMES.REFUSED, reveal: true }
          }

          const expectedTallies = { [OUTCOMES.LOW]: 13, [OUTCOMES.HIGH]: 13, [OUTCOMES.REFUSED]: 13 }
          const expectedWinningOutcome = OUTCOMES.REFUSED
          itSetsAWinningOutcome(votes, expectedTallies, expectedWinningOutcome)

          const expectedWinners = [voterWeighted1, voterWeighted12]
          itConsidersVotersAsWinners(votes, expectedWinners)

          const expectedLosers = [voterWeighted2, voterWeighted3, voterWeighted10, voterWeighted13]
          itConsidersVotersAsLosers(votes, expectedLosers)
        })

        context('when votes are casted unordered', () => {
          const votes = {
            [voterWeighted10]: { weight: 10, outcome: OUTCOMES.LOW,     reveal: true },
            [voterWeighted2]:  { weight: 2,  outcome: undefined },
            [voterWeighted13]: { weight: 13, outcome: OUTCOMES.HIGH,    reveal: true },
            [voterWeighted3]:  { weight: 3,  outcome: OUTCOMES.LOW,     reveal: true },
            [voterWeighted12]: { weight: 12, outcome: OUTCOMES.REFUSED, reveal: true },
            [voterWeighted1]:  { weight: 1,  outcome: OUTCOMES.REFUSED, reveal: true }
          }

          const expectedTallies = { [OUTCOMES.LOW]: 13, [OUTCOMES.HIGH]: 13, [OUTCOMES.REFUSED]: 13 }
          const expectedWinningOutcome = OUTCOMES.REFUSED
          itSetsAWinningOutcome(votes, expectedTallies, expectedWinningOutcome)

          const expectedWinners = [voterWeighted1, voterWeighted12]
          itConsidersVotersAsWinners(votes, expectedWinners)

          const expectedLosers = [voterWeighted2, voterWeighted3, voterWeighted10, voterWeighted13]
          itConsidersVotersAsLosers(votes, expectedLosers)
        })
      })
    })
  })
})
