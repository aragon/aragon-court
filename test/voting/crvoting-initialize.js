const { assertRevert } = require('@aragon/test-helpers/assertThrow')

const CRVoting = artifacts.require('CRVoting')
const CRVotingOwnerMock = artifacts.require('CRVotingOwnerMock')

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

contract('CRVoting initialization', ([_, something]) => {
  let voting, votingOwner

  beforeEach('create base contracts', async () => {
    voting = await CRVoting.new()
    votingOwner = await CRVotingOwnerMock.new(voting.address)
  })

  describe('initialize', () => {
    context('when the voting is not initialized', () => {
      context('initialization fails', () => {
        // TODO: skipping these tests since we are currently initializing all the court dependencies from the
        //       court constructor. Will uncomment once we move that logic to a factory contract

        context.skip('when the given owner is the zero address', () => {
          const owner = ZERO_ADDRESS

          it('reverts', async () => {
            await assertRevert(voting.init(owner), 'CRV_NOT_CONTRACT')
          })
        })

        context.skip('when the given owner is not a contract address', () => {
          const owner = something

          it('reverts', async () => {
            await assertRevert(voting.init(owner), 'CRV_NOT_CONTRACT')
          })
        })
      })

      context('when the initialization succeeds', () => {
        it('is initialized', async () => {
          await voting.init(votingOwner.address)

          assert.isTrue(await voting.hasInitialized(), 'voting is not initialized')
        })
      })
    })

    context('when it was already initialized', () => {
      beforeEach('initialize voting', async () => {
        await voting.init(votingOwner.address)
      })

      it('reverts', async () => {
        await assertRevert(voting.init(votingOwner.address), 'INIT_ALREADY_INITIALIZED')
      })
    })
  })

  describe('owner', () => {
    context('when the voting is initialized', () => {
      beforeEach('initialize voting', async () => {
        await voting.init(votingOwner.address)
      })

      it('returns the owner address', async () => {
        assert.equal(await voting.getOwner(), votingOwner.address, 'owner address does not match')
      })
    })

    context('when the voting is not initialized', () => {
      it('returns the zero address', async () => {
        assert.equal(await voting.getOwner(), ZERO_ADDRESS, 'owner address does not match')
      })
    })
  })
})
