const { buildHelper } = require('./helpers/court')(web3, artifacts)
const { assertRevert } = require('@aragon/os/test/helpers/assertThrow')
const { ONE_DAY, TOMORROW } = require('./helpers/time')

const TokenFactory = artifacts.require('TokenFactory')
const CourtAccounting = artifacts.require('CourtAccounting')
const JurorsRegistry = artifacts.require('JurorsRegistryMock')
const CRVoting = artifacts.require('CRVoting')
const Subscriptions = artifacts.require('SubscriptionsMock')

const MINIME = 'MiniMeToken'
const BLOCK_GAS_LIMIT = 8e6

const getLog = (receipt, logName, argName) => {
  const log = receipt.logs.find(({ event }) => event == logName)
  return log ? log.args[argName] : null
}

const deployedContract = async (receiptPromise, name) =>
  artifacts.require(name).at(getLog(await receiptPromise, 'Deployed', 'addr'))

const assertEqualBN = async (actualPromise, expected, message) =>
  assert.equal((await actualPromise).toNumber(), expected, message)

const NO_DATA = ''
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

contract('Court: Lifecycle', ([ poor, rich, juror1, juror2 ]) => {
  const cooldown = 10

  const termDuration = ONE_DAY
  const firstTermStartTime = TOMORROW
  const initialBalance = 1e6
  const richStake = 1000
  const juror1Stake = 700
  const juror2Stake = 300

  const ERROR_JUROR_TOKENS_AT_STAKE = 'STK_JUROR_TOKENS_AT_STAKE'

  before(async () => {
    this.tokenFactory = await TokenFactory.new()
  })

  beforeEach(async () => {
    // Mints 1,000,000 tokens for sender
    this.anj = await deployedContract(this.tokenFactory.newToken('ANJ', initialBalance, { from: rich }), MINIME)
    await assertEqualBN(this.anj.balanceOf(rich), initialBalance, 'rich balance')
    await assertEqualBN(this.anj.balanceOf(poor), 0, 'poor balance')

    this.jurorsRegistry = await JurorsRegistry.new()
    this.accounting = await CourtAccounting.new()
    this.voting = await CRVoting.new()
    this.subscriptions = await Subscriptions.new()
    await this.subscriptions.setUpToDate(true)

    this.courtHelper = buildHelper()
    this.court = await this.courtHelper.deploy({
      termDuration,
      firstTermStartTime,
      feeToken: ZERO_ADDRESS,
      jurorToken: this.anj,
      voting: this.voting,
      accounting: this.accounting,
      subscriptions: this.subscriptions,
      jurorsRegistry: this.jurorsRegistry,
    })

    assert.equal(await this.jurorsRegistry.token(), this.anj.address, 'court token')
    await assertEqualBN(this.jurorsRegistry.totalActiveBalance(), 0, 'empty sum tree')
    
    await this.anj.approveAndCall(this.jurorsRegistry.address, richStake, NO_DATA, { from: rich })
    await this.anj.approve(this.jurorsRegistry.address, juror1Stake, { from: rich })
    await this.jurorsRegistry.stakeFor(juror1, juror1Stake, NO_DATA, { from: rich })
    await this.anj.approve(this.jurorsRegistry.address, juror2Stake, { from: rich })
    await this.jurorsRegistry.stakeFor(juror2, juror2Stake, NO_DATA, { from: rich })

    await assertEqualBN(this.jurorsRegistry.totalStakedFor(rich), richStake, 'rich stake')
    await assertEqualBN(this.jurorsRegistry.totalStakedFor(juror1), juror1Stake, 'juror1 stake')
    await assertEqualBN(this.jurorsRegistry.totalStakedFor(juror2), juror2Stake, 'juror2 stake')
  })

  it('can be deployed under the block gas limit', async () => {
    const getReceipt = tx =>
      new Promise((res, rej) =>
        web3.eth.getTransactionReceipt(tx, (e, rec) => {
          if (e) rej(e)
          res(rec)
        }))

    // TODO: This is actually measuring the deployment cost for CourtMock and not Court
    const { gasUsed } = await getReceipt(this.court.transactionHash)
    assert.isBelow(gasUsed, BLOCK_GAS_LIMIT, 'CourtMock should be deployable to under the gas limit')
  })

  context('before first term', () => {
    it('it in term #0', async () => {
      await assertEqualBN(this.court.getLastEnsuredTermId(), 0, 'court term #0')
    })

    it('can activate during period before heartbeat', async () => {
      await this.courtHelper.setTimestamp(firstTermStartTime - 1)

      await this.jurorsRegistry.activate(0, { from: juror1 }) // will activate all his funds
      await assertEqualBN(this.jurorsRegistry.totalActiveBalance(), juror1Stake, 'total tree sum')
    })

    it('gets the correct balance after activation', async () => {
      await this.courtHelper.setTimestamp(firstTermStartTime - 1)

      await this.jurorsRegistry.activate(0, { from: rich })

      const id = await this.jurorsRegistry.getJurorId(rich)
      await assertEqualBN(id, 1, 'incorrect juror id')

      const [activeBalance, availableBalance, lockedBalance, pendingDeactivationBalance] = await this.jurorsRegistry.balanceOf(rich)
      await assertEqualBN(activeBalance, richStake, 'incorrect account of active balance')
      await assertEqualBN(availableBalance, 0, 'incorrect amount of available balance')
      await assertEqualBN(lockedBalance, 0, 'incorrect amount of locked balance')
      await assertEqualBN(pendingDeactivationBalance, 0, 'incorrect pending deactivation amount')
    })

    it('reverts if activating balance is below dust', async () => {
      await this.courtHelper.setTimestamp(firstTermStartTime - 1)

      await assertRevert(this.jurorsRegistry.activate(0, { from: poor }), 'JR_INVALID_ZERO_AMOUNT')
      await assertRevert(this.jurorsRegistry.activate(10, { from: poor }), 'JR_INVALID_ACTIVATION_AMOUNT')
    })
  })

  context('on regular court terms', () => {
    const term = 3

    const passTerms = async terms => {
      await this.courtHelper.increaseTime(terms * termDuration)
      await this.court.heartbeat(terms)

      assert.isTrue((await this.court.neededTermTransitions()).eq(0), 'all terms transitioned')
    }

    beforeEach('pass 3 terms', async () => {
      await passTerms(3)

      await assertEqualBN(this.court.getLastEnsuredTermId(), term, 'term #3')
    })

    it('jurors can activate', async () => {
      await this.jurorsRegistry.activate(0, { from: juror1 })
      await this.jurorsRegistry.activate(0, { from: juror2 })

      await passTerms(1)

      await assertEqualBN(this.jurorsRegistry.totalActiveBalance(), juror1Stake + juror2Stake, 'both jurors in the tree')
    })

    const activateDeactivate = async () => {
      await this.jurorsRegistry.activate(0, { from: juror1 })
      await this.jurorsRegistry.activate(0, { from: juror2 })
      await passTerms(1)
      await assertEqualBN(this.jurorsRegistry.totalActiveBalance(), juror1Stake + juror2Stake, 'both jurors in the tree')
      await this.jurorsRegistry.deactivate(0, { from: juror1 })
      await passTerms(1)
      await assertEqualBN(this.jurorsRegistry.totalActiveBalance(), juror2Stake, 'only juror2 in tree')
      await this.jurorsRegistry.deactivate(0, { from: juror2 })
      await passTerms(1)
      await assertEqualBN(this.jurorsRegistry.totalActiveBalance(), 0, 'no jurors in tree')
    }

    it('jurors can deactivate', async () => {
      await activateDeactivate()
    })

    it('jurors can activate, deactivate and so on multiple times', async () => {
      const iterations = 3
      for (let i = 0; i < iterations; i++) {
        await activateDeactivate()
      }
    })

    // TODO: refactor to use at stake tokens
    it.skip('juror can withdraw after cooldown', async () => {
      await this.jurorsRegistry.activate(0, { from: juror1 })
      await passTerms(1)
      await assertEqualBN(this.jurorsRegistry.totalActiveBalance(), juror1Stake, 'juror added to tree')
      await passTerms(1)
      await assertEqualBN(this.jurorsRegistry.totalActiveBalance(), 0, 'juror removed from to tree')
      
      await assertRevert(this.jurorsRegistry.unstake(1, NO_DATA, { from: juror1 }), ERROR_JUROR_TOKENS_AT_STAKE)

      await passTerms(cooldown + 1)
      await this.jurorsRegistry.unstake(juror1Stake, NO_DATA, { from: juror1 })

      await assertEqualBN(this.anj.balanceOf(juror1), juror1Stake, 'juror tokens withdrawn')
      await assertEqualBN(this.jurorsRegistry.totalStakedFor(juror1), 0, 'juror no longer staked')
      // TODO: state account check
    })
  })
})
