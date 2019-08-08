const { assertRevert } = require('@aragon/os/test/helpers/assertThrow')
const { soliditySha3 } = require('web3-utils')

const CRVoting = artifacts.require('CRVoting')
const VotingOwner = artifacts.require('CRVotingOwnerMock')

const getLog = (receipt, logName, argName) => {
  const log = receipt.logs.find(({ event }) => event == logName)
  return log ? log.args[argName] : null
}

const ZERO_ADDRESS = '0x' + '00'.repeat(20)
const SALT = soliditySha3('passw0rd')
const encryptVote = (ruling, salt = SALT) =>
  soliditySha3(
    { t: 'uint8', v: ruling },
    { t: 'bytes32', v: salt }
  )


contract('CRVoting', ([ account0, account1 ]) => {

  beforeEach(async () => {
    this.voting = await CRVoting.new()
  })

  it('can set owner', async () => {
    assert.equal(await this.voting.getOwner.call(), ZERO_ADDRESS, 'wrong owner before change')
    await this.voting.init(account1)
    assert.equal(await this.voting.getOwner.call(), account1, 'wrong owner after change')
  })

  it('fails creating vote if not owner', async () => {
    await assertRevert(this.voting.create(0, 1, { from: account1 }), 'CRV_NOT_OWNER')
  })

  context('With Owner interface', () => {
    const vote = 3
    let votingOwner

    beforeEach(async () => {
      votingOwner = await VotingOwner.new(this.voting.address)
      await this.voting.init(votingOwner.address)
    })

    it('can create vote as owner', async () => {
      await votingOwner.create(0, 2)
    })

    context('Voting actions', () => {
      let votingId

      beforeEach(async () => {
        const r = await votingOwner.create(0, 2)
        votingId = getLog(r, 'VoteCreated', 'votingId')
        await votingOwner.mockVoterWeight(account0, 1)
      })

      context('Commit', () => {
        it('commits vote', async () => {
          await this.voting.commit(votingId, encryptVote(vote))
          // TODO
        })

        it('fails commiting non-existing vote', async () => {
          await assertRevert(this.voting.commit(votingId + 1, encryptVote(vote)), 'CRV_VOTING_DOES_NOT_EXIST')
        })

        it('fails commiting twice', async () => {
          await this.voting.commit(votingId, encryptVote(vote))
          await assertRevert(this.voting.commit(votingId, encryptVote(vote)))
        })

        it('fails commiting vote if owner does not allow', async () => {
          await votingOwner.mockVoterWeight(account0, 0)
          await assertRevert(this.voting.commit(votingId, encryptVote(vote)), 'CRV_COMMIT_DENIED_BY_OWNER')
        })
      })

      context('Leak', () => {
        beforeEach(async () => {
          await this.voting.commit(votingId, encryptVote(vote))
        })

        // TODO
        it('leaks vote', async () => {
          await this.voting.leak(votingId, account0, vote, SALT)
          // TODO
        })

        it('fails leaking non-existing vote', async () => {
          await assertRevert(this.voting.commit(votingId + 1, encryptVote(vote)), 'CRV_VOTING_DOES_NOT_EXIST')
        })

        it('fails leaking vote if owner does not allow', async () => {
          await votingOwner.mockVoterWeight(account0, 0)
          await assertRevert(this.voting.leak(votingId, account0, vote, SALT), 'CRV_COMMIT_DENIED_BY_OWNER')
        })
      })

      context('Reveal', () => {
        beforeEach(async () => {
          await this.voting.commit(votingId, encryptVote(vote))
        })

        it('reveals vote', async () => {
          await this.voting.reveal(votingId, vote, SALT)
          // TODO
        })

        it('fails revealing non-existing vote', async () => {
          await assertRevert(this.voting.commit(votingId + 1, encryptVote(vote)), 'CRV_VOTING_DOES_NOT_EXIST')
        })

        it('fails revealing vote if owner does not allow', async () => {
          await votingOwner.mockVoterWeight(account0, 0)
          await assertRevert(this.voting.reveal(votingId, vote, SALT), 'CRV_REVEAL_DENIED_BY_OWNER')
        })
      })
    })
  })
})
