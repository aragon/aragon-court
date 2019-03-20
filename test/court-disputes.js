const assertRevert = require('./helpers/assert-revert')
const { promisify } = require('util')
const { soliditySha3 } = require('web3-utils')

const TokenFactory = artifacts.require('TokenFactory')
const CourtMock = artifacts.require('CourtMock')

const MINIME = 'MiniMeToken'

const getLog = (receipt, logName, argName) => {
  const log = receipt.logs.find(({ event }) => event == logName)
  return log ? log.args[argName] : null
}

const deployedContract = async (receiptPromise, name) =>
  artifacts.require(name).at(getLog(await receiptPromise, 'Deployed', 'addr'))

const assertEqualBN = async (actualPromise, expected, message) =>
  assert.equal((await actualPromise).toNumber(), expected, message)

const assertLogs = async (receiptPromise, ...logNames) => {
  const receipt = await receiptPromise
  for (const logName of logNames) {
    assert.isNotNull(getLog(receipt, logName), `Expected ${logName} in receipt`)
  }
}

contract('Court: Disputes', ([ poor, rich, governor, juror1, juror2, juror3, arbitrable ]) => {
  const NO_DATA = ''
  const ZERO_ADDRESS = '0x' + '00'.repeat(20)
  
  const termDuration = 10
  const firstTermStart = 1
  const jurorMinStake = 100
  const startBlock = 1000
  const commitTerms = 1
  const revealTerms = 1
  const appealTerms = 1
  const penaltyPct = 100 // 100‱ = 1%
  
  const initialBalance = 1e6
  const richStake = 1000
  const juror1Stake = 1000
  const juror2Stake = 600
  const juror3Stake = 500

  const NEW_DISPUTE_EVENT = 'NewDispute'
  const JUROR_DRAFTED_EVENT = 'JurorDrafted'
  const DISPUTE_STATE_CHANGED_EVENT = 'DisputeStateChanged'
  const VOTE_COMMITTED_EVENT = 'VoteCommitted'
  const VOTE_REVEALED_EVENT = 'VoteRevealed'

  const SALT = soliditySha3('passw0rd')

  const encryptVote = (ruling, salt = SALT) =>
    soliditySha3(
      { t: 'uint8', v: ruling },
      { t: 'bytes32', v: salt }
    )

  before(async () => {
    this.tokenFactory = await TokenFactory.new()
  })

  beforeEach(async () => {
    // Mints 1,000,000 tokens for sender
    this.anj = await deployedContract(this.tokenFactory.newToken('ANJ', initialBalance, { from: rich }), MINIME)
    assertEqualBN(this.anj.balanceOf(rich), initialBalance, 'rich balance')
    assertEqualBN(this.anj.balanceOf(poor), 0, 'poor balance')

    this.court = await CourtMock.new(
      termDuration,
      this.anj.address,
      ZERO_ADDRESS,
      0,
      0,
      0,
      0,
      governor,
      firstTermStart,
      jurorMinStake,
      commitTerms,
      revealTerms,
      appealTerms,
      penaltyPct
    )
    await this.court.mock_setBlockNumber(startBlock)

    assert.equal(await this.court.token(), this.anj.address, 'court token')
    assert.equal(await this.court.jurorToken(), this.anj.address, 'court juror token')
    await assertEqualBN(this.court.treeTotalSum(), 0, 'empty sum tree')
    
    await this.anj.approveAndCall(this.court.address, richStake, NO_DATA, { from: rich })

    await this.anj.approve(this.court.address, juror1Stake, { from: rich })
    await this.court.stakeFor(juror1, juror1Stake, NO_DATA, { from: rich })
    await this.anj.approve(this.court.address, juror2Stake, { from: rich })
    await this.court.stakeFor(juror2, juror2Stake, NO_DATA, { from: rich })
    await this.anj.approve(this.court.address, juror3Stake, { from: rich })
    await this.court.stakeFor(juror3, juror3Stake, NO_DATA, { from: rich })

    await assertEqualBN(this.court.totalStakedFor(rich), richStake, 'rich stake')
    await assertEqualBN(this.court.totalStakedFor(juror1), juror1Stake, 'juror1 stake')
    await assertEqualBN(this.court.totalStakedFor(juror2), juror2Stake, 'juror2 stake')
    await assertEqualBN(this.court.totalStakedFor(juror3), juror3Stake, 'juror3 stake')
  })

  it('can encrypt votes', async () => {
    const ruling = 10
    assert.equal(await this.court.encryptVote(ruling, SALT), encryptVote(ruling))
  })

  context('activating jurors', () => {
    const passTerms = async terms => {
      await this.court.mock_timeTravel(terms * termDuration)
      await this.court.heartbeat(terms)
      await this.court.mock_blockTravel(1)
      assert.isFalse(await this.court.canTransitionTerm(), 'all terms transitioned')
    }

    beforeEach(async () => {
      const activateTerm = 1
      const deactivateTerm = 10000
      for (const juror of [juror1, juror2, juror3]) {
        await this.court.activate(activateTerm, deactivateTerm, { from: juror })
      }
      await passTerms(1)
    })

    context('on dispute', () => {
      const jurors = 3
      const term = 3
      const rulings = 2

      const disputeId = 0 // TODO: Get from NewDispute event

      beforeEach(async () => {
        await assertLogs(this.court.createDispute(arbitrable, rulings, jurors, term), NEW_DISPUTE_EVENT)
        await passTerms(2)
      })

      context('with hijacked juror selection', () => {
        const roundId = 0

        beforeEach(async () => {
          await this.court.mock_hijackTreeSearch()
          await assertLogs(this.court.draftAdjudicationRound(roundId), JUROR_DRAFTED_EVENT, DISPUTE_STATE_CHANGED_EVENT)

          const expectedJurors = [juror1, juror2, juror3]

          for (const [ draftId, juror ] of expectedJurors.entries()) {
            const [ jurorAddr, ruling ] = await this.court.getJurorVote(disputeId, roundId, draftId)

            assert.equal(jurorAddr, juror, `juror #${draftId} address`)
            assert.equal(ruling, 0, `juror #${draftId} vote`)
          }

          assertRevert(this.court.getJurorVote(0, 0, jurors)) // out of bounds
        })

        const commitVotes = async votes => {
          for (const [draftId, [juror, vote]] of votes.entries()) {
            const receiptPromise = this.court.commitVote(disputeId, roundId, draftId, encryptVote(vote), { from: juror })
            await assertLogs(receiptPromise, VOTE_COMMITTED_EVENT)
          }
        }

        const revealVotes = async votes => {
          for (const [ draftId, [ juror, vote ]] of votes.entries()) {
            const receiptPromise = this.court.revealVote(disputeId, roundId, draftId, vote, SALT, { from: juror })
            await assertLogs(receiptPromise, VOTE_REVEALED_EVENT)
          }
        }

        it('jurors can commit and reveal votes', async () => {
          await commitVotes([[juror1, 1], [juror2, 1], [juror3, 2]])
          await passTerms(1)
          await revealVotes([[juror1, 1], [juror2, 1], [juror3, 2]])
          const [ ruling, rulingVotes ] = await this.court.getWinningRuling(disputeId, roundId)

          assertEqualBN(ruling, 1, 'winning ruling')
          assertEqualBN(rulingVotes, 2, 'winning ruling votes')
        })
      })
    })
  })
})
