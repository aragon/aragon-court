const { bn } = require('./numbers')
const { soliditySha3, toBN } = require('web3-utils')

const expectedBounds = ({ selectedJurors, batchRequestedJurors, balances, totalRequestedJurors }) => {
  const totalBalance = balances.reduce((total, balance) => total.add(balance), bn(0))

  const expectedLowBound = bn(selectedJurors).mul(bn(totalBalance)).div(bn(totalRequestedJurors))
  const expectedHighBound = bn(selectedJurors).add(bn(batchRequestedJurors)).mul(bn(totalBalance)).div(bn(totalRequestedJurors))
  return { expectedLowBound, expectedHighBound }
}

const simulateComputeSearchRandomBalances = ({
  termRandomness,
  disputeId,
  sortitionIteration,
  batchRequestedJurors,
  lowActiveBalanceBatchBound,
  highActiveBalanceBatchBound
}) => {
  let expectedSumTreeBalances = []
  const interval = highActiveBalanceBatchBound.sub(lowActiveBalanceBatchBound)
  for (let i = 0; i < batchRequestedJurors; i++) {
    if (interval.eq(bn(0))) expectedSumTreeBalances.push(lowActiveBalanceBatchBound)
    else {
      const seed = soliditySha3(termRandomness, disputeId, sortitionIteration, i)
      const balance = bn(lowActiveBalanceBatchBound).add(toBN(seed).mod(interval))
      expectedSumTreeBalances.push(balance)
    }
  }

  return expectedSumTreeBalances.sort((x, y) => x.lt(y) ? -1 : 1)
}

const simulateBatchedRandomSearch = ({
  termRandomness,
  disputeId,
  selectedJurors,
  batchRequestedJurors,
  roundRequestedJurors,
  sortitionIteration,
  balances,
  getTreeKey
}) => {
  const { expectedLowBound, expectedHighBound } = expectedBounds({
    selectedJurors,
    batchRequestedJurors,
    balances,
    totalRequestedJurors: roundRequestedJurors
  })

  const expectedSumTreeBalances = simulateComputeSearchRandomBalances({
    termRandomness,
    disputeId,
    sortitionIteration,
    batchRequestedJurors,
    lowActiveBalanceBatchBound: expectedLowBound,
    highActiveBalanceBatchBound: expectedHighBound
  })

  // as jurors balances are sequential 0 to n, ids and values are the same
  return expectedSumTreeBalances
    .map(balance => getTreeKey(balances, balance))
    .filter(key => key !== undefined)
}

const simulateDraft = ({
  termRandomness,
  disputeId,
  selectedJurors,
  batchRequestedJurors,
  roundRequestedJurors,
  sortitionIteration,
  jurors,
  draftLockAmount,
  getTreeKey
}) => {
  const balances = jurors.map(juror => juror.activeBalance)

  const MAX_ITERATIONS = 10
  let draftedKeys = []
  let iteration = sortitionIteration
  let jurorsLeft = batchRequestedJurors

  while (jurorsLeft > 0 && iteration < MAX_ITERATIONS) {
    const iterationDraftedKeys = simulateBatchedRandomSearch({
      termRandomness,
      disputeId,
      selectedJurors,
      batchRequestedJurors,
      roundRequestedJurors,
      sortitionIteration: iteration,
      balances,
      getTreeKey
    })

    // remove locked jurors
    const filteredIterationDraftedKeys = iterationDraftedKeys
      .filter(key => {
        const { unlockedActiveBalance } = jurors[key]
        const enoughBalance = unlockedActiveBalance.gte(draftLockAmount)
        if (enoughBalance) jurors[key].unlockedActiveBalance = unlockedActiveBalance.sub(draftLockAmount)
        return enoughBalance
      })
      .slice(0, jurorsLeft)

    iteration++
    jurorsLeft -= filteredIterationDraftedKeys.length
    draftedKeys = draftedKeys.concat(filteredIterationDraftedKeys)
  }

  return draftedKeys.map(key => jurors[key].address)
}

module.exports = {
  expectedBounds,
  simulateComputeSearchRandomBalances,
  simulateBatchedRandomSearch,
  simulateDraft
}
