const { decodeEventsOfType } = require('./helpers/decodeEvent')
const { soliditySha3 } = require('web3-utils')

const TokenFactory = artifacts.require('TokenFactory')
const CourtMock = artifacts.require('CourtMock')
const CourtAccounting = artifacts.require('CourtAccounting')
const JurorsRegistry = artifacts.require('JurorsRegistryMock')
const CRVoting = artifacts.require('CRVoting')
const Subscriptions = artifacts.require('SubscriptionsMock')

const MINIME = 'MiniMeToken'

const getLog = (receipt, logName, argName) => {
  const log = receipt.logs.find(({ event }) => event == logName)
  return log ? log.args[argName] : null
}

const getLogCount = (receipt, contractAbi, eventName) =>
      decodeEventsOfType(receipt, contractAbi, eventName).length

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

contract('Court: final appeal (non-exact)', ([ poor, rich, governor, juror1, juror2, juror3 ]) => {
  const jurors = [ juror1, juror2, juror3 ]
  const NO_DATA = ''
  const ZERO_ADDRESS = '0x' + '00'.repeat(20)
  const SETTLE_BATCH_SIZE = 15
  let APPEAL_STEP_FACTOR
  const DECIMALS = 1e18

  const termDuration = 10
  const firstTermStart = 10
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
      [ commitTerms, appealTerms, revealTerms ],
      [ penaltyPct, finalRoundReduction ],
      4,
      [ 0, 0, 0, 0, 0 ]
    )

    APPEAL_STEP_FACTOR = (await this.court.getAppealStepFactor.call()).toNumber()

    await this.jurorsRegistry.mock_hijackTreeSearch()
    await this.court.mock_setBlockNumber(startBlock)

    assert.equal(await this.jurorsRegistry.token(), this.anj.address, 'court token')
    await assertEqualBN(this.jurorsRegistry.mock_treeTotalSum(), 0, 'empty sum tree')

    await this.anj.approveAndCall(this.jurorsRegistry.address, richStake, NO_DATA, { from: rich })

    for (let juror of jurors) {
      await this.anj.approve(this.jurorsRegistry.address, jurorGenericStake, { from: rich })
      await this.jurorsRegistry.stakeFor(juror, jurorGenericStake, NO_DATA, { from: rich })
    }

    await assertEqualBN(this.jurorsRegistry.totalStakedFor(rich), richStake, 'rich stake')
    for (let juror of jurors) {
      await assertEqualBN(this.jurorsRegistry.totalStakedFor(juror), jurorGenericStake, 'juror stake')
    }
  })

  const passTerms = async terms => {
    await this.jurorsRegistry.mock_timeTravel(terms * termDuration)
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
        await this.jurorsRegistry.activate(0, { from: juror })
      }
      await passTerms(1) // term = 1

      const arbitrable = poor // it doesn't matter, just an address
      const receipt = await this.court.createDispute(arbitrable, rulings, initialJurorNumber, term)
      assertLogs(receipt, NEW_DISPUTE_EVENT)
      disputeId = getLog(receipt, NEW_DISPUTE_EVENT, 'disputeId')
      voteId = getVoteId(disputeId, firstRoundId)
    })

    const draftAdjudicationRound = async (roundJurors) => {
      let roundJurorsDrafted = 0
      let draftReceipt

      await this.court.setTermRandomness()

      while (roundJurorsDrafted < roundJurors) {
        draftReceipt = await this.court.draftAdjudicationRound(disputeId)
        const callJurorsDrafted = getLogCount(draftReceipt, this.jurorsRegistry.abi, JUROR_DRAFTED_EVENT)
        roundJurorsDrafted += callJurorsDrafted
      }
      assertLogs(draftReceipt, DISPUTE_STATE_CHANGED_EVENT)
    }

    const vote = async (_voteId, _winningJurors) => {
      // vote
      const winningVote = 2
      const losingVote = 3

      // commit
      for (let i = 0; i < _winningJurors; i++) {
        const receipt = await this.voting.commitVote(_voteId, encryptVote(winningVote), { from: jurors[i] })
        assertLogs(receipt, VOTE_COMMITTED_EVENT)
      }
      for (let i = _winningJurors; i < jurors.length; i++) {
        const receipt = await this.voting.commitVote(_voteId, encryptVote(losingVote), { from: jurors[i] })
        assertLogs(receipt, VOTE_COMMITTED_EVENT)
      }
      await passTerms(commitTerms)

      // reveal
      for (let i = 0; i < _winningJurors; i++) {
        const receipt = await this.voting.revealVote(_voteId, winningVote, SALT, { from: jurors[i] })
        assertLogs(receipt, VOTE_REVEALED_EVENT)
      }
      for (let i = _winningJurors; i < jurors.length; i++) {
        const receipt = await this.voting.revealVote(_voteId, losingVote, SALT, { from: jurors[i] })
        assertLogs(receipt, VOTE_REVEALED_EVENT)
      }
      await passTerms(revealTerms)
    }

    const moveForwardToFinalRound = async () => {
      await passTerms(2) // term = 3, dispute init
      await this.court.mock_blockTravel(1)

      const maxRegularAppealRounds = (await this.court.getMaxRegularAppealRounds.call(disputeId)).toNumber()
      for (let roundId = 0; roundId < maxRegularAppealRounds; roundId++) {
        let roundJurors = initialJurorNumber * (APPEAL_STEP_FACTOR ** roundId)
        if (roundJurors % 2 == 0) {
          roundJurors++
        }
        // draft
        await draftAdjudicationRound(roundJurors)

        // all jurors vote for the winning side
        await vote(voteId, jurors.length)

        // appeal
        const appealReceipt = await this.court.appealRuling(disputeId, roundId)
        assertLogs(appealReceipt, RULING_APPEALED_EVENT)
        const nextRoundId = getLog(appealReceipt, RULING_APPEALED_EVENT, 'roundId')
        voteId = getVoteId(disputeId, nextRoundId)
        await passTerms(appealTerms)
        await this.court.mock_blockTravel(1)
      }

      return maxRegularAppealRounds
    }

    context('Rewards and slashes', () => {
      const penalty = jurorMinStake * penaltyPct / 10000
      const weight = jurorGenericStake / jurorMinStake

      const testFinalRound = async (_winningJurors) => {
        const maxRegularAppealRounds = await moveForwardToFinalRound()

        // final round
        await vote(voteId, _winningJurors)

        // settle
        for (let roundId = 0; roundId <= maxRegularAppealRounds; roundId++) {
          let roundSlashingEvent = 0
          while (roundSlashingEvent == 0) {
            const receipt = await this.court.settleRoundSlashing(disputeId, roundId, SETTLE_BATCH_SIZE)
            roundSlashingEvent = getLogCount(receipt, this.court.abi, ROUND_SLASHING_SETTLED_EVENT)
          }
        }

        // checks
        for (let i = 0; i < _winningJurors; i++) {
          const tokenBalance = (await this.anj.balanceOf(jurors[i])).toNumber()
          const courtBalance = (await this.jurorsRegistry.totalStakedFor(jurors[i])).toNumber()
          const receipt = await this.court.settleReward(disputeId, maxRegularAppealRounds, jurors[i])
          assertLogs(receipt, REWARD_SETTLED_EVENT)

          // as jurors are not withdrawing here, real token balance shouldn't change
          assert.equal(tokenBalance, (await this.anj.balanceOf(jurors[i])).toNumber(), `token balance doesn't match for juror ${i}`)

          const reward = Math.floor(penalty * jurors.length * weight / _winningJurors)
          assert.equal(courtBalance + reward, (await this.jurorsRegistry.totalStakedFor(jurors[i])).toNumber(), `balance in court doesn't match for juror ${i}`)
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
