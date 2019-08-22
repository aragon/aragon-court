const { assertRevert } = require('@aragon/os/test/helpers/assertThrow')
// TODO: add/modify aragonOS
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

contract('Court: final appeal', ([ poor, rich, governor, juror1, juror2, juror3, juror4, juror5, juror6, juror7 ]) => {
  const jurors = [ juror1, juror2, juror3, juror4, juror5, juror6, juror7 ]
  const NO_DATA = ''
  const ZERO_ADDRESS = '0x' + '00'.repeat(20)
  const SETTLE_BATCH_SIZE = 40
  const APPEAL_STEP_FACTOR = 3
  const MAX_REGULAR_APPEAL_ROUNDS = 4
  let MAX_JURORS_PER_DRAFT_BATCH

  const termDuration = 10
  const firstTermStart = 10
  const jurorMinStake = 200
  const commitTerms = 1
  const revealTerms = 1
  const appealTerms = 1
  const appealConfirmTerms = 1
  const penaltyPct = 100 // 100‱ = 1%
  const finalRoundReduction = 3300 // 100‱ = 1%

  const initialBalance = 1e6
  const richStake = 1000
  const jurorGenericStake = 800

  const NEW_DISPUTE_EVENT = 'NewDispute'
  const JUROR_ACTIVATED = 'JurorActivated'
  const JUROR_DEACTIVATED = 'JurorDeactivated'
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
  const ERROR_INVALID_ADJUDICATION_ROUND = 'CTBAD_ADJ_ROUND'

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
      [ commitTerms, revealTerms, appealTerms, appealConfirmTerms ],
      [ penaltyPct, finalRoundReduction ],
      APPEAL_STEP_FACTOR,
      MAX_REGULAR_APPEAL_ROUNDS,
      [ 0, 0, 0, 0, 0 ]
    )

    MAX_JURORS_PER_DRAFT_BATCH = (await this.court.getMaxJurorsPerDraftBatch.call()).toNumber()

    // TODO: use more realistic term duration and first term start time values
    await this.court.mockSetTimestamp(1)
    await this.jurorsRegistry.mockSetTimestamp(1)

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
    await this.jurorsRegistry.mockIncreaseTime(terms * termDuration)
    await this.court.mockIncreaseTime(terms * termDuration)
    await this.court.heartbeat(terms)

    assert.isFalse(await this.court.canTransitionTerm(), 'all terms transitioned')
  }

  // TODO: Fix when making the court settings configurable
  context.skip('Max number of regular appeals', () => {
    it('Can change number of regular appeals', async () => {
      const newMaxAppeals = MAX_REGULAR_APPEAL_ROUNDS + 1
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

    const draftAdjudicationRound = async (roundJurors) => {
      let roundJurorsDrafted = 0
      let draftReceipt

      // advance two blocks to ensure we can compute term randomness
      await this.court.mockAdvanceBlocks(2)

      while (roundJurorsDrafted < roundJurors) {
        draftReceipt = await this.court.draftAdjudicationRound(disputeId)
        const callJurorsDrafted = getLogCount(draftReceipt, this.jurorsRegistry.abi, JUROR_DRAFTED_EVENT)
        roundJurorsDrafted += callJurorsDrafted
      }
      await assertLogs(draftReceipt, DISPUTE_STATE_CHANGED_EVENT)
    }

    const moveForwardToFinalRound = async () => {
      await passTerms(2) // term = 3, dispute init
      await this.court.mockAdvanceBlocks(1)

      for (let roundId = 0; roundId < MAX_REGULAR_APPEAL_ROUNDS; roundId++) {
        let roundJurors = initialJurorNumber * (APPEAL_STEP_FACTOR ** roundId)
        if (roundJurors % 2 == 0) {
          roundJurors++
        }
        // draft
        await draftAdjudicationRound(roundJurors)

        // commit
        await passTerms(commitTerms)

        // reveal
        await passTerms(revealTerms)

        // appeal
        const appealReceipt = await this.court.appeal(disputeId, roundId, appealRuling)
        assertLogs(appealReceipt, RULING_APPEALED_EVENT)
        await passTerms(appealTerms)
        const appealConfirmReceipt = await this.court.appealConfirm(disputeId, roundId, appealConfirmRuling)
        assertLogs(appealConfirmReceipt, RULING_APPEAL_CONFIRMED_EVENT)
        const nextRoundId = getLog(appealConfirmReceipt, RULING_APPEAL_CONFIRMED_EVENT, 'roundId')
        voteId = getVoteId(disputeId, nextRoundId)
        await passTerms(appealConfirmTerms)
        await this.court.mockAdvanceBlocks(1)
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
      await this.anj.approve(this.jurorsRegistry.address, jurorMinStake, { from: rich })
      await this.jurorsRegistry.stakeFor(poor, jurorMinStake, NO_DATA, { from: rich })
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
      await assertRevert(this.court.appeal(disputeId, MAX_REGULAR_APPEAL_ROUNDS, appealRuling), ERROR_INVALID_ADJUDICATION_STATE)
    })

    context('Rewards and slashes', () => {
      const penalty = jurorMinStake * penaltyPct / 10000
      const weight = jurorGenericStake / jurorMinStake

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
        for (let roundId = 0; roundId <= MAX_REGULAR_APPEAL_ROUNDS; roundId++) {
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
          const receiptPromise = this.court.settleReward(disputeId, MAX_REGULAR_APPEAL_ROUNDS, jurors[i], { from: jurors[i] })
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
