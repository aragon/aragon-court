const { assertRevert } = require('@aragon/os/test/helpers/assertThrow')
const { soliditySha3 } = require('web3-utils')

const TokenFactory = artifacts.require('TokenFactory')
const CourtMock = artifacts.require('CourtMock')

const COURT = 'Court'
const MINIME = 'MiniMeToken'
const CRVoting = artifacts.require('CRVoting')
const SumTree = artifacts.require('HexSumTreeWrapper')

const getLog = (receipt, logName, argName) =>
  receipt.logs.find(({ event }) => event == logName).args[argName]

const deployedContract = async (receipt, name) =>
  artifacts.require(name).at(getLog(await receipt, 'Deployed', 'addr'))

const assertEqualBN = async (actualPromise, expected, message) =>
  assert.equal((await actualPromise).toNumber(), expected, message)

const ERROR_INVALID_ACCOUNT_STATE = 'COURT_INVALID_ACCOUNT_STATE'

contract('Court: Staking', ([ pleb, rich ]) => {
  const INITIAL_BALANCE = 1e6
  const NO_DATA = ''
  const ZERO_ADDRESS = '0x' + '00'.repeat(20)

  const termDuration = 10
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

    this.voting = await CRVoting.new()
    this.sumTree = await SumTree.new()

    this.court = await CourtMock.new(
      termDuration,
      this.anj.address,
      ZERO_ADDRESS, // no fees
      this.voting.address,
      this.sumTree.address,
      0,
      0,
      0,
      0,
      ZERO_ADDRESS,
      1,
      1,
      [ 1, 1, 1 ],
      1,
      finalRoundReduction
    )
  })

  const assertStaked = async (staker, amount, initialBalance, { recipient, initialStaked = 0 } = {}) => {
    await assertEqualBN(this.court.totalStakedFor(recipient ? recipient : staker), initialStaked + amount, 'staked amount')
    await assertEqualBN(this.court.totalStaked(), initialStaked + amount, 'rich stake')
    await assertEqualBN(this.anj.balanceOf(staker), initialBalance - amount, 'rich token balance')
    await assertEqualBN(this.anj.balanceOf(this.court.address), initialStaked + amount, 'court token balance')
  }

  it('stakes', async () => {
    const amount = 1000

    await this.anj.approve(this.court.address, amount, { from: rich })
    await this.court.stake(amount, NO_DATA, { from: rich })

    await assertStaked(rich, amount, INITIAL_BALANCE)
  })

  it('stakes using \'approveAndCall\'', async () => {
    const amount = 3000

    await this.anj.approveAndCall(this.court.address, amount, NO_DATA, { from: rich })

    await assertStaked(rich, amount, INITIAL_BALANCE)
  })

  it('stakes using \'stakeFor\'', async () => {
    const amount = 50

    await this.anj.approve(this.court.address, amount, { from: rich })
    await this.court.stakeFor(pleb, amount, NO_DATA, { from: rich })

    await assertStaked(rich, amount, INITIAL_BALANCE, { recipient: pleb })
  })

  context('staked tokens', () => {
    const amount = 6000

    beforeEach(async () => {
      await this.anj.approveAndCall(this.court.address, amount, NO_DATA, { from: rich })
      await assertStaked(rich, amount, INITIAL_BALANCE)
    })

    it('unstakes', async () => {
      const unstaking = amount / 3

      await this.court.unstake(unstaking, NO_DATA, { from: rich })

      await assertStaked(rich, -unstaking, INITIAL_BALANCE - amount, { initialStaked: amount })
    })

    it('unstakes using \'withdraw\'', async () => {
      const unstaking = amount / 4

      await this.court.withdraw(this.anj.address, unstaking, { from: rich })

      await assertStaked(rich, -unstaking, INITIAL_BALANCE - amount, { initialStaked: amount })
    })

    context('Being activated', () => {
      const passTerms = async terms => {
        await this.court.mock_timeTravel(terms * termDuration)
        await this.court.heartbeat(terms)
        assert.isFalse(await this.court.canTransitionTerm(), 'all terms transitioned')
      }

      beforeEach(async () => {
        await this.court.activate({ from: rich })
        await passTerms(1)
      })

      it('reverts if unstaking tokens at stake')

      it('reverts if unstaking while juror is active', async () => {
        await this.anj.approveAndCall(this.court.address, amount, NO_DATA, { from: rich })
        const unstaking = amount / 3
        await assertRevert(this.court.unstake(unstaking, NO_DATA, { from: rich }), ERROR_INVALID_ACCOUNT_STATE)
        // deactivate
        await this.court.deactivate({ from: rich })
        // still unable to withdraw, must pass to next term
        await assertRevert(this.court.unstake(unstaking, NO_DATA, { from: rich }), ERROR_INVALID_ACCOUNT_STATE)
        await passTerms(1)
        await this.court.unstake(unstaking, NO_DATA, { from: rich })
      })
    })

  })
})
