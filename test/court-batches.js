const assertRevert = require('./helpers/assert-revert')

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

contract('Court: Batches', ([ rich, governor, arbitrable, juror1, juror2, juror3, juror4, juror5, juror6, juror7 ]) => {
  const NO_DATA = ''
  const ZERO_ADDRESS = '0x' + '00'.repeat(20)
  let MAX_JURORS_PER_BATCH

  const termDuration = 10
  const firstTermStart = 1
  const jurorMinStake = 10
  const startBlock = 1000
  const commitTerms = 1
  const revealTerms = 1
  const appealTerms = 1
  const penaltyPct = 100 // 100‱ = 1%

  const initialBalance = 1e6
  const richStake = 1000
  const juror1Stake = 1000
  const jurorGenericStake = 500

  const NEW_DISPUTE_EVENT = 'NewDispute'
  const JUROR_DRAFTED_EVENT = 'JurorDrafted'
  const DISPUTE_STATE_CHANGED_EVENT = 'DisputeStateChanged'

  before(async () => {
    this.tokenFactory = await TokenFactory.new()
  })

  beforeEach(async () => {
    // Mints 1,000,000 tokens for sender
    this.anj = await deployedContract(this.tokenFactory.newToken('ANJ', initialBalance, { from: rich }), MINIME)
    assertEqualBN(this.anj.balanceOf(rich), initialBalance, 'rich balance')

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
      0,
      governor,
      firstTermStart,
      jurorMinStake,
      [ commitTerms, appealTerms, revealTerms ],
      penaltyPct
    )

    MAX_JURORS_PER_BATCH = (await this.court.getMaxJurorsPerBatch.call()).toNumber()

    await this.voting.setOwner(this.court.address)

    await this.court.mock_setBlockNumber(startBlock)

    assert.equal(await this.court.token(), this.anj.address, 'court token')
    //assert.equal(await this.court.jurorToken(), this.anj.address, 'court juror token')
    await assertEqualBN(this.court.mock_treeTotalSum(), 0, 'empty sum tree')

    await this.anj.approveAndCall(this.court.address, richStake, NO_DATA, { from: rich })

    await this.anj.approve(this.court.address, juror1Stake, { from: rich })
    await this.court.stakeFor(juror1, juror1Stake, NO_DATA, { from: rich })
    for (let juror of [juror2, juror3, juror4, juror5, juror6, juror7]) {
      await this.anj.approve(this.court.address, jurorGenericStake, { from: rich })
      await this.court.stakeFor(juror, jurorGenericStake, NO_DATA, { from: rich })
    }

    await assertEqualBN(this.court.totalStakedFor(rich), richStake, 'rich stake')
    await assertEqualBN(this.court.totalStakedFor(juror1), juror1Stake, 'juror1 stake')
    for (let juror of [juror2, juror3, juror4, juror5, juror6, juror7]) {
      await assertEqualBN(this.court.totalStakedFor(juror), jurorGenericStake, 'juror stake')
    }
  })

  const passTerms = async terms => {
    await this.court.mock_timeTravel(terms * termDuration)
    await this.court.heartbeat(terms)
    await this.court.mock_blockTravel(1)
    assert.isFalse(await this.court.canTransitionTerm(), 'all terms transitioned')
  }

  context('on multiple batches', () => {
    let jurors
    const term = 3
    const rulings = 2
    let disputeId, voteId
    const firstRoundId = 0

    const createDispute = async () => {
      for (const juror of [juror1, juror2, juror3, juror4, juror5, juror6, juror7]) {
        await this.court.activate({ from: juror })
      }
      await passTerms(1) // term = 1

      jurors = Math.round(MAX_JURORS_PER_BATCH * 7 /2)
      const receipt = await this.court.createDispute(arbitrable, rulings, jurors, term)
      await assertLogs(receipt, NEW_DISPUTE_EVENT)
      disputeId = getLog(receipt, NEW_DISPUTE_EVENT, 'voteId')
      voteId = getLog(receipt, NEW_DISPUTE_EVENT, 'voteId')
      await passTerms(2) // term = 3

    }

    context('hijacked', () => {
      beforeEach(async () => {
        // tree searches always return jurors in the order that they were added to the tree
        await this.court.mock_hijackTreeSearch()
        await createDispute()
      })

      const expectedWeight = (index, availableJurors, requestedJurors) => {
        const q = Math.floor(requestedJurors / availableJurors)
        const r = requestedJurors % availableJurors
        return q + (index < r ? 1 : 0)
      }

      const checkWeights = async (jurorsRequestedHistory) => {
        const expectedJurors = [juror1, juror2, juror3, juror4, juror5, juror6, juror7]

        for (const [ draftId, juror ] of expectedJurors.entries()) {
          const weight = (await this.court.getJurorWeight.call(disputeId, firstRoundId, juror)).toNumber()
          assert.equal(
            weight,
            jurorsRequestedHistory.reduce(
              (acc, cur) => acc + expectedWeight(draftId, expectedJurors.length, cur),
              0
            ),
            `wrong weight for juror #${draftId}`
          )
        }
      }

      it('selects expected jurors', async () => {
        let totalJurorsDrafted = 0
        let callsHistory = []
        while(totalJurorsDrafted < jurors) {
          assert.isFalse(await this.court.areAllJurorsDrafted.call(disputeId, firstRoundId))
          const callJurorsDrafted = getLogCount(await this.court.draftAdjudicationRound(disputeId), JUROR_DRAFTED_EVENT)
          callsHistory.push(callJurorsDrafted)
          totalJurorsDrafted += callJurorsDrafted
          await checkWeights(callsHistory)
        }
        assert.isTrue(await this.court.areAllJurorsDrafted.call(disputeId, firstRoundId))
      })
    })

    context('not hijacked', () => {
      beforeEach(async () => {
        await createDispute()
      })

      it('selects expected juror amount', async () => {
        // assuming jurors is not multiple of MAX_JURORS_PER_BATCH
        for (let i = 0; i < Math.floor(jurors / MAX_JURORS_PER_BATCH); i++) {
          const callJurorsDrafted = getLogCount(await this.court.draftAdjudicationRound(disputeId), JUROR_DRAFTED_EVENT)
          assert.equal(callJurorsDrafted, MAX_JURORS_PER_BATCH, `wrong number of jurors drafed on iteration #${i}`)
        }
        const callJurorsDrafted = getLogCount(await this.court.draftAdjudicationRound(disputeId), JUROR_DRAFTED_EVENT)
        assert.equal(callJurorsDrafted, jurors % MAX_JURORS_PER_BATCH, `wrong number of jurors drafed on iteration #{i}`)
      })
    })
  })
})
