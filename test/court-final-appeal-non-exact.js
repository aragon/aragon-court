const { assertRevert } = require('@aragon/os/test/helpers/assertThrow')
const { soliditySha3 } = require('web3-utils')

const TokenFactory = artifacts.require('TokenFactory')
const CourtMock = artifacts.require('CourtMock')
const CRVoting = artifacts.require('CRVoting')
const SumTree = artifacts.require('HexSumTreeWrapper')

const MINIME = 'MiniMeToken'

const getLog = (receipt, logName, argName) => {
  const log = receipt.logs.find(({ event }) => event == logName)
  return log ? log.args[argName] : null
}

const getLogCount = (receipt, logName) => {
  const logs = receipt.logs.filter(l => l.event == logName)
  return logs.length
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

const getVoteId = (disputeId, roundId) => {
  return new web3.BigNumber(2).pow(128).mul(disputeId).add(roundId)
}

contract('Court: final appeal (non-exact)', ([ poor, rich, governor, juror1, juror2, juror3]) => {
  const jurors = [juror1, juror2, juror3]
  const NO_DATA = ''
  const ZERO_ADDRESS = '0x' + '00'.repeat(20)
  const SETTLE_BATCH_SIZE = 40
  let MAX_REGULAR_APPEAL_ROUNDS
  let APPEAL_STEP_FACTOR
  const DECIMALS = 1e18

  const termDuration = 10
  const firstTermStart = 1
  const jurorMinStake = new web3.BigNumber(10).mul(DECIMALS)
  const startBlock = 1000
  const commitTerms = 1
  const revealTerms = 1
  const appealTerms = 1
  const penaltyPct = 100 // 100‱ = 1%
  const finalRoundReduction = 3300 // 100‱ = 1%

  const initialBalance = new web3.BigNumber(1e6).mul(DECIMALS)
  const richStake = new web3.BigNumber(10000).mul(DECIMALS)
  const jurorGenericStake = new web3.BigNumber(15).mul(DECIMALS)

  const NEW_DISPUTE_EVENT = 'NewDispute'
  const JUROR_DRAFTED_EVENT = 'JurorDrafted'
  const DISPUTE_STATE_CHANGED_EVENT = 'DisputeStateChanged'
  const VOTE_COMMITTED_EVENT = 'VoteCommitted'
  const VOTE_REVEALED_EVENT = 'VoteRevealed'
  const RULING_APPEALED_EVENT = 'RulingAppealed'
  const ROUND_SLASHING_SETTLED_EVENT = 'RoundSlashingSettled'
  const REWARD_SETTLED_EVENT = 'RewardSettled'

  const SALT = soliditySha3('passw0rd')

  const encryptVote = (ruling, salt = SALT) =>
        soliditySha3(
          { t: 'uint8', v: ruling },
          { t: 'bytes32', v: salt }
        )

  const pct4 = (n, p) => n * p / 1e4

  before(async () => {
    this.tokenFactory = await TokenFactory.new()
  })

  beforeEach(async () => {
    // Mints 1,000,000 tokens for sender
    this.anj = await deployedContract(this.tokenFactory.newToken('ANJ', initialBalance, { from: rich }), MINIME)
    await assertEqualBN(this.anj.balanceOf(rich), initialBalance, 'rich balance')
    await assertEqualBN(this.anj.balanceOf(poor), 0, 'poor balance')

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
      governor,
      firstTermStart,
      jurorMinStake,
      [ commitTerms, appealTerms, revealTerms ],
      penaltyPct,
      finalRoundReduction
    )

    MAX_REGULAR_APPEAL_ROUNDS = (await this.court.getMaxRegularAppealRounds.call()).toNumber()
    APPEAL_STEP_FACTOR = (await this.court.getAppealStepFactor.call()).toNumber()

    await this.court.mock_hijackTreeSearch()
    await this.court.mock_setBlockNumber(startBlock)

    assert.equal(await this.court.token(), this.anj.address, 'court token')
    //assert.equal(await this.court.jurorToken(), this.anj.address, 'court juror token')
    await assertEqualBN(this.court.mock_treeTotalSum(), 0, 'empty sum tree')

    await this.anj.approveAndCall(this.court.address, richStake, NO_DATA, { from: rich })

    for (let juror of jurors) {
      await this.anj.approve(this.court.address, jurorGenericStake, { from: rich })
      await this.court.stakeFor(juror, jurorGenericStake, NO_DATA, { from: rich })
    }

    await assertEqualBN(this.court.totalStakedFor(rich), richStake, 'rich stake')
    for (let juror of jurors) {
      await assertEqualBN(this.court.totalStakedFor(juror), jurorGenericStake, 'juror stake')
    }
  })

  const passTerms = async terms => {
    await this.court.mock_timeTravel(terms * termDuration)
    await this.court.heartbeat(terms)
    await this.court.mock_blockTravel(1)
    assert.isFalse(await this.court.canTransitionTerm(), 'all terms transitioned')
  }

  context('Final appeal, non-exact stakes', () => {
    const initialJurorNumber = 3
    const term = 3
    const rulings = 2

    let disputeId = 0
    const firstRoundId = 0
    let voteId

    beforeEach(async () => {
      for (const juror of jurors) {
        await this.court.activate({ from: juror })
      }
      await passTerms(1) // term = 1

      const arbitrable = poor // it doesn't matter, just an address
      const receipt = await this.court.createDispute(arbitrable, rulings, initialJurorNumber, term)
      await assertLogs(receipt, NEW_DISPUTE_EVENT)
      disputeId = getLog(receipt, NEW_DISPUTE_EVENT, 'disputeId')
      voteId = getVoteId(disputeId, firstRoundId)
    })

    const draftAdjudicationRound = async (roundJurors) => {
      let roundJurorsDrafted = 0
      let draftReceipt

      await this.court.setTermRandomness()

      while (roundJurorsDrafted < roundJurors) {
        draftReceipt = await this.court.draftAdjudicationRound(disputeId)
        const callJurorsDrafted = getLogCount(draftReceipt, JUROR_DRAFTED_EVENT)
        roundJurorsDrafted += callJurorsDrafted
      }
      await assertLogs(draftReceipt, DISPUTE_STATE_CHANGED_EVENT)
    }

    const vote = async (_voteId, _winningJurors) => {
      // vote
      const winningVote = 2
      const losingVote = 3

      // commit
      for (let i = 0; i < _winningJurors; i++) {
        const receiptPromise = this.voting.commitVote(_voteId, encryptVote(winningVote), { from: jurors[i] })
        await assertLogs(receiptPromise, VOTE_COMMITTED_EVENT)
      }
      for (let i = _winningJurors; i < jurors.length; i++) {
        const receiptPromise = this.voting.commitVote(_voteId, encryptVote(losingVote), { from: jurors[i] })
        await assertLogs(receiptPromise, VOTE_COMMITTED_EVENT)
      }
      await passTerms(commitTerms)

      // reveal
      for (let i = 0; i < _winningJurors; i++) {
        const receiptPromise = this.voting.revealVote(_voteId, winningVote, SALT, { from: jurors[i] })
        await assertLogs(receiptPromise, VOTE_REVEALED_EVENT)
      }
      for (let i = _winningJurors; i < jurors.length; i++) {
        const receiptPromise = this.voting.revealVote(_voteId, losingVote, SALT, { from: jurors[i] })
        await assertLogs(receiptPromise, VOTE_REVEALED_EVENT)
      }
      await passTerms(revealTerms)
    }

    const moveForwardToFinalRound = async () => {
      await passTerms(2) // term = 3, dispute init
      await this.court.mock_blockTravel(1)

      for (let roundId = 0; roundId < MAX_REGULAR_APPEAL_ROUNDS; roundId++) {
        let roundJurors = initialJurorNumber * (APPEAL_STEP_FACTOR ** roundId)
        if (roundJurors % 2 == 0) {
          roundJurors++
        }
        // draft
        await draftAdjudicationRound(roundJurors)

        await vote(voteId, jurors.length)

        // appeal
        const appealReceipt = await this.court.appealRuling(disputeId, roundId)
        assertLogs(appealReceipt, RULING_APPEALED_EVENT)
        const nextRoundId = getLog(appealReceipt, RULING_APPEALED_EVENT, 'roundId')
        voteId = getVoteId(disputeId, nextRoundId)
        await passTerms(appealTerms)
        await this.court.mock_blockTravel(1)
      }
    }

    context('Rewards and slashes', () => {
      const penalty = jurorMinStake * penaltyPct / 10000
      const weight = jurorGenericStake / jurorMinStake

      const testFinalRound = async (_winningJurors) => {
        await moveForwardToFinalRound()

        // final round
        await vote(voteId, _winningJurors)

        // settle
        for (let roundId = 0; roundId <= MAX_REGULAR_APPEAL_ROUNDS; roundId++) {
          let roundSlashingEvent = 0
          while (roundSlashingEvent == 0) {
            const receiptPromise = await this.court.settleRoundSlashing(disputeId, roundId, SETTLE_BATCH_SIZE)
            roundSlashingEvent = getLogCount(receiptPromise, ROUND_SLASHING_SETTLED_EVENT)
          }
        }

        // checks
        for (let i = 0; i < _winningJurors; i++) {
          const tokenBalance = (await this.anj.balanceOf(jurors[i])).toNumber()
          const courtBalance = (await this.court.totalStakedFor(jurors[i])).toNumber()
          const receiptPromise = this.court.settleReward(disputeId, MAX_REGULAR_APPEAL_ROUNDS, jurors[i])
          await assertLogs(receiptPromise, REWARD_SETTLED_EVENT)

          // as jurors are not withdrawing here, real token balance shouldn't change
          assert.equal(tokenBalance, (await this.anj.balanceOf(jurors[i])).toNumber(), `token balance doesn't match for juror ${i}`)

          const reward = Math.floor(penalty * jurors.length * weight / _winningJurors)
          assert.equal(courtBalance + reward, (await this.court.totalStakedFor(jurors[i])).toNumber(), `balance in court doesn't match for juror ${i}`)
        }
      }

      it('all jurors are winning', async () => {
        await testFinalRound(jurors.length)
      })

      it('2/3 of jurors are winning', async () => {
        await testFinalRound(2)
      })
    })
  })
})
