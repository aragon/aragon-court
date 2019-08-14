const { bigExp } = require('./helpers/numbers')(web3)
const { ONE_DAY } = require('./helpers/time')
const { buildHelper } = require('./helpers/court')(web3, artifacts)
const { SALT, encryptVote } = require('./helpers/crvoting')
const { decodeEventsOfType } = require('./helpers/decodeEvent')

const TokenFactory = artifacts.require('TokenFactory')
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

const NO_DATA = ''
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

contract('Court: final appeal (non-exact)', ([ poor, rich, juror1, juror2, juror3 ]) => {
  const jurors = [ juror1, juror2, juror3 ]
  const SETTLE_BATCH_SIZE = 15

  const termDuration = ONE_DAY
  const jurorsMinActiveBalance = bigExp(10, 18)
  const commitTerms = 1
  const revealTerms = 1
  const appealTerms = 1
  const appealConfirmTerms = 1
  const penaltyPct = 100 // 100‱ = 1%
  const appealStepFactor = 3
  const maxRegularAppealRounds = 4

  const initialBalance = bigExp(1e6, 18)
  const richStake = bigExp(10000, 18)
  const jurorGenericStake = bigExp(15, 18)

  const NEW_DISPUTE_EVENT = 'NewDispute'
  const JUROR_DRAFTED_EVENT = 'JurorDrafted'
  const DISPUTE_STATE_CHANGED_EVENT = 'DisputeStateChanged'
  const VOTE_COMMITTED_EVENT = 'VoteCommitted'
  const VOTE_REVEALED_EVENT = 'VoteRevealed'
  const RULING_APPEALED_EVENT = 'RulingAppealed'
  const RULING_APPEAL_CONFIRMED_EVENT = 'RulingAppealConfirmed'
  const ROUND_SLASHING_SETTLED_EVENT = 'RoundSlashingSettled'
  const REWARD_SETTLED_EVENT = 'RewardSettled'

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
      feeToken: ZERO_ADDRESS,
      jurorToken: this.anj,
      voting: this.voting,
      accounting: this.accounting,
      subscriptions: this.subscriptions,
      jurorsRegistry: this.jurorsRegistry,
      termDuration,
      commitTerms,
      revealTerms,
      appealTerms,
      appealConfirmTerms,
      appealStepFactor,
      maxRegularAppealRounds,
      jurorsMinActiveBalance,
    })

    await this.jurorsRegistry.mockHijackTreeSearch()

    assert.equal(await this.jurorsRegistry.token(), this.anj.address, 'court token')
    await assertEqualBN(this.jurorsRegistry.totalActiveBalance(), 0, 'empty sum tree')

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
    await this.courtHelper.increaseTime(terms * termDuration)
    await this.court.heartbeat(terms)

    assert.isTrue((await this.court.neededTermTransitions()).eq(0), 'all terms transitioned')
  }

  context('Final appeal, non-exact stakes', () => {
    const initialJurorNumber = 3
    const term = 3
    const rulings = 2
    const winningVote = 3
    const losingVote = 4

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

    const draft = async (roundJurors) => {
      let roundJurorsDrafted = 0
      let draftReceipt

      // advance two blocks to ensure we can compute term randomness
      await this.courtHelper.advanceBlocks(2)

      while (roundJurorsDrafted < roundJurors) {
        draftReceipt = await this.court.draft(disputeId)
        const callJurorsDrafted = getLogCount(draftReceipt, this.jurorsRegistry.abi, JUROR_DRAFTED_EVENT)
        roundJurorsDrafted += callJurorsDrafted
      }
      assertLogs(draftReceipt, DISPUTE_STATE_CHANGED_EVENT)
    }

    const vote = async (_voteId, _winningJurors) => {
      // commit
      for (let i = 0; i < _winningJurors; i++) {
        const receipt = await this.voting.commit(_voteId, encryptVote(winningVote), { from: jurors[i] })
        assertLogs(receipt, VOTE_COMMITTED_EVENT)
      }
      for (let i = _winningJurors; i < jurors.length; i++) {
        const receipt = await this.voting.commit(_voteId, encryptVote(losingVote), { from: jurors[i] })
        assertLogs(receipt, VOTE_COMMITTED_EVENT)
      }
      await passTerms(commitTerms)

      // reveal
      for (let i = 0; i < _winningJurors; i++) {
        const receipt = await this.voting.reveal(_voteId, winningVote, SALT, { from: jurors[i] })
        assertLogs(receipt, VOTE_REVEALED_EVENT)
      }
      for (let i = _winningJurors; i < jurors.length; i++) {
        const receipt = await this.voting.reveal(_voteId, losingVote, SALT, { from: jurors[i] })
        assertLogs(receipt, VOTE_REVEALED_EVENT)
      }
      await passTerms(revealTerms)
    }

    const moveForwardToFinalRound = async () => {
      await passTerms(2) // term = 3, dispute init
      await this.courtHelper.advanceBlocks(1)

      for (let roundId = 0; roundId < maxRegularAppealRounds; roundId++) {
        let roundJurors = initialJurorNumber * (appealStepFactor ** roundId)
        if (roundJurors % 2 == 0) {
          roundJurors++
        }
        // draft
        await draft(roundJurors)

        // all jurors vote for the winning side
        await vote(voteId, jurors.length)

        // appeal
        const appealReceipt = await this.court.appeal(disputeId, roundId, losingVote)
        assertLogs(appealReceipt, RULING_APPEALED_EVENT)
        await passTerms(appealTerms)
        const confirmAppealReceipt = await this.court.confirmAppeal(disputeId, roundId, winningVote)
        assertLogs(confirmAppealReceipt, RULING_APPEAL_CONFIRMED_EVENT)
        const nextRoundId = getLog(confirmAppealReceipt, RULING_APPEAL_CONFIRMED_EVENT, 'roundId')
        voteId = getVoteId(disputeId, nextRoundId)
        await passTerms(appealConfirmTerms)
        await this.courtHelper.advanceBlocks(1)
      }
    }

    context('Rewards and slashes', () => {
      const penalty = jurorsMinActiveBalance * penaltyPct / 10000
      const weight = jurorGenericStake / jurorsMinActiveBalance

      const testFinalRound = async (_winningJurors) => {
        await moveForwardToFinalRound()

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
