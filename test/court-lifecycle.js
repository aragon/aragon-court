const { assertRevert } = require('@aragon/os/test/helpers/assertThrow')

const TokenFactory = artifacts.require('TokenFactory')
const CourtMock = artifacts.require('CourtMock')
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

const assertLogs = async (receiptPromise, ...logNames) => {
  const receipt = await receiptPromise
  for (const logName of logNames) {
    assert.isNotNull(getLog(receipt, logName), `Expected ${logName} in receipt`)
  }
}

contract('Court: Lifecycle', ([ poor, rich, governor, juror1, juror2 ]) => {
  const NO_DATA = ''
  const ZERO_ADDRESS = '0x' + '00'.repeat(20)

  const termDuration = 10
  const firstTermStart = 15
  const jurorMinStake = 100
  const cooldown = 10
  const commitTerms = 1
  const revealTerms = 1
  const appealTerms = 1
  const appealConfirmTerms = 1
  const penaltyPct = 100 // 100‱ = 1%
  const finalRoundReduction = 3300 // 100‱ = 1%
  
  const initialBalance = 1e6
  const richStake = 1000
  const juror1Stake = 700
  const juror2Stake = 300

  const NEW_TERM_EVENT = 'NewTerm'
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

    this.court = await CourtMock.new(
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
      [ commitTerms, revealTerms, appealTerms, appealConfirmTerms ],
      [ penaltyPct, finalRoundReduction ],
      3,
      4,
      [ 0, 0, 0, 0, 0 ]
    )

    // TODO: use more realistic term duration and first term start time values
    await this.court.mockSetTimestamp(1)
    await this.jurorsRegistry.mockSetTimestamp(1)

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

    it('transitions to term #1 on heartbeat', async () => {
      await this.jurorsRegistry.mockSetTimestamp(15)
      await this.court.mockSetTimestamp(15)
      await assertLogs(this.court.heartbeat(1), NEW_TERM_EVENT)
      
      await assertEqualBN(this.court.getLastEnsuredTermId(), 1, 'court term #1')
      const [
        startTime,
        dependingDrafts,
        courtConfigId,
        randomnessBn
      ] = await this.court.terms(1)

      await assertEqualBN(startTime, firstTermStart, 'first term start')
      await assertEqualBN(dependingDrafts, 0, 'depending drafts')
      await assertEqualBN(courtConfigId, 1, 'court config id')
      await assertEqualBN(randomnessBn, (await this.court.getBlockNumberExt()).toNumber() + 1, 'randomness bn')
    })

    it('can activate during period before heartbeat', async () => {
      await this.jurorsRegistry.mockSetTimestamp(firstTermStart - 1)
      await this.court.mockSetTimestamp(firstTermStart - 1)
      await this.jurorsRegistry.activate(0, { from: juror1 }) // will activate all his funds
      await assertEqualBN(this.jurorsRegistry.totalActiveBalance(), juror1Stake, 'total tree sum')
    })

    it('gets the correct balance after activation', async () => {
      await this.jurorsRegistry.mockSetTimestamp(firstTermStart - 1)
      await this.court.mockSetTimestamp(firstTermStart - 1)
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
      await this.jurorsRegistry.mockSetTimestamp(firstTermStart - 1)
      await this.court.mockSetTimestamp(firstTermStart - 1)
      await assertRevert(this.jurorsRegistry.activate(0, { from: poor }), 'JR_INVALID_ZERO_AMOUNT')
      await assertRevert(this.jurorsRegistry.activate(10, { from: poor }), 'JR_INVALID_ACTIVATION_AMOUNT')
    })

    it("doesn't perform more transitions than requested", async () => {
      await this.jurorsRegistry.mockSetTimestamp(firstTermStart + termDuration * 100)
      await this.court.mockSetTimestamp(firstTermStart + termDuration * 100)
      await this.court.heartbeat(3)
      await assertEqualBN(this.court.getLastEnsuredTermId(), 3, 'current term')
    })
  })

  context('on regular court terms', () => {
    const term = 3

    const passTerms = async terms => {
      await this.court.mockIncreaseTime(terms * termDuration)
      await this.court.heartbeat(terms)

      assert.isFalse(await this.court.canTransitionTerm(), 'all terms transitioned')
    }

    beforeEach(async () => {
      await this.jurorsRegistry.mockSetTimestamp(firstTermStart)
      await this.court.mockSetTimestamp(firstTermStart)
      await this.court.heartbeat(1)

      await passTerms(2)

      await assertEqualBN(this.court.getLastEnsuredTermId(), term, 'term #3')
    })

    it('has correct term state', async () => {
      const [
        startTime,
        dependingDrafts,
        courtConfigId,
        randomnessBn
      ] = await this.court.terms(term)

      await assertEqualBN(startTime, firstTermStart + (term - 1) * termDuration, 'term start')
      await assertEqualBN(dependingDrafts, 0, 'depending drafts')
      await assertEqualBN(courtConfigId, 1, 'court config id')
      await assertEqualBN(randomnessBn, (await this.court.getBlockNumberExt()).toNumber() + 1, 'randomness bn')
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
