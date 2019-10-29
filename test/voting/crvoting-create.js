const { assertBn } = require('../helpers/numbers')
const { OUTCOMES } = require('../helpers/crvoting')
const { buildHelper } = require('../helpers/controller')(web3, artifacts)
const { assertRevert } = require('../helpers/assertThrow')
const { decodeEventsOfType } = require('../helpers/decodeEvent')
const { assertEvent, assertAmountOfEvents } = require('../helpers/assertEvent')

const CRVoting = artifacts.require('CRVoting')
const Court = artifacts.require('CourtMockForVoting')

contract('CRVoting create', ([_, someone]) => {
  let controller, voting, court

  beforeEach('create base contracts', async () => {
    controller = await buildHelper().deploy()

    voting = await CRVoting.new(controller.address)
    await controller.setVoting(voting.address)

    court = await Court.new(controller.address)
    await controller.setCourt(court.address)
  })

  describe('create', () => {
    context('when the sender is the owner', () => {
      const voteId = 1

      context('when the given vote ID was not used before', () => {
        context('when the given possible outcomes is valid', () => {
          const possibleOutcomes = 5

          it('creates the given voting', async () => {
            await court.create(voteId, possibleOutcomes)

            assert.isTrue(await voting.isValidOutcome(voteId, OUTCOMES.REFUSED), 'refused outcome should be invalid')
            assertBn((await voting.getMaxAllowedOutcome(voteId)), possibleOutcomes + OUTCOMES.REFUSED.toNumber(), 'max allowed outcome does not match')
          })

          it('emits an event', async () => {
            const receipt = await court.create(voteId, possibleOutcomes)
            const logs = decodeEventsOfType(receipt, CRVoting.abi, 'VotingCreated')

            assertAmountOfEvents({ logs }, 'VotingCreated')
            assertEvent({ logs }, 'VotingCreated', { voteId, possibleOutcomes })
          })

          it('considers as valid outcomes any of the possible ones', async () => {
            await court.create(voteId, possibleOutcomes)

            const maxAllowedOutcome = (await voting.getMaxAllowedOutcome(voteId)).toNumber()
            for (let outcome = OUTCOMES.REFUSED.toNumber(); outcome <= maxAllowedOutcome; outcome++) {
              assert.isTrue(await voting.isValidOutcome(voteId, outcome), 'outcome should be valid')
            }
          })

          it('considers the missing and leaked outcomes invalid', async () => {
            await court.create(voteId, possibleOutcomes)

            assert.isFalse(await voting.isValidOutcome(voteId, OUTCOMES.MISSING), 'missing outcome should be invalid')
            assert.isFalse(await voting.isValidOutcome(voteId, OUTCOMES.LEAKED), 'leaked outcome should be invalid')
          })

          it('considers refused as the winning outcome initially', async () => {
            await court.create(voteId, possibleOutcomes)

            assertBn((await voting.getWinningOutcome(voteId)), OUTCOMES.REFUSED, 'winning outcome does not match')
          })
        })

        context('when the possible outcomes below the minimum', () => {
          it('reverts', async () => {
            await assertRevert(court.create(voteId, 0), 'CRV_INVALID_OUTCOMES_AMOUNT')
            await assertRevert(court.create(voteId, 1), 'CRV_INVALID_OUTCOMES_AMOUNT')
          })
        })

        context('when the possible outcomes above the maximum', () => {
          it('reverts', async () => {
            await assertRevert(court.create(voteId, 510), 'CRV_INVALID_OUTCOMES_AMOUNT')
          })
        })
      })

      context('when the given vote ID was already used', () => {
        beforeEach('create voting', async () => {
          await court.create(voteId, 2)
        })

        it('reverts', async () => {
          await assertRevert(court.create(voteId, 2), 'CRV_VOTE_ALREADY_EXISTS')
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
