const assertRevert = require('./helpers/assert-revert')
const { soliditySha3 } = require('web3-utils')

const CRVoting = artifacts.require('CRVoting')
const VotingOwner = artifacts.require('VotingOwnerMock')

const getLog = (receipt, logName, argName) => {
  const log = receipt.logs.find(({ event }) => event == logName)
  return log ? log.args[argName] : null
}

const SALT = soliditySha3('passw0rd')
const encryptVote = (ruling, salt = SALT) =>
  soliditySha3(
    { t: 'uint8', v: ruling },
    { t: 'bytes32', v: salt }
  )

const ERROR_NOT_ALLOWED_BY_OWNER = 'CRV_NOT_ALLOWED_BY_OWNER'
const ERROR_OUT_OF_BOUNDS = 'CRV_OUT_OF_BOUNDS'

contract('CRVoting', ([ account0, account1 ]) => {
  const initPwd = SALT
  const preOwner = '0x' + soliditySha3(initPwd).slice(-40)

  beforeEach(async () => {
    this.voting = await CRVoting.new(preOwner)
  })

  it('can set owner', async () => {
    assert.equal(await this.voting.getOwner.call(), preOwner, 'wrong owner before change')
    await this.voting.setOwner(account1, initPwd)
    assert.equal(await this.voting.getOwner.call(), account1, 'wrong owner after change')
  })

  it('fails creating vote if not owner', async () => {
    //await assertRevert(this.voting.createVote(1, { from: account1 }), 'CRV_NOT_OWNER')
    await assertRevert(this.voting.createVote(1, { from: account1 }))
  })

  context('With Owner interface', () => {
    const vote = 1
    let votingOwner

    beforeEach(async () => {
      votingOwner = await VotingOwner.new()
      await this.voting.setOwner(votingOwner.address, initPwd)
    })

    it('can create vote as owner', async () => {
      await votingOwner.createVote(this.voting.address, 2)
    })

    context('Voting actions', () => {
      let voteId

      beforeEach(async () => {
        const r = await votingOwner.createVote(this.voting.address, 2)
        voteId = getLog(r, 'VoteCreated', 'voteId')
        await votingOwner.setResponse(1)
      })

      context('Commit', () => {
        it('commits vote', async () => {
          await this.voting.commitVote(voteId, encryptVote(vote))
          // TODO
        })

        it('fails commiting non-existing vote', async () => {
          //await assertRevert(this.voting.commitVote(voteId + 1, encryptVote(vote)), ERROR_OUT_OF_BOUNDS)
          await assertRevert(this.voting.commitVote(voteId + 1, encryptVote(vote)))
        })

        it('fails commiting twice', async () => {
          await this.voting.commitVote(voteId, encryptVote(vote))
          await assertRevert(this.voting.commitVote(voteId, encryptVote(vote)))
        })

        it('fails commiting vote if owner does not allow', async () => {
          await votingOwner.setResponse(0)
          //await assertRevert(this.voting.commitVote(voteId, encryptVote(vote)), ERROR_NOT_ALLOWED_BY_OWNER)
          await assertRevert(this.voting.commitVote(voteId, encryptVote(vote)))
        })
      })

      context('Leak', () => {
        beforeEach(async () => {
          await this.voting.commitVote(voteId, encryptVote(vote))
        })

        // TODO
        it('leaks vote', async () => {
          await this.voting.leakVote(voteId, account0, vote, SALT)
          // TODO
        })

        it('fails leaking non-existing vote', async () => {
          //await assertRevert(this.voting.commitVote(voteId + 1, encryptVote(vote)), ERROR_OUT_OF_BOUNDS)
          await assertRevert(this.voting.commitVote(voteId + 1, encryptVote(vote)))
        })

        it('fails leaking vote if owner does not allow', async () => {
          await votingOwner.setResponse(0)
          //await assertRevert(this.voting.leakVote(voteId, account0, vote, SALT), ERROR_NOT_ALLOWED_BY_OWNER)
          await assertRevert(this.voting.leakVote(voteId, account0, vote, SALT))
        })
      })

      context('Reveal', () => {
        beforeEach(async () => {
          await this.voting.commitVote(voteId, encryptVote(vote))
        })

        it('reveals vote', async () => {
          await this.voting.revealVote(voteId, vote, SALT)
          // TODO
        })

        it('fails revealing non-existing vote', async () => {
          //await assertRevert(this.voting.commitVote(voteId + 1, encryptVote(vote)), ERROR_OUT_OF_BOUNDS)
          await assertRevert(this.voting.commitVote(voteId + 1, encryptVote(vote)))
        })

        it('fails revealing vote if owner does not allow', async () => {
          await votingOwner.setResponse(0)
          //await assertRevert(this.voting.revealVote(voteId, vote, SALT), ERROR_NOT_ALLOWED_BY_OWNER)
          await assertRevert(this.voting.revealVote(voteId, vote, SALT))
        })
      })
    })
  })
})
