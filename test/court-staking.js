const { assertRevert } = require('@aragon/os/test/helpers/assertThrow')
const { soliditySha3 } = require('web3-utils')

const TokenFactory = artifacts.require('TokenFactory')
const CourtMock = artifacts.require('CourtMock')

const COURT = 'Court'
const MINIME = 'MiniMeToken'
const CourtStakingMock = artifacts.require('CourtStakingMock')
const CRVoting = artifacts.require('CRVoting')
const SumTree = artifacts.require('HexSumTreeWrapper')
const Subscriptions = artifacts.require('SubscriptionsMock')
const CourtFinalRound = artifacts.require('CourtFinalRound')

const getLog = (receipt, logName, argName) =>
  receipt.logs.find(({ event }) => event == logName).args[argName]

const deployedContract = async (receipt, name) =>
  artifacts.require(name).at(getLog(await receipt, 'Deployed', 'addr'))

const assertEqualBN = async (actualPromise, expected, message) =>
  assert.equal((await actualPromise).toNumber(), expected, message)

const ERROR_INVALID_ACCOUNT_STATE = 'STK_INVALID_ACCOUNT_STATE'
const ERROR_WRONG_TOKEN = 'STK_WRONG_TOKEN'

contract('Court: Staking', ([ pleb, rich, governor ]) => {
  const INITIAL_BALANCE = 1e6
  const NO_DATA = ''
  const ZERO_ADDRESS = '0x' + '00'.repeat(20)

  const termDuration = 10
  const firstTermStart = 10
  const jurorMinStake = 10
  const startBlock = 1000
  const commitTerms = 1
  const revealTerms = 1
  const appealTerms = 1
  const penaltyPct = 100 // 100‱ = 1%
  const finalRoundReduction = 3300 // 100‱ = 1%

  const SALT = soliditySha3('passw0rd')

  before(async () => {
    this.tokenFactory = await TokenFactory.new()
  })

  beforeEach(async () => {
    // Mints 1,000,000 tokens for sender
    this.anj = await deployedContract(this.tokenFactory.newToken('ANJ', INITIAL_BALANCE, { from: rich }), MINIME)
    await assertEqualBN(this.anj.balanceOf(rich), INITIAL_BALANCE, 'rich balance')
    await assertEqualBN(this.anj.balanceOf(pleb), 0, 'pleb balance')

    this.staking = await CourtStakingMock.new()
    this.voting = await CRVoting.new()
    this.sumTree = await SumTree.new()
    this.subscriptions = await Subscriptions.new()
    await this.subscriptions.setUpToDate(true)
    this.finalRound = await CourtFinalRound.new()

    this.court = await CourtMock.new(
      termDuration,
      firstTermStart,
      ZERO_ADDRESS, // no fees
      [ 0, 0, 0, 0 ],
      governor,
      [ commitTerms, appealTerms, revealTerms ],
      penaltyPct
    )

    await this.court.init(
      this.staking.address,
      this.voting.address,
      this.sumTree.address,
      this.subscriptions.address,
      this.finalRound.address,
      this.anj.address,
      jurorMinStake,
      finalRoundReduction,
      [ 0, 0, 0, 0, 0 ]
    )
  })

  const assertStaked = async (staker, amount, initialBalance, { recipient, initialStaked = 0 } = {}) => {
    await assertEqualBN(this.staking.totalStakedFor(recipient ? recipient : staker), initialStaked + amount, 'staked amount')
    await assertEqualBN(this.staking.totalStaked(), initialStaked + amount, 'rich stake')
    await assertEqualBN(this.anj.balanceOf(staker), initialBalance - amount, 'rich token balance')
    await assertEqualBN(this.anj.balanceOf(this.staking.address), initialStaked + amount, 'court token balance')
  }

  it('stakes', async () => {
    const amount = 1000

    await this.anj.approve(this.staking.address, amount, { from: rich })
    await this.staking.stake(amount, NO_DATA, { from: rich })

    await assertStaked(rich, amount, INITIAL_BALANCE)
  })

  it('stakes using \'approveAndCall\'', async () => {
    const amount = 3000

    await this.anj.approveAndCall(this.staking.address, amount, NO_DATA, { from: rich })

    await assertStaked(rich, amount, INITIAL_BALANCE)
  })

  it('stakes using \'stakeFor\'', async () => {
    const amount = 50

    await this.anj.approve(this.staking.address, amount, { from: rich })
    await this.staking.stakeFor(pleb, amount, NO_DATA, { from: rich })

    await assertStaked(rich, amount, INITIAL_BALANCE, { recipient: pleb })
  })

  context('staked tokens', () => {
    const amount = 6000

    beforeEach(async () => {
      await this.anj.approveAndCall(this.staking.address, amount, NO_DATA, { from: rich })
      await assertStaked(rich, amount, INITIAL_BALANCE)
    })

    it('unstakes', async () => {
      const unstaking = amount / 3

      await this.staking.unstake(unstaking, NO_DATA, { from: rich })

      await assertStaked(rich, -unstaking, INITIAL_BALANCE - amount, { initialStaked: amount })
    })

    it('fails unstaking using \'withdraw\'', async () => {
      const unstaking = amount / 4

      await assertRevert(this.staking.withdraw(this.anj.address, unstaking, { from: rich }), ERROR_WRONG_TOKEN)

    })

    context('Being activated', () => {
      const passTerms = async terms => {
        await this.staking.mock_timeTravel(terms * termDuration)
        await this.court.mock_timeTravel(terms * termDuration)
        await this.court.heartbeat(terms)
        assert.isFalse(await this.court.canTransitionTerm(), 'all terms transitioned')
      }

      beforeEach(async () => {
        await this.staking.activate({ from: rich })
        await passTerms(1)
      })

      it('reverts if unstaking tokens at stake')

      it('reverts if unstaking while juror is active', async () => {
        await this.anj.approveAndCall(this.staking.address, amount, NO_DATA, { from: rich })
        const unstaking = amount / 3
        await assertRevert(this.staking.unstake(unstaking, NO_DATA, { from: rich }), ERROR_INVALID_ACCOUNT_STATE)
        // deactivate
        await this.staking.deactivate({ from: rich })
        // still unable to withdraw, must pass to next term
        await assertRevert(this.staking.unstake(unstaking, NO_DATA, { from: rich }), ERROR_INVALID_ACCOUNT_STATE)
        await passTerms(1)
        await this.staking.unstake(unstaking, NO_DATA, { from: rich })
      })
    })
  })
})
