const assertRevert = require('./helpers/assert-revert')
const { promisify } = require('util')

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

contract('Court: Disputes', ([ poor, rich, governor, juror1, juror2, arbitrable ]) => {
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
  const juror2Stake = 500

  const NEW_TERM_EVENT = 'NewTerm'
  const NEW_COURT_CONFIG_EVENT = 'NewCourtConfig'

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

    await assertEqualBN(this.court.totalStakedFor(rich), richStake, 'rich stake')
    await assertEqualBN(this.court.totalStakedFor(juror1), juror1Stake, 'juror1 stake')
    await assertEqualBN(this.court.totalStakedFor(juror2), juror2Stake, 'juror2 stake')
  })


  context('activating jurors', () => {
    const passTerms = async terms => {
      await this.court.mock_timeTravel(terms * termDuration)
      await this.court.heartbeat(terms)
      await this.court.mock_blockTravel(1)
      assert.isFalse(await this.court.canTransitionTerm(), 'all terms transitioned')
    }

    beforeEach(async () => {
      await this.court.activate(1, 10000, { from: juror1 })
      await this.court.activate(1, 10000, { from: juror2 })
      await passTerms(1)
    })

    it('creates dispute and drafts jurors', async () => {
      const jurors = 1
      const term = 3
      const rulings = 2
      await this.court.createDispute(arbitrable, rulings, jurors, term)
      await passTerms(2)
      await this.court.draftAdjudicationRound(0)
      console.log(await this.court.getJurorVote(0, 0, 0))
    })
  })
})
