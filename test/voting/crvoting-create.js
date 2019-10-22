const { OUTCOMES } = require('../helpers/crvoting')
const { assertRevert } = require('../helpers/assertThrow')
const { ONE_DAY, NEXT_WEEK } = require('../helpers/time')
const { decodeEventsOfType } = require('../helpers/decodeEvent')
const { assertEvent, assertAmountOfEvents } = require('../helpers/assertEvent')

const CRVoting = artifacts.require('CRVoting')
const CRVotingOwner = artifacts.require('CRVotingOwnerMock')
const Controller = artifacts.require('ControllerMock')

contract('CRVoting create', ([_, someone]) => {
  let controller, voting, votingOwner

  beforeEach('create base contracts', async () => {
    controller = await Controller.new(ONE_DAY, NEXT_WEEK)

    voting = await CRVoting.new(controller.address)
    await controller.setVoting(voting.address)

    votingOwner = await CRVotingOwner.new(voting.address)
    await controller.setCourt(votingOwner.address)
  })

  describe('create', () => {
    context('when the sender is the owner', () => {
      const voteId = 1

      context('when the given vote ID was not used before', () => {
        context('when the given possible outcomes is valid', () => {
          const possibleOutcomes = 5

          it('creates the given voting', async () => {
            await votingOwner.create(voteId, possibleOutcomes)

            assert.isTrue(await voting.isValidOutcome(voteId, OUTCOMES.REFUSED), 'refused outcome should be invalid')
            assert.equal((await voting.getMaxAllowedOutcome(voteId)).toString(), possibleOutcomes + OUTCOMES.REFUSED.toNumber(), 'max allowed outcome does not match')
          })

          it('emits an event', async () => {
            const receipt = await votingOwner.create(voteId, possibleOutcomes)
            const logs = decodeEventsOfType(receipt, CRVoting.abi, 'VotingCreated')

            assertAmountOfEvents({ logs }, 'VotingCreated')
            assertEvent({ logs }, 'VotingCreated', { voteId, possibleOutcomes })
          })

          it('considers as valid outcomes any of the possible ones', async () => {
            await votingOwner.create(voteId, possibleOutcomes)

            const maxAllowedOutcome = (await voting.getMaxAllowedOutcome(voteId)).toNumber()
            for (let outcome = OUTCOMES.REFUSED.toNumber(); outcome <= maxAllowedOutcome; outcome++) {
              assert.isTrue(await voting.isValidOutcome(voteId, outcome), 'outcome should be valid')
            }
          })

          it('considers the missing and leaked outcomes invalid', async () => {
            await votingOwner.create(voteId, possibleOutcomes)

            assert.isFalse(await voting.isValidOutcome(voteId, OUTCOMES.MISSING), 'missing outcome should be invalid')
            assert.isFalse(await voting.isValidOutcome(voteId, OUTCOMES.LEAKED), 'leaked outcome should be invalid')
          })

          it('considers refused as the winning outcome initially', async () => {
            await votingOwner.create(voteId, possibleOutcomes)

            assert.equal((await voting.getWinningOutcome(voteId)).toString(), OUTCOMES.REFUSED, 'winning outcome does not match')
          })
        })

        context('when the possible outcomes below the minimum', () => {
          it('reverts', async () => {
            await assertRevert(votingOwner.create(voteId, 0), 'CRV_INVALID_OUTCOMES_AMOUNT')
            await assertRevert(votingOwner.create(voteId, 1), 'CRV_INVALID_OUTCOMES_AMOUNT')
          })
        })

        context('when the possible outcomes above the maximum', () => {
          it('reverts', async () => {
            await assertRevert(votingOwner.create(voteId, 510), 'CRV_INVALID_OUTCOMES_AMOUNT')
          })
        })
      })

      context('when the given vote ID was already used', () => {
        beforeEach('create voting', async () => {
          await votingOwner.create(voteId, 2)
        })

        it('reverts', async () => {
          await assertRevert(votingOwner.create(voteId, 2), 'CRV_VOTE_ALREADY_EXISTS')
        })
      })
    })

    context('when the sender is not the owner', () => {
      const from = someone

      it('reverts', async () => {
        await assertRevert(voting.create(1, 2, { from }), 'CTD_SENDER_NOT_COURT_MODULE')
      })
    })
  })
})
