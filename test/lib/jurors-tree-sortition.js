const { assertBn, bn } = require('../helpers/numbers')
const { soliditySha3 } = require("web3-utils");

const JurorsTreeSortition = artifacts.require('JurorsTreeSortitionMock')

contract('JurorsTreeSortition', () => {
  let tree

  beforeEach('create tree', async () => {
    tree = await JurorsTreeSortition.new()
    await tree.init()
  })

  const expectedBounds = (selectedJurors, batchRequestedJurors, balances, totalRequestedJurors) => {
    const totalBalance = balances.reduce((acc, x) => acc + x, 0)

    const expectedLowBound = Math.floor(selectedJurors * totalBalance / totalRequestedJurors)
    const expectedHighBound = Math.floor((selectedJurors + batchRequestedJurors) * totalBalance / totalRequestedJurors)
    return { expectedLowBound, expectedHighBound }
  }

  describe('getSearchBatchBounds', () => {
    const termId = 2
    const totalRequestedJurors = 5
    const balances = [ 1, 2, 5, 3, 1 ]

    beforeEach('insert jurors active balances', async () => {
      await Promise.all(balances.map(b => tree.insert(termId, b)))
    })

    context('when querying a first batch', async () => {
      const selectedJurors = 0
      const batchRequestedJurors = 2

      const { expectedLowBound, expectedHighBound } = expectedBounds(selectedJurors, batchRequestedJurors, balances, totalRequestedJurors)

      it('includes the first juror', async () => {
        const { low, high } = await tree.getSearchBatchBounds(termId, selectedJurors, batchRequestedJurors, totalRequestedJurors)

        assert.equal(low.toString(), expectedLowBound, 'low bound does not match')
        assert.equal(high.toString(), expectedHighBound, 'high bound does not match')
      })
    })

    context('when querying a middle batch', async () => {
      const selectedJurors = 2
      const batchRequestedJurors = 2

      const { expectedLowBound, expectedHighBound } = expectedBounds(selectedJurors, batchRequestedJurors, balances, totalRequestedJurors)

      it('includes middle jurors', async () => {
        const { low, high } = await tree.getSearchBatchBounds(termId, selectedJurors, batchRequestedJurors, totalRequestedJurors)

        assert.equal(low.toString(), expectedLowBound, 'low bound does not match')
        assert.equal(high.toString(), expectedHighBound, 'high bound does not match')
      })
    })

    context('when querying a final batch', async () => {
      const selectedJurors = 4
      const batchRequestedJurors = 1

      const { expectedLowBound, expectedHighBound } = expectedBounds(selectedJurors, batchRequestedJurors, balances, totalRequestedJurors)

      it('includes the last juror', async () => {
        const { low, high } = await tree.getSearchBatchBounds(termId, selectedJurors, batchRequestedJurors, totalRequestedJurors)

        assert.equal(low.toString(), expectedLowBound, 'low bound does not match')
        assert.equal(high.toString(), expectedHighBound, 'high bound does not match')
      })
    })
  })

  // as jurors balances are sequential 0 to n, tree sum at position k is k(k+1)/2
  const getKey = (balance) => {
    return Math.ceil((Math.sqrt(1 + 8 * balance) - 1) / 2)
  }

  const simulateBachedRandomSearch = (
    termRandomness,
    disputeId,
    termId,
    selectedJurors,
    batchRequestedJurors,
    roundRequestedJurors,
    sortitionIteration,
    balances
  ) => {
    const { expectedLowBound, expectedHighBound } = expectedBounds(selectedJurors, batchRequestedJurors, balances, roundRequestedJurors)

    const expectedSumTreeBalances = simulateComputeSearchRandomBalances(termRandomness, disputeId, sortitionIteration, batchRequestedJurors, expectedLowBound, expectedHighBound)

    // as jurors balances are sequential 0 to n, ids and values are the same
    return expectedSumTreeBalances.map(b => b.toNumber()).map(b => getKey(b))
  }

  const simulateComputeSearchRandomBalances = (
    termRandomness,
    disputeId,
    sortitionIteration,
    batchRequestedJurors,
    lowActiveBalanceBatchBound,
    highActiveBalanceBatchBound
  ) => {
    let expectedSumTreeBalances = []
    const interval = bn(lowActiveBalanceBatchBound - highActiveBalanceBatchBound)
    for(let i = 0; i < batchRequestedJurors; i++) {
      const seed = soliditySha3(termRandomness, disputeId, sortitionIteration, i)
      const balance = bn(lowActiveBalanceBatchBound).add(web3.utils.toBN(seed).mod(interval))
      expectedSumTreeBalances.push(balance)
    }

    return expectedSumTreeBalances.sort((x, y) => x.sub(y).toNumber())
  }

  describe('computeSearchRandomBalances', () => {
    const termRandomness = '0x0000000000000000000000000000000000000000000000000000000000000000'
    const disputeId = 0
    const sortitionIteration = 0
    const batchRequestedJurors = 200
    const lowActiveBalanceBatchBound = 0
    const highActiveBalanceBatchBound = 10

    it('returns a ordered list of random balances', async () => {
      const balances = await tree.computeSearchRandomBalances(termRandomness, disputeId, sortitionIteration, batchRequestedJurors, lowActiveBalanceBatchBound, highActiveBalanceBatchBound)

      assert.equal(balances.length, batchRequestedJurors, 'list length does not match')
      for (let i = 0; i < batchRequestedJurors - 1; i++) {
        assert.isAtLeast(balances[i + 1].toNumber(), balances[i].toNumber(), `item ${i} is not ordered`)
        assert.isAtMost(balances[i].toNumber(), highActiveBalanceBatchBound, `item ${i} is not included in the requested interval`)
      }

      const expectedSumTreeBalances = simulateComputeSearchRandomBalances(termRandomness, disputeId, sortitionIteration, batchRequestedJurors, lowActiveBalanceBatchBound, highActiveBalanceBatchBound)
      for (let i = 0; i < batchRequestedJurors; i++) {
        assertBn(balances[i], expectedSumTreeBalances[i], `balance ${i} doesn't match`)
      }
    })
  })

  describe('batchedRandomSearch', () => {
    const termId = 0
    const disputeId = 0
    const sortitionIteration = 0
    const termRandomness = '0x0000000000000000000000000000000000000000000000000000000000000000'
    const balances = Array.from(Array(100).keys())

    beforeEach('insert values', async () => {
      for(let i = 0; i < 100; i++) await tree.insert(termId, balances[i])
    })

    context('for a first batch', () => {
      const selectedJurors = 0
      const batchRequestedJurors = 5
      const roundRequestedJurors = 10

      it('returns the expected results', async () => {
        const { jurorsIds, activeBalances } = await tree.batchedRandomSearch(termRandomness, disputeId, termId, selectedJurors, batchRequestedJurors, roundRequestedJurors, sortitionIteration)

        assert.equal(jurorsIds.length, batchRequestedJurors, 'result keys length does not match')
        assert.equal(activeBalances.length, batchRequestedJurors, 'result values length does not match')

        const expectedJurorIds = simulateBachedRandomSearch(termRandomness, disputeId, termId, selectedJurors, batchRequestedJurors, roundRequestedJurors, sortitionIteration, balances)

        for (let i = 0; i < batchRequestedJurors; i++) {
          assert.equal(jurorsIds[i].toString(), expectedJurorIds[i], `result key ${i} does not match`)
          assert.equal(activeBalances[i].toString(), expectedJurorIds[i], `result value ${i} does not match`)
        }
      })
    })

    context('for a second batch', () => {
      const selectedJurors = 5
      const batchRequestedJurors = 5
      const roundRequestedJurors = 10

      it('returns the expected results', async () => {
        const { jurorsIds, activeBalances } = await tree.batchedRandomSearch(termRandomness, disputeId, termId, selectedJurors, batchRequestedJurors, roundRequestedJurors, sortitionIteration)

        assert.equal(jurorsIds.length, batchRequestedJurors, 'result keys length does not match')
        assert.equal(activeBalances.length, batchRequestedJurors, 'result values length does not match')

        const expectedJurorIds = simulateBachedRandomSearch(termRandomness, disputeId, termId, selectedJurors, batchRequestedJurors, roundRequestedJurors, sortitionIteration, balances)

        for (let i = 0; i < batchRequestedJurors; i++) {
          assert.equal(jurorsIds[i].toString(), expectedJurorIds[i], `result key ${i} does not match`)
          assert.equal(activeBalances[i].toString(), expectedJurorIds[i], `result value ${i} does not match`)
        }
      })
    })
  })
})
