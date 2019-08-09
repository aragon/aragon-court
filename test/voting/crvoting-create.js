const { OUTCOMES } = require('../helpers/crvoting')
const { assertRevert } = require('@aragon/test-helpers/assertThrow')
const { decodeEventsOfType } = require('../helpers/decodeEvent')
const { assertEvent, assertAmountOfEvents } = require('@aragon/test-helpers/assertEvent')(web3)

const CRVoting = artifacts.require('CRVoting')
const CRVotingOwner = artifacts.require('CRVotingOwnerMock')

contract('CRVoting create', ([_, someone]) => {
  let voting, votingOwner

  beforeEach('create base contracts', async () => {
    voting = await CRVoting.new()
    votingOwner = await CRVotingOwner.new(voting.address)
  })

  describe('create', () => {
    context('when the voting is initialized', () => {
      beforeEach('initialize registry', async () => {
        await voting.init(votingOwner.address)
      })

      context('when the sender is the owner', () => {
        const votingId = 1

        context('when the given voting ID was not used before', () => {
          context('when the given possible outcomes is valid', () => {
            const possibleOutcomes = 5

            it('creates the given voting', async () => {
              await votingOwner.create(votingId, possibleOutcomes)

              assert.equal((await voting.getWinningOutcome(votingId)).toString(), 0, 'winning outcome does not match')
              assert.equal((await voting.getMaxAllowedOutcome(votingId)).toString(), possibleOutcomes + OUTCOMES.REFUSED, 'max allowed outcome does not match')
            })

            it('emits an event', async () => {
              const { tx } = await votingOwner.create(votingId, possibleOutcomes)
              const receipt = await web3.eth.getTransactionReceipt(tx)
              const logs = decodeEventsOfType({ receipt }, CRVoting.abi, 'VotingCreated')

              assertAmountOfEvents({ logs }, 'VotingCreated')
              assertEvent({ logs }, 'VotingCreated', { votingId, possibleOutcomes })
            })

            it('considers as valid outcomes any of the possible ones', async () => {
              await votingOwner.create(votingId, possibleOutcomes)

              const masAllowedOutcome = (await voting.getMaxAllowedOutcome(votingId)).toNumber()
              for (let outcome = OUTCOMES.REFUSED + 1; outcome <= masAllowedOutcome; outcome++) {
                assert.isTrue(await voting.isValidOutcome(votingId, outcome), 'outcome should be valid')
              }
            })

            it('considers as invalid outcomes missing, leaked or refused', async () => {
              await votingOwner.create(votingId, possibleOutcomes)

              assert.isFalse(await voting.isValidOutcome(votingId, OUTCOMES.MISSING), 'missing outcome should be invalid')
              assert.isFalse(await voting.isValidOutcome(votingId, OUTCOMES.LEAKED), 'leaked outcome should be invalid')
              assert.isFalse(await voting.isValidOutcome(votingId, OUTCOMES.REFUSED), 'refused outcome should be invalid')
            })
          })

          context('when the possible outcomes below the minimum', () => {
            it('reverts', async () => {
              await assertRevert(votingOwner.create(votingId, 0), 'CRV_INVALID_OUTCOMES_AMOUNT')
              await assertRevert(votingOwner.create(votingId, 1), 'CRV_INVALID_OUTCOMES_AMOUNT')
            })
          })

          context('when the possible outcomes above the maximum', () => {
            it('reverts', async () => {
              await assertRevert(votingOwner.create(votingId, 510), 'CRV_INVALID_OUTCOMES_AMOUNT')
            })
          })
        })

        context('when the given voting ID was already used', () => {
          beforeEach('create voting', async () => {
            await votingOwner.create(votingId, 2)
          })

          it('reverts', async () => {
            await assertRevert(votingOwner.create(votingId, 2), 'CRV_VOTING_ALREADY_EXISTS')
          })
        })
      })

      context('when the sender is not the owner', () => {
        const from = someone

        it('reverts', async () => {
          await assertRevert(voting.create(1, 2, { from }), 'CRV_SENDER_NOT_OWNER')
        })
      })

      context('when the registry is not initialized', () => {
        it('reverts', async () => {
          await assertRevert(voting.create(1, 2, { from: someone }), 'CRV_SENDER_NOT_OWNER')
        })
      })
    })
  })
})