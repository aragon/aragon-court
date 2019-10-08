const { bn } = require('./numbers')
const { soliditySha3 } = require("web3-utils");

const expectedBounds = ({ selectedJurors, batchRequestedJurors, balances, totalRequestedJurors }) => {
  const totalBalance = balances.reduce((acc, x) => acc.add(x), bn(0))

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
  for(let i = 0; i < batchRequestedJurors; i++) {
    const seed = soliditySha3(termRandomness, disputeId, sortitionIteration, i)
    const balance = bn(lowActiveBalanceBatchBound).add(web3.utils.toBN(seed).mod(interval))
    expectedSumTreeBalances.push(balance)
  }

  return expectedSumTreeBalances.sort((x, y) => x.lt(y) ? -1 : 1)
}

const simulateBachedRandomSearch = ({
  termRandomness,
  disputeId,
  termId,
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
  return expectedSumTreeBalances.map(b => getTreeKey(balances, b))
}

const simulateDraft = ({
  termRandomness,
  disputeId,
  termId,
  selectedJurors,
  batchRequestedJurors,
  roundRequestedJurors,
  sortitionIteration,
  jurors,
  minUnlockedAmount,
  getTreeKey
}) => {
  const balances = jurors.map(juror => juror.activeBalance)

  const MAX_ITERATIONS = 20
  let draftedKeys = []
  let iteration = sortitionIteration
  let jurorsLeft = batchRequestedJurors
  let accumulatedSelectedJurors = selectedJurors
  while(jurorsLeft > 0 && iteration < MAX_ITERATIONS) {
    const iterationDraftedKeys = simulateBachedRandomSearch({
      termRandomness,
      disputeId,
      termId,
      selectedJurors: accumulatedSelectedJurors,
      batchRequestedJurors: jurorsLeft,
      roundRequestedJurors,
      sortitionIteration: iteration,
      balances,
      getTreeKey
    })
    // remove locked jurors
    const filteredIterationDraftedKeys = iterationDraftedKeys.filter(key => jurors[key].unlockedActiveBalance.gte(minUnlockedAmount)).slice(0, jurorsLeft)
    iteration++
    jurorsLeft -= filteredIterationDraftedKeys.length
    accumulatedSelectedJurors += filteredIterationDraftedKeys.length
    draftedKeys = draftedKeys.concat(filteredIterationDraftedKeys)
  }

  // we allow the simulation to "run out of gas" because we also want to test that
  // assert.notEqual(iteration, MAX_ITERATIONS, 'Out of gas reached')

  draftedKeys.sort()

  const draftedJurors = draftedKeys.reduce(
    (acc, key) => {
      if (acc.length > 0 && acc[acc.length - 1].key == key) {
        acc[acc.length - 1].weight++
      } else {
        acc.push({ key: key, address: jurors[key].address, weight: 1})
      }
      return acc
    },
    []
  )

  return draftedJurors
}

module.exports = {
  expectedBounds,
  simulateComputeSearchRandomBalances,
  simulateBachedRandomSearch,
  simulateDraft
}
