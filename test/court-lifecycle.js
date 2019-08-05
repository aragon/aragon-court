const { assertRevert } = require('@aragon/os/test/helpers/assertThrow')
const { promisify } = require('util')
const { soliditySha3 } = require('web3-utils')

const TokenFactory = artifacts.require('TokenFactory')
const CourtMock = artifacts.require('CourtMock')
const CourtAccounting = artifacts.require('CourtAccounting')
const CourtStakingMock = artifacts.require('CourtStakingMock')
const CRVoting = artifacts.require('CRVoting')
const SumTree = artifacts.require('HexSumTreeWrapper')
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
  const MAX_UINT64 = 2**64 - 1
  
  const termDuration = 10
  const firstTermStart = 15
  const jurorMinStake = 100
  const cooldown = 10
  const startBlock = 1000
  const commitTerms = 1
  const revealTerms = 1
  const appealTerms = 1
  const penaltyPct = 100 // 100‱ = 1%
  const finalRoundReduction = 3300 // 100‱ = 1%
  
  const initialBalance = 1e6
  const richStake = 1000
  const juror1Stake = 700
  const juror2Stake = 300

  const NEW_TERM_EVENT = 'NewTerm'
  const NEW_COURT_CONFIG_EVENT = 'NewCourtConfig'
  const ERROR_JUROR_TOKENS_AT_STAKE = 'STK_JUROR_TOKENS_AT_STAKE'

  const SALT = soliditySha3('passw0rd')

  before(async () => {
    this.tokenFactory = await TokenFactory.new()
  })

  beforeEach(async () => {
    // Mints 1,000,000 tokens for sender
    this.anj = await deployedContract(this.tokenFactory.newToken('ANJ', initialBalance, { from: rich }), MINIME)
    await assertEqualBN(this.anj.balanceOf(rich), initialBalance, 'rich balance')
    await assertEqualBN(this.anj.balanceOf(poor), 0, 'poor balance')

    this.staking = await CourtStakingMock.new()
    this.accounting = await CourtAccounting.new()
    this.voting = await CRVoting.new()
    this.sumTree = await SumTree.new()
    this.subscriptions = await Subscriptions.new()
    await this.subscriptions.setUpToDate(true)

    this.court = await CourtMock.new(
      termDuration,
      [ this.anj.address, ZERO_ADDRESS ], // no fees
      this.staking.address,
      this.accounting.address,
      this.voting.address,
      this.sumTree.address,
      this.subscriptions.address,
      [ 0, 0, 0, 0 ],
      governor,
      firstTermStart,
      jurorMinStake,
      [ commitTerms, appealTerms, revealTerms ],
      [ penaltyPct, finalRoundReduction ],
      [ 0, 0, 0, 0, 0 ]
    )

    await this.court.mock_setBlockNumber(startBlock)

    assert.equal(await this.staking.token(), this.anj.address, 'court token')
    //assert.equal(await this.staking.jurorToken(), this.anj.address, 'court juror token')
    await assertEqualBN(this.staking.mock_treeTotalSum(), 0, 'empty sum tree')
    
    await this.anj.approveAndCall(this.staking.address, richStake, NO_DATA, { from: rich })
    await this.anj.approve(this.staking.address, juror1Stake, { from: rich })
    await this.staking.stakeFor(juror1, juror1Stake, NO_DATA, { from: rich })
    await this.anj.approve(this.staking.address, juror2Stake, { from: rich })
    await this.staking.stakeFor(juror2, juror2Stake, NO_DATA, { from: rich })

    await assertEqualBN(this.staking.totalStakedFor(rich), richStake, 'rich stake')
    await assertEqualBN(this.staking.totalStakedFor(juror1), juror1Stake, 'juror1 stake')
    await assertEqualBN(this.staking.totalStakedFor(juror2), juror2Stake, 'juror2 stake')
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
      await assertEqualBN(this.court.termId(), 0, 'court term #0')
    })

    it('transitions to term #1 on heartbeat', async () => {
      await this.staking.mock_setTime(15)
      await this.court.mock_setTime(15)
      await assertLogs(this.court.heartbeat(1), NEW_TERM_EVENT)
      
      await assertEqualBN(this.court.termId(), 1, 'court term #1')
      const [
        startTime,
        dependingDraws,
        courtConfigId,
        randomnessBn
      ] = await this.court.terms(1)

      await assertEqualBN(startTime, firstTermStart, 'first term start')
      await assertEqualBN(dependingDraws, 0, 'depending draws')
      await assertEqualBN(courtConfigId, 1, 'court config id')
      await assertEqualBN(randomnessBn, startBlock + 1, 'randomeness bn')
    })

    it('can activate during period before heartbeat', async () => {
      await this.staking.mock_setTime(firstTermStart - 1)
      await this.court.mock_setTime(firstTermStart - 1)
      await this.staking.activate({ from: rich })

      await assertEqualBN(this.staking.mock_treeTotalSum(), richStake, 'total tree sum')
    })

    it('gets the correct account details after activation', async () => {
      const expectedToTerm = MAX_UINT64
      const expectedAtStake = 0
      const expectedSumTreeId = 1

      await this.staking.mock_setTime(firstTermStart - 1)
      await this.court.mock_setTime(firstTermStart - 1)
      await this.staking.activate({ from: rich })

      const [
        actualToTerm,
        actualAtStake,
        actualSumTreeId
      ] = await this.staking.getAccount(rich)

      await assertEqualBN(actualToTerm, expectedToTerm, 'incorrect account to term')
      await assertEqualBN(actualAtStake, expectedAtStake, 'incorrect account at stake')
      await assertEqualBN(actualSumTreeId, expectedSumTreeId, 'incorrect account sum tree id')
    })

    it('reverts if activating balance is below dust', async () => {
      await this.staking.mock_setTime(firstTermStart - 1)
      await this.court.mock_setTime(firstTermStart - 1)
      await assertRevert(this.staking.activate({ from: poor }), 'STK_TOKENS_BELOW_MIN_STAKE')
    })

    it("doesn't perform more transitions than requested", async () => {
      await this.staking.mock_setTime(firstTermStart + termDuration * 100)
      await this.court.mock_setTime(firstTermStart + termDuration * 100)
      await this.court.heartbeat(3)
      await assertEqualBN(this.court.termId(), 3, 'current term')
    })
  })

  context('on regular court terms', () => {
    const term = 3

    const passTerms = async terms => {
      await this.staking.mock_timeTravel(terms * termDuration)
      await this.court.mock_timeTravel(terms * termDuration)
      await this.court.heartbeat(terms)
      assert.isFalse(await this.court.canTransitionTerm(), 'all terms transitioned')
    }

    beforeEach(async () => {
      await this.staking.mock_setTime(firstTermStart)
      await this.court.mock_setTime(firstTermStart)
      await this.court.heartbeat(1)

      await passTerms(2)

      await assertEqualBN(this.court.termId(), term, 'term #3')
    })

    it('has correct term state', async () => {
      const [
        startTime,
        dependingDraws,
        courtConfigId,
        randomnessBn
      ] = await this.court.terms(term)

      await assertEqualBN(startTime, firstTermStart + (term - 1) * termDuration, 'term start')
      await assertEqualBN(dependingDraws, 0, 'depending draws')
      await assertEqualBN(courtConfigId, 1, 'court config id')
      await assertEqualBN(randomnessBn, startBlock + 1, 'randomeness bn')      
    })

    it('jurors can activate', async () => {
      await this.staking.activate({ from: juror1 })
      await this.staking.activate({ from: juror2 })

      await passTerms(1)

      assert.equal(await this.staking.mock_sortition(0), juror1, 'sortition start edge juror1')
      assert.equal(await this.staking.mock_sortition(juror1Stake / 2), juror1, 'sortition juror1')
      assert.equal(await this.staking.mock_sortition(juror1Stake - 1), juror1, 'sortition juror1 end edge')
      assert.equal(await this.staking.mock_sortition(juror1Stake), juror2, 'sortition juror2 start edge')
      assert.equal(await this.staking.mock_sortition(juror1Stake + juror2Stake / 2), juror2, 'sortition juror2')
      assert.equal(await this.staking.mock_sortition(juror1Stake + juror2Stake - 1), juror2, 'sortition juror2 end edge')

      await assertRevert(this.staking.mock_sortition(juror1Stake + juror2Stake), 'SUM_TREE_SORTITION_OUT_OF_BOUNDS')
      await assertEqualBN(this.staking.mock_treeTotalSum(), juror1Stake + juror2Stake, 'both jurors in the tree')
    })

    const activateDeactivate = async () => {
      await this.staking.activate({ from: juror1 })
      await this.staking.activate({ from: juror2 })
      await passTerms(1)
      await assertEqualBN(this.staking.mock_treeTotalSum(), juror1Stake + juror2Stake, 'both jurors in the tree')
      await this.staking.deactivate({ from: juror1 })
      await passTerms(1)
      await assertEqualBN(this.staking.mock_treeTotalSum(), juror2Stake, 'only juror2 in tree')
      await this.staking.deactivate({ from: juror2 })
      await passTerms(1)
      await assertEqualBN(this.staking.mock_treeTotalSum(), 0, 'no jurors in tree')
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

    it('fails trying to activate twice', async () => {
      await this.staking.activate({ from: juror1 })
      await passTerms(1)
      await assertEqualBN(this.staking.mock_treeTotalSum(), juror1Stake, 'juror is in the tree')
      await passTerms(1)
      await assertRevert(this.staking.activate({ from: juror1 }), 'STK_INVALID_ACCOUNT_STATE')
    })

    it('fails trying to deactivate twice', async () => {
      await activateDeactivate()
      await assertRevert(this.staking.deactivate({ from: juror1 }), 'STK_INVALID_ACCOUNT_STATE')
    })

    // TODO: refactor to use at stake tokens
    it.skip('juror can withdraw after cooldown', async () => {
      await this.staking.activate({ from: juror1 })
      await passTerms(1)
      await assertEqualBN(this.staking.mock_treeTotalSum(), juror1Stake, 'juror added to tree')
      await passTerms(1)
      await assertEqualBN(this.staking.mock_treeTotalSum(), 0, 'juror removed from to tree')
      
      await assertRevert(this.staking.unstake(1, NO_DATA, { from: juror1 }), ERROR_JUROR_TOKENS_AT_STAKE)

      await passTerms(cooldown + 1)
      await this.staking.unstake(juror1Stake, NO_DATA, { from: juror1 })

      await assertEqualBN(this.anj.balanceOf(juror1), juror1Stake, 'juror tokens withdrawn')
      await assertEqualBN(this.staking.totalStakedFor(juror1), 0, 'juror no longer staked')
      // TODO: state account check
    })
  })
})
