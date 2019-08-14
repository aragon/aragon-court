const { ONE_DAY } = require('./helpers/time')
const { buildHelper } = require('./helpers/court')(web3, artifacts)
const { assertRevert } = require('@aragon/os/test/helpers/assertThrow')
const { SALT, encryptVote } = require('./helpers/crvoting')
// TODO: add/modify aragonOS
const { decodeEventsOfType } = require('./helpers/decodeEvent')

const TokenFactory = artifacts.require('TokenFactory')
const CourtAccounting = artifacts.require('CourtAccounting')
const JurorsRegistry = artifacts.require('JurorsRegistryMock')
const CRVoting = artifacts.require('CRVoting')
const Subscriptions = artifacts.require('SubscriptionsMock')

const MINIME = 'MiniMeToken'
const NO_DATA = ''
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

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

contract('Court: final appeal', ([ poor, rich, juror1, juror2, juror3, juror4, juror5, juror6, juror7 ]) => {
  const jurors = [ juror1, juror2, juror3, juror4, juror5, juror6, juror7 ]
  const SETTLE_BATCH_SIZE = 40
  let MAX_JURORS_PER_DRAFT_BATCH

  const termDuration = ONE_DAY
  const jurorsMinActiveBalance = 200
  const commitTerms = 1
  const revealTerms = 1
  const appealTerms = 1
  const appealConfirmTerms = 1
  const penaltyPct = 100 // 100‱ = 1%
  const appealStepFactor = 3
  const maxRegularAppealRounds = 4

  const initialBalance = 1e6
  const richStake = 1000
  const jurorGenericStake = 800

  const NEW_DISPUTE_EVENT = 'NewDispute'
  const JUROR_DRAFTED_EVENT = 'JurorDrafted'
  const DISPUTE_STATE_CHANGED_EVENT = 'DisputeStateChanged'
  const VOTE_COMMITTED_EVENT = 'VoteCommitted'
  const VOTE_REVEALED_EVENT = 'VoteRevealed'
  const RULING_APPEALED_EVENT = 'RulingAppealed'
  const RULING_APPEAL_CONFIRMED_EVENT = 'RulingAppealConfirmed'
  const ROUND_SLASHING_SETTLED_EVENT = 'RoundSlashingSettled'
  const REWARD_SETTLED_EVENT = 'RewardSettled'

  const ERROR_ZERO_MAX_ROUNDS = 'COURT_ZERO_MAX_ROUNDS'
  const ERROR_INVALID_ADJUDICATION_STATE = 'CTBAD_ADJ_STATE'

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

    MAX_JURORS_PER_DRAFT_BATCH = (await this.court.getMaxJurorsPerDraftBatch.call()).toNumber()

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

  // TODO: Fix when making the court settings configurable
  context.skip('Max number of regular appeals', () => {
    it('Can change number of regular appeals', async () => {
      const newMaxAppeals = maxRegularAppealRounds + 1
      // set new max
      await this.court.setMaxRegularAppealRounds(newMaxAppeals)

      // create dispute
      const arbitrable = poor // it doesn't matter, just an address
      const jurorNumber = 3
      const term = 3
      const rulings = 2
      const receipt = await this.court.createDispute(arbitrable, rulings, jurorNumber, term)
      await assertLogs(receipt, NEW_DISPUTE_EVENT)
      const disputeId = getLog(receipt, NEW_DISPUTE_EVENT, 'disputeId')

      assertEqualBN(this.court.getMaxRegularAppealRounds(disputeId), newMaxAppeals, 'Max appeals number should macth')
    })

    it('Fails trying to change number of regular appeals to zero', async () => {
      // set new max
      await assertRevert(this.court.setMaxRegularAppealRounds(0), ERROR_ZERO_MAX_ROUNDS)
    })
  })

  context('Final appeal', () => {
    const initialJurorNumber = 3
    const term = 3
    const rulings = 2
    const appealRuling = 3
    const appealConfirmRuling = 4

    let disputeId = 0
    const firstRoundId = 0
    let voteId

    beforeEach(async () => {
      for (const juror of jurors) {
        await this.jurorsRegistry.activate(0, { from: juror })
      }
      await passTerms(1) // term = 1

      const arbitrable = poor // it doesn't matter, just an address
      const receipt = await this.court.createDispute(arbitrable, rulings, initialJurorNumber, term)
      await assertLogs(receipt, NEW_DISPUTE_EVENT)
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
      await assertLogs(draftReceipt, DISPUTE_STATE_CHANGED_EVENT)
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

        // commit
        await passTerms(commitTerms)

        // reveal
        await passTerms(revealTerms)

        // appeal
        const appealReceipt = await this.court.appeal(disputeId, roundId, appealRuling)
        assertLogs(appealReceipt, RULING_APPEALED_EVENT)
        await passTerms(appealTerms)
        const confirmAppealReceipt = await this.court.confirmAppeal(disputeId, roundId, appealConfirmRuling)
        assertLogs(confirmAppealReceipt, RULING_APPEAL_CONFIRMED_EVENT)
        const nextRoundId = getLog(confirmAppealReceipt, RULING_APPEAL_CONFIRMED_EVENT, 'roundId')
        voteId = getVoteId(disputeId, nextRoundId)
        await passTerms(appealConfirmTerms)
        await this.courtHelper.advanceBlocks(1)
      }
    }

    it('reaches final appeal, all jurors can vote', async () => {
      await moveForwardToFinalRound()
      const vote = 1
      for (const juror of jurors) {
        const receiptPromise = this.voting.commit(voteId, encryptVote(vote), { from: juror })
        await assertLogs(receiptPromise, VOTE_COMMITTED_EVENT)
      }
    })

    it('reaches final appeal, a juror with less than min stake can not vote', async () => {
      await this.anj.approve(this.jurorsRegistry.address, jurorsMinActiveBalance, { from: rich })
      await this.jurorsRegistry.stakeFor(poor, jurorsMinActiveBalance, NO_DATA, { from: rich })
      await this.jurorsRegistry.activate(0, { from: poor })

      // collect some tokens from poor account to act as a juror without enough balance
      await this.court.collect(poor, 1)

      await moveForwardToFinalRound()
      const vote = 1

      await assertRevert(this.voting.commit(voteId, encryptVote(vote), { from: poor }), 'CRV_COMMIT_DENIED_BY_OWNER')
    })

    it('fails appealing after final appeal', async () => {
      await moveForwardToFinalRound()

      // commit
      await passTerms(commitTerms)

      // reveal
      await passTerms(revealTerms)

      // appeal
      await assertRevert(this.court.appeal(disputeId, maxRegularAppealRounds, appealRuling), ERROR_INVALID_ADJUDICATION_STATE)
    })

    context('Rewards and slashes', () => {
      const penalty = jurorsMinActiveBalance * penaltyPct / 10000
      const weight = jurorGenericStake / jurorsMinActiveBalance

      // more than half of the jurors voting first option
      const winningJurors = Math.floor(jurors.length / 2) + 1

      beforeEach(async () => {
        await moveForwardToFinalRound()
        // vote
        const winningVote = 3
        const losingVote = 4

        // commit
        for (let i = 0; i < winningJurors; i++) {
          const receiptPromise = this.voting.commit(voteId, encryptVote(winningVote), { from: jurors[i] })
          await assertLogs(receiptPromise, VOTE_COMMITTED_EVENT)
        }
        for (let i = winningJurors; i < jurors.length; i++) {
          const receiptPromise = this.voting.commit(voteId, encryptVote(losingVote), { from: jurors[i] })
          await assertLogs(receiptPromise, VOTE_COMMITTED_EVENT)
        }

        await passTerms(commitTerms)

        // reveal
        for (let i = 0; i < winningJurors; i++) {
          const receiptPromise = this.voting.reveal(voteId, winningVote, SALT, { from: jurors[i] })
          await assertLogs(receiptPromise, VOTE_REVEALED_EVENT)
        }
        for (let i = winningJurors; i < jurors.length; i++) {
          const receiptPromise = this.voting.reveal(voteId, losingVote, SALT, { from: jurors[i] })
          await assertLogs(receiptPromise, VOTE_REVEALED_EVENT)
        }

        await passTerms(revealTerms)

        // settle
        for (let roundId = 0; roundId <= maxRegularAppealRounds; roundId++) {
          let roundSlashingEvent = 0
          while (roundSlashingEvent == 0) {
            const receiptPromise = await this.court.settleRoundSlashing(disputeId, roundId, SETTLE_BATCH_SIZE)
            roundSlashingEvent = getLogCount(receiptPromise, this.court.abi, ROUND_SLASHING_SETTLED_EVENT)
          }
        }
      })

      it('winning jurors get reward', async () => {
        for (let i = 0; i < winningJurors; i++) {
          const tokenBalance = (await this.anj.balanceOf(jurors[i])).toNumber()
          const courtBalance = (await this.jurorsRegistry.totalStakedFor(jurors[i])).toNumber()
          const receiptPromise = this.court.settleReward(disputeId, maxRegularAppealRounds, jurors[i], { from: jurors[i] })
          await assertLogs(receiptPromise, REWARD_SETTLED_EVENT)

          // as jurors are not withdrawing here, real token balance shouldn't change
          assert.equal(tokenBalance, (await this.anj.balanceOf(jurors[i])).toNumber(), `token balance doesn't match for juror ${i}`)

          const reward = Math.floor(penalty * jurors.length * weight / winningJurors)
          assert.equal(courtBalance + reward, (await this.jurorsRegistry.totalStakedFor(jurors[i])).toNumber(), `balance in court doesn't match for juror ${i}`)
        }
      })

      it('losers jurors have penalty', async () => {
        for (let i = winningJurors; i < initialJurorNumber; i++) {
          const tokenBalance = (await this.anj.balanceOf(jurors[i])).toNumber()
          const courtBalance = (await this.jurorsRegistry.totalStakedFor(jurors[i])).toNumber()
          const receiptPromise = this.court.settleFinalRounds(jurors[i], 2)
          await assertLogs(receiptPromise, REWARD_SETTLED_EVENT)

          // as jurors are not withdrawing here, real token balance shouldn't change
          assert.equal(tokenBalance, (await this.anj.balanceOf(jurors[i])).toNumber(), `token balance doesn't match for juror ${i}`)

          const weightedPenalty = Math.floor(penalty * (jurors.length - winningJurors) * weight / winningJurors)
          assert.equal(courtBalance + weightedPenalty, (await this.jurorsRegistry.totalStakedFor(jurors[i])).toNumber(), `balance in court doesn't match for juror ${i}`)
        }
      })
    })
  })
})
