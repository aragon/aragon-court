const JurorsTreeSortition = artifacts.require('JurorsTreeSortitionMock')

contract('JurorsTreeSortition', () => {
  let tree

  beforeEach('create tree', async () => {
    tree = await JurorsTreeSortition.new()
    await tree.init()
  })

  describe('getSearchBatchBounds', () => {
    const termId = 2
    const totalRequestedJurors = 5

    beforeEach('insert jurors active balances', async () => {
      await tree.insert(termId, 1)
      await tree.insert(termId, 2)
      await tree.insert(termId, 5)
      await tree.insert(termId, 3)
      await tree.insert(termId, 1)
    })

    context('when querying a first batch', async () => {
      const selectedJurors = 0
      const batchRequestedJurors = 2

      const expectedLowBound = 1
      const expectedHighBound = 4

      it('includes the first juror', async () => {
        const [low, high] = await tree.getSearchBatchBounds(termId, selectedJurors, batchRequestedJurors, totalRequestedJurors)

        assert.equal(low.toString(), expectedLowBound, 'low bound does not match')
        assert.equal(high.toString(), expectedHighBound, 'high bound does not match')
      })
    })

    context('when querying a middle batch', async () => {
      const selectedJurors = 2
      const batchRequestedJurors = 2

      const expectedLowBound = 5
      const expectedHighBound = 8

      it('includes middle jurors', async () => {
        const [low, high] = await tree.getSearchBatchBounds(termId, selectedJurors, batchRequestedJurors, totalRequestedJurors)

        assert.equal(low.toString(), expectedLowBound, 'low bound does not match')
        assert.equal(high.toString(), expectedHighBound, 'high bound does not match')
      })
    })

    context('when querying a final batch', async () => {
      const selectedJurors = 4
      const batchRequestedJurors = 1

      const expectedLowBound = 9
      const expectedHighBound = 12

      it('includes the last juror', async () => {
        const [low, high] = await tree.getSearchBatchBounds(termId, selectedJurors, batchRequestedJurors, totalRequestedJurors)

        assert.equal(low.toString(), expectedLowBound, 'low bound does not match')
        assert.equal(high.toString(), expectedHighBound, 'high bound does not match')
      })
    })
  })

  describe('computeRandomBalance', () => {
    const seed = '0x0000000000000000000000000000000000000000000000000000000000000000'
    const lowActiveBalanceBatchBound = 0
    const activeBalanceInterval = 10

    it('returns a random balance included in the given interval', async () => {
      assert.equal(await tree.computeRandomBalance(seed,   4, lowActiveBalanceBatchBound, activeBalanceInterval), 0, '4th juror should trigger balance 0')
      assert.equal(await tree.computeRandomBalance(seed,   8, lowActiveBalanceBatchBound, activeBalanceInterval), 1, '8th juror should trigger balance 1')
      assert.equal(await tree.computeRandomBalance(seed,  25, lowActiveBalanceBatchBound, activeBalanceInterval), 2, '25th juror should trigger balance 2')
      assert.equal(await tree.computeRandomBalance(seed,  32, lowActiveBalanceBatchBound, activeBalanceInterval), 3, '32nd juror should trigger balance 3')
      assert.equal(await tree.computeRandomBalance(seed,  39, lowActiveBalanceBatchBound, activeBalanceInterval), 4, '39th juror should trigger balance 4')
      assert.equal(await tree.computeRandomBalance(seed,  52, lowActiveBalanceBatchBound, activeBalanceInterval), 5, '52nd juror should trigger balance 5')
      assert.equal(await tree.computeRandomBalance(seed,  60, lowActiveBalanceBatchBound, activeBalanceInterval), 6, '60th juror should trigger balance 6')
      assert.equal(await tree.computeRandomBalance(seed,  68, lowActiveBalanceBatchBound, activeBalanceInterval), 7, '68th juror should trigger balance 7')
      assert.equal(await tree.computeRandomBalance(seed,  75, lowActiveBalanceBatchBound, activeBalanceInterval), 8, '75th juror should trigger balance 8')
      assert.equal(await tree.computeRandomBalance(seed, 107, lowActiveBalanceBatchBound, activeBalanceInterval), 9, '107th juror should trigger balance 9')
    })
  })

  describe('computeSearchRandomBalances', () => {
    const seed = '0x0000000000000000000000000000000000000000000000000000000000000000'
    const batchRequestedJurors = 200
    const lowActiveBalanceBatchBound = 0
    const highActiveBalanceBatchBound = 10

    it('returns a ordered list of random balances', async () => {
      const balances = await tree.computeSearchRandomBalances(seed, batchRequestedJurors, lowActiveBalanceBatchBound, highActiveBalanceBatchBound)

      assert.equal(balances.length, batchRequestedJurors, 'list length does not match')
      for (let i = 0; i < batchRequestedJurors - 1; i++) {
        assert.isAtLeast(balances[i+1].toNumber(), balances[i].toNumber(), `item ${i} is not ordered`)
        assert.isAtMost(balances[i].toNumber(), highActiveBalanceBatchBound, `item ${i} is not included in the requested interval`)
      }
    })
  })

  describe('batchedRandomSearch', () => {
    const termId = 0
    const disputeId = 0
    const sortitionIteration = 0
    const termRandomness = '0x0000000000000000000000000000000000000000000000000000000000000000'

    beforeEach('insert values', async () => {
      for(let value = 0; value < 100; value++) await tree.insert(termId, value)
    })

    context('for a first batch', () => {
      const selectedJurors = 0
      const batchRequestedJurors = 5
      const roundRequestedJurors = 10

      it('returns the expected results', async () => {
        const [jurorIds, activeBalances] = await tree.batchedRandomSearch(termRandomness, disputeId, termId, selectedJurors, batchRequestedJurors, roundRequestedJurors, sortitionIteration)

        assert.equal(jurorIds.length, batchRequestedJurors, 'result keys length does not match')
        assert.equal(activeBalances.length, batchRequestedJurors, 'result values length does not match')

        assert.equal(jurorIds[0].toString(), 35, 'first result key does not match')
        assert.equal(activeBalances[0].toString(), 35, 'first result value does not match')

        assert.equal(jurorIds[1].toString(), 38, 'second result key does not match')
        assert.equal(activeBalances[1].toString(), 38, 'second result value does not match')

        assert.equal(jurorIds[2].toString(), 38, 'third result key does not match')
        assert.equal(activeBalances[2].toString(), 38, 'third result value does not match')

        assert.equal(jurorIds[3].toString(), 68, 'fourth result key does not match')
        assert.equal(activeBalances[3].toString(), 68, 'fourth result value does not match')

        assert.equal(jurorIds[4].toString(), 68, 'fifth result key does not match')
        assert.equal(activeBalances[4].toString(), 68, 'fifth result value does not match')
      })
    })

    context('for a second batch', () => {
      const selectedJurors = 5
      const batchRequestedJurors = 5
      const roundRequestedJurors = 10

      it('returns the expected results', async () => {
        const [jurorIds, activeBalances] = await tree.batchedRandomSearch(termRandomness, disputeId, termId, selectedJurors, batchRequestedJurors, roundRequestedJurors, sortitionIteration)

        assert.equal(jurorIds.length, batchRequestedJurors, 'result keys length does not match')
        assert.equal(activeBalances.length, batchRequestedJurors, 'result values length does not match')

        assert.equal(jurorIds[0].toString(), 78, 'first result key does not match')
        assert.equal(activeBalances[0].toString(), 78, 'first result value does not match')

        assert.equal(jurorIds[1].toString(), 80, 'second result key does not match')
        assert.equal(activeBalances[1].toString(), 80, 'second result value does not match')

        assert.equal(jurorIds[2].toString(), 80, 'third result key does not match')
        assert.equal(activeBalances[2].toString(), 80, 'third result value does not match')

        assert.equal(jurorIds[3].toString(), 98, 'fourth result key does not match')
        assert.equal(activeBalances[3].toString(), 98, 'fourth result value does not match')

        assert.equal(jurorIds[4].toString(), 98, 'fifth result key does not match')
        assert.equal(activeBalances[4].toString(), 98, 'fifth result value does not match')
      })
    })
  })
})
