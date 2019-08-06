const { assertRevert } = require('@aragon/os/test/helpers/assertThrow')

const TokenFactory = artifacts.require('TokenFactory')
const CourtMock = artifacts.require('CourtMock')
const JurorsRegistry = artifacts.require('JurorsRegistry')
const CRVoting = artifacts.require('CRVoting')
const CourtAccounting = artifacts.require('CourtAccounting')
const Subscriptions = artifacts.require('SubscriptionsMock')

const MINIME = 'MiniMeToken'

const getLog = (receipt, logName, argName) => {
  const log = receipt.logs.find(({ event }) => event == logName)
  return log ? log.args[argName] : null
}

const deployedContract = async (receiptPromise, name) =>
      artifacts.require(name).at(getLog(await receiptPromise, 'Deployed', 'addr'))

const assertEqualBN = async (actualPromise, expected, message) =>
      assert.equal((await actualPromise).toNumber(), expected, message)

contract('Court: init', ([ governor ]) => {
  const ZERO_ADDRESS = '0x' + '00'.repeat(20)

  const initialBalance = 1e6

  const ERROR_WRONG_PENALTY_PCT = 'CTBAD_PENALTY'

  before(async () => {
    this.tokenFactory = await TokenFactory.new()
  })

  beforeEach(async () => {
    // Mints 1,000,000 tokens for sender
    this.anj = await deployedContract(this.tokenFactory.newToken('ANJ', initialBalance), MINIME)

    this.jurorsRegistry = await JurorsRegistry.new()
    this.voting = await CRVoting.new()
    this.accounting = await CourtAccounting.new()
    this.subscriptions = await Subscriptions.new()
    await this.subscriptions.setUpToDate(true)
  })

  it('fails to deploy if penaltyPct is too low compared to jurorMinStake', async () => {
    const termDuration = 10
    const firstTermStart = 10
    const startBlock = 1000
    const commitTerms = 1
    const revealTerms = 1
    const appealTerms = 1
    const finalRoundReduction = 3300 // 100‱ = 1%

    const jurorMinStake = 200
    const penaltyPct = 10 // 100‱ = 1%

    await assertRevert(
      CourtMock.new(
        termDuration,
        [ this.anj.address, ZERO_ADDRESS ], // no fees
        this.jurorsRegistry.address,
        this.accounting.address,
        this.voting.address,
        this.subscriptions.address,
        [ 0, 0, 0, 0 ],
        governor,
        firstTermStart,
        jurorMinStake,
        [ commitTerms, appealTerms, revealTerms ],
        [ penaltyPct, finalRoundReduction ],
        4,
        [ 0, 0, 0, 0, 0 ]
      ),
      ERROR_WRONG_PENALTY_PCT
    )
  })
})
