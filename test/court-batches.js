const { assertRevert } = require('@aragon/os/test/helpers/assertThrow')
// TODO: add/modify aragonOS
const { decodeEventsOfType } = require('./helpers/decodeEvent')
const { soliditySha3 } = require('web3-utils')

const TokenFactory = artifacts.require('TokenFactory')
const CourtMock = artifacts.require('CourtMock')
const CourtAccounting = artifacts.require('CourtAccounting')
const CourtStakingMock = artifacts.require('CourtStakingMock')
const CRVoting = artifacts.require('CRVoting')
const Subscriptions = artifacts.require('SubscriptionsMock')
const SumTree = artifacts.require('HexSumTreeWrapper')

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

contract('Court: Batches', ([ rich, governor, arbitrable, juror1, juror2, juror3, juror4, juror5, juror6, juror7 ]) => {
  const NO_DATA = ''
  const ZERO_ADDRESS = '0x' + '00'.repeat(20)
  let MAX_JURORS_PER_DRAFT_BATCH

  const termDuration = 10
  const firstTermStart = 10
  const jurorMinStake = 10
  const startBlock = 1000
  const commitTerms = 1
  const revealTerms = 1
  const appealTerms = 1
  const penaltyPct = 1000 // 100‱ = 1%
  const finalRoundReduction = 3300 // 100‱ = 1%

  const initialBalance = 1e6
  const richStake = 1000
  const juror1Stake = 1000
  const jurorGenericStake = 500

  const NEW_DISPUTE_EVENT = 'NewDispute'
  const JUROR_DRAFTED_EVENT = 'JurorDrafted'
  const DISPUTE_STATE_CHANGED_EVENT = 'DisputeStateChanged'
  const ROUND_SLASHING_SETTLED_EVENT = 'RoundSlashingSettled'

  const ERROR_TERM_RANDOMNESS_UNAVAIL = 'CTRANDOM_UNAVAIL'

  const SALT = soliditySha3('passw0rd')

  before(async () => {
    this.tokenFactory = await TokenFactory.new()
  })

  beforeEach(async () => {
    // Mints 1,000,000 tokens for sender
    this.anj = await deployedContract(this.tokenFactory.newToken('ANJ', initialBalance, { from: rich }), MINIME)
    await assertEqualBN(this.anj.balanceOf(rich), initialBalance, 'rich balance')

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

    MAX_JURORS_PER_DRAFT_BATCH = (await this.court.getMaxJurorsPerDraftBatch.call()).toNumber()

    assert.equal(await this.staking.token(), this.anj.address, 'court token')
    //assert.equal(await this.court.jurorToken(), this.anj.address, 'court juror token')
    await assertEqualBN(this.staking.mock_treeTotalSum(), 0, 'empty sum tree')

    await this.anj.approveAndCall(this.staking.address, richStake, NO_DATA, { from: rich })

    await this.anj.approve(this.staking.address, juror1Stake, { from: rich })
    await this.staking.stakeFor(juror1, juror1Stake, NO_DATA, { from: rich })
    for (let juror of [ juror2, juror3, juror4, juror5, juror6, juror7 ]) {
      await this.anj.approve(this.staking.address, jurorGenericStake, { from: rich })
      await this.staking.stakeFor(juror, jurorGenericStake, NO_DATA, { from: rich })
    }

    await assertEqualBN(this.staking.totalStakedFor(rich), richStake, 'rich stake')
    await assertEqualBN(this.staking.totalStakedFor(juror1), juror1Stake, 'juror1 stake')
    for (let juror of [ juror2, juror3, juror4, juror5, juror6, juror7 ]) {
      await assertEqualBN(this.staking.totalStakedFor(juror), jurorGenericStake, 'juror stake')
    }
  })

  const passTerms = async terms => {
    await this.staking.mock_timeTravel(terms * termDuration)
    await this.court.mock_timeTravel(terms * termDuration)
    await this.court.heartbeat(terms)
    await this.court.mock_blockTravel(1)
    assert.isFalse(await this.court.canTransitionTerm(), 'all terms transitioned')
  }

  context('on multiple draft batches', () => {
    let jurors
    const term = 3
    const rulings = 2
    let disputeId, voteId
    const firstRoundId = 0

    const createDispute = async () => {
      for (const juror of [ juror1, juror2, juror3, juror4, juror5, juror6, juror7 ]) {
        await this.staking.activate({ from: juror })
      }
      await passTerms(1) // term = 1

      jurors = Math.round(MAX_JURORS_PER_DRAFT_BATCH * 7 / 2)
      const receipt = await this.court.createDispute(arbitrable, rulings, jurors, term)
      await assertLogs(receipt, NEW_DISPUTE_EVENT)
      disputeId = getLog(receipt, NEW_DISPUTE_EVENT, 'disputeId')
      voteId = getLog(receipt, NEW_DISPUTE_EVENT, 'voteId')
      await passTerms(2) // term = 3
      await this.court.mock_blockTravel(1)
    }

    context('hijacked', () => {
      beforeEach(async () => {
        // tree searches always return jurors in the order that they were added to the tree
        await this.staking.mock_hijackTreeSearch()
        await createDispute()
      })

      const expectedWeight = (index, availableJurors, requestedJurors) => {
        const q = Math.floor(requestedJurors / availableJurors)
        const r = requestedJurors % availableJurors
        return q + (index < r ? 1 : 0)
      }

      const checkWeights = async (jurorsRequestedHistory) => {
        const expectedJurors = [ juror1, juror2, juror3, juror4, juror5, juror6, juror7 ]

        for (const [ draftId, juror ] of expectedJurors.entries()) {
          const weight = (await this.court.getJurorWeight.call(disputeId, firstRoundId, juror)).toNumber()
          assert.equal(
            weight,
            jurorsRequestedHistory.reduce(
              (acc, cur) => acc + expectedWeight(draftId, expectedJurors.length, cur),
              0
            ),
            `wrong weight for juror #${draftId}, ${juror}`
          )
        }
      }

      const checkAdjudicationState = async (disputeId, roundId, initialTermId, termsPassed) => {
        const states = [
          {
            name: "Invalid",
            state: 0,
            offset: -1
          },
          {
            name: "Commit",
            state: 1,
            offset: 0
          },
          {
            name: "Reveal",
            state: 2,
            offset: commitTerms
          },
          {
            name: "Appealable",
            state: 3,
            offset: commitTerms + revealTerms
          },
          {
            name: "Ended",
            state: 4,
            offset: commitTerms + revealTerms + appealTerms
          }
        ]
        const isDraftingOver = await this.court.areAllJurorsDrafted.call(disputeId, firstRoundId)
        const baseTermId = isDraftingOver ? initialTermId + termsPassed : initialTermId
        for (const state of states) {
          const stateResult = (await this.court.getAdjudicationState(disputeId, roundId, baseTermId + state.offset)).toNumber()
          assert.equal(stateResult, state.state, `Wrong state for ${state.name}`)
        }
      }

      it('selects expected jurors', async () => {
        let totalJurorsDrafted = 0
        let callsHistory = []
        await this.court.setTermRandomness()
        while(totalJurorsDrafted < jurors) {
          assert.isFalse(await this.court.areAllJurorsDrafted.call(disputeId, firstRoundId))
          const callJurorsDrafted = getLogCount(await this.court.draftAdjudicationRound(disputeId), this.staking.abi, JUROR_DRAFTED_EVENT)
          callsHistory.push(callJurorsDrafted)
          totalJurorsDrafted += callJurorsDrafted
          await checkWeights(callsHistory)
        }
        assert.isTrue(await this.court.areAllJurorsDrafted.call(disputeId, firstRoundId))
      })

      it('continues draft at a later term (missing batches)', async () => {
        let totalJurorsDrafted = 0
        let callsHistory = []
        const initialTermId = (await this.court.getTermId()).toNumber()
        let termsPassed = 0
        while(totalJurorsDrafted < jurors) {
          assert.isFalse(await this.court.areAllJurorsDrafted.call(disputeId, firstRoundId))
          await this.court.setTermRandomness()
          const callJurorsDrafted = getLogCount(await this.court.draftAdjudicationRound(disputeId), this.staking.abi, JUROR_DRAFTED_EVENT)
          callsHistory.push(callJurorsDrafted)
          totalJurorsDrafted += callJurorsDrafted
          await checkWeights(callsHistory)
          await checkAdjudicationState(disputeId, firstRoundId, initialTermId, termsPassed)
          await passTerms(1)
          termsPassed++
          await this.court.mock_blockTravel(1)
        }
        assert.isTrue(await this.court.areAllJurorsDrafted.call(disputeId, firstRoundId))
        assert.isTrue(termsPassed > 1, 'draft was not split')
      })


      it('needs to wait until next term if randomness is missing', async () => {
        // make sure we miss randomness
        await this.court.mock_blockTravel(257)
        await assertRevert(this.court.draftAdjudicationRound(disputeId), ERROR_TERM_RANDOMNESS_UNAVAIL)
        // move forward to next term
        await passTerms(1)
        await this.court.mock_blockTravel(1)
        // make sure now we do have randomness
        await this.court.setTermRandomness()
        const callJurorsDrafted = getLogCount(await this.court.draftAdjudicationRound(disputeId), this.staking.abi, JUROR_DRAFTED_EVENT)
        assert.isTrue(callJurorsDrafted > 0, 'no jurors were drafted in next term')
      })
    })

    context('not hijacked', () => {
      beforeEach(async () => {
        await createDispute()
      })

      it('selects expected juror amount', async () => {
        await this.court.setTermRandomness()
        // assuming jurors is not multiple of MAX_JURORS_PER_DRAFT_BATCH
        for (let i = 0; i < Math.floor(jurors / MAX_JURORS_PER_DRAFT_BATCH); i++) {
          const callJurorsDrafted = getLogCount(await this.court.draftAdjudicationRound(disputeId), this.staking.abi, JUROR_DRAFTED_EVENT)
          assert.equal(callJurorsDrafted, MAX_JURORS_PER_DRAFT_BATCH, `wrong number of jurors drafed on iteration #${i}`)
        }
        const callJurorsDrafted = getLogCount(await this.court.draftAdjudicationRound(disputeId), this.staking.abi, JUROR_DRAFTED_EVENT)
        assert.equal(callJurorsDrafted, jurors % MAX_JURORS_PER_DRAFT_BATCH, `wrong number of jurors drafed on iteration #{i}`)
      })
    })
  })

  context('on multiple settle batches', () => {
    let jurors
    const term = 3
    const rulings = 2
    let disputeId, voteId
    const firstRoundId = 0

    const createDispute = async () => {
      for (const juror of [juror1, juror2, juror3, juror4, juror5, juror6, juror7]) {
        await this.staking.activate({ from: juror })
      }
      await passTerms(1) // term = 1

      jurors = 50
      const receipt = await this.court.createDispute(arbitrable, rulings, jurors, term)
      await assertLogs(receipt, NEW_DISPUTE_EVENT)
      disputeId = getLog(receipt, NEW_DISPUTE_EVENT, 'disputeId')
      voteId = getLog(receipt, NEW_DISPUTE_EVENT, 'voteId')
      await passTerms(2) // term = 3
      await this.court.mock_blockTravel(1)
    }

    beforeEach(async () => {
      // tree searches always return jurors in the order that they were added to the tree
      await this.staking.mock_hijackTreeSearch()

      // create dispute
      await createDispute()

      // draft
      await this.court.setTermRandomness()

      let totalJurorsDrafted = 0
      while(totalJurorsDrafted < jurors) {
        assert.isFalse(await this.court.areAllJurorsDrafted.call(disputeId, firstRoundId))
        const callJurorsDrafted = getLogCount(await this.court.draftAdjudicationRound(disputeId), this.staking.abi, JUROR_DRAFTED_EVENT)
        totalJurorsDrafted += callJurorsDrafted
      }
      assert.isTrue(await this.court.areAllJurorsDrafted.call(disputeId, firstRoundId))
      await passTerms(3)
    })

    it('settles in 2 batches', async () => {
      const batchSize = 4
      await this.court.settleRoundSlashing(disputeId, firstRoundId, batchSize)
      assert.isFalse(await this.court.areAllJurorsSettled.call(disputeId, firstRoundId))
      const receipt = await this.court.settleRoundSlashing(disputeId, firstRoundId, batchSize)
      assertLogs(receipt, ROUND_SLASHING_SETTLED_EVENT)
      assert.isTrue(await this.court.areAllJurorsSettled.call(disputeId, firstRoundId))
    })
  })
})
