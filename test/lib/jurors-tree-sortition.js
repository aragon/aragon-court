const { assertBn, bn } = require('../helpers/numbers')
const { assertRevert } = require('../helpers/assertThrow')
const { expectedBounds, simulateComputeSearchRandomBalances, simulateBatchedRandomSearch } = require('../helpers/registry')

const JurorsTreeSortition = artifacts.require('JurorsTreeSortitionMock')

contract('JurorsTreeSortition', () => {
  let tree

  // as jurors balances are sequential 0 to n, tree sum at position k is k(k+1)/2
  const getTreeKey = (balances, soughtBalance) => {
    return Math.ceil((Math.sqrt(1 + 8 * soughtBalance.toNumber()) - 1) / 2)
  }

  beforeEach('create tree', async () => {
    tree = await JurorsTreeSortition.new()
    await tree.init()
  })

  describe('getSearchBatchBounds', () => {
    const termId = 2
    const totalRequestedJurors = 5
    const balances = [ 1, 2, 5, 3, 1 ].map(x => bn(x))

    context('when there are no balances in the tree', () => {
      const selectedJurors = 0
      const batchRequestedJurors = 5

      it('returns zeroed values', async () => {
        const { low, high } = await tree.getSearchBatchBounds(termId, selectedJurors, batchRequestedJurors, totalRequestedJurors)

        assert.equal(low.toString(), 0, 'low bound does not match')
        assert.equal(high.toString(), 0, 'high bound does not match')
      })
    })

    context('when there are some balances in the tree', () => {
      beforeEach('insert jurors active balances', async () => {
        await Promise.all(balances.map(b => tree.insert(termId, b)))
      })

      context('when querying a first batch', async () => {
        const selectedJurors = 0
        const batchRequestedJurors = 2

        const { expectedLowBound, expectedHighBound } = expectedBounds({ selectedJurors, batchRequestedJurors, balances, totalRequestedJurors })

        it('includes the first juror', async () => {
          const { low, high } = await tree.getSearchBatchBounds(termId, selectedJurors, batchRequestedJurors, totalRequestedJurors)

          assert.equal(low.toString(), expectedLowBound, 'low bound does not match')
          assert.equal(high.toString(), expectedHighBound, 'high bound does not match')
        })
      })

      context('when querying a middle batch', async () => {
        const selectedJurors = 2
        const batchRequestedJurors = 2

        const { expectedLowBound, expectedHighBound } = expectedBounds({ selectedJurors, batchRequestedJurors, balances, totalRequestedJurors })

        it('includes middle jurors', async () => {
          const { low, high } = await tree.getSearchBatchBounds(termId, selectedJurors, batchRequestedJurors, totalRequestedJurors)

          assert.equal(low.toString(), expectedLowBound, 'low bound does not match')
          assert.equal(high.toString(), expectedHighBound, 'high bound does not match')
        })
      })

      context('when querying a final batch', async () => {
        const selectedJurors = 4
        const batchRequestedJurors = 1

        const { expectedLowBound, expectedHighBound } = expectedBounds({ selectedJurors, batchRequestedJurors, balances, totalRequestedJurors })

        it('includes the last juror', async () => {
          const { low, high } = await tree.getSearchBatchBounds(termId, selectedJurors, batchRequestedJurors, totalRequestedJurors)

          assert.equal(low.toString(), expectedLowBound, 'low bound does not match')
          assert.equal(high.toString(), expectedHighBound, 'high bound does not match')
        })
      })
    })
  })

  describe('computeSearchRandomBalances', () => {
    const termRandomness = '0x0000000000000000000000000000000000000000000000000000000000000000'
    const disputeId = 0
    const sortitionIteration = 0

    context('when the given bounds are zero', () => {
      const lowActiveBalanceBatchBound = bn(0)
      const highActiveBalanceBatchBound = bn(0)

      context('when the requested number of jurors is greater than zero', () => {
        const batchRequestedJurors = 200

        it('reverts', async () => {
          await assertRevert(tree.computeSearchRandomBalances(termRandomness, disputeId, sortitionIteration, batchRequestedJurors, lowActiveBalanceBatchBound, highActiveBalanceBatchBound), 'TREE_INVALID_INTERVAL_SEARCH')
        })
      })

      context('when the requested number of jurors is zero', () => {
        const batchRequestedJurors = 0

        it('reverts', async () => {
          await assertRevert(tree.computeSearchRandomBalances(termRandomness, disputeId, sortitionIteration, batchRequestedJurors, lowActiveBalanceBatchBound, highActiveBalanceBatchBound), 'TREE_INVALID_INTERVAL_SEARCH')
        })
      })
    })

    context('when the given bounds are not zero', () => {
      context('when the given bounds are equal', () => {
        const lowActiveBalanceBatchBound = bn(10)
        const highActiveBalanceBatchBound = bn(10)

        context('when the requested number of jurors is greater than zero', () => {
          const batchRequestedJurors = 200

          it('reverts', async () => {
            await assertRevert(tree.computeSearchRandomBalances(termRandomness, disputeId, sortitionIteration, batchRequestedJurors, lowActiveBalanceBatchBound, highActiveBalanceBatchBound), 'TREE_INVALID_INTERVAL_SEARCH')
          })
        })

        context('when the requested number of jurors is zero', () => {
          const batchRequestedJurors = 0

          it('reverts', async () => {
            await assertRevert(tree.computeSearchRandomBalances(termRandomness, disputeId, sortitionIteration, batchRequestedJurors, lowActiveBalanceBatchBound, highActiveBalanceBatchBound), 'TREE_INVALID_INTERVAL_SEARCH')
          })
        })
      })

      context('when the given bounds are not equal', () => {
        const lowActiveBalanceBatchBound = bn(0)
        const highActiveBalanceBatchBound = bn(10)

        context('when the requested number of jurors is greater than zero', () => {
          const batchRequestedJurors = 200

          it('returns a ordered list of random balances', async () => {
            const balances = await tree.computeSearchRandomBalances(termRandomness, disputeId, sortitionIteration, batchRequestedJurors, lowActiveBalanceBatchBound, highActiveBalanceBatchBound)

            assert.equal(balances.length, batchRequestedJurors, 'list length does not match')

            for (let i = 0; i < batchRequestedJurors - 1; i++) {
              assert.isAtLeast(balances[i + 1].toNumber(), balances[i].toNumber(), `item ${i} is not ordered`)
              assert.isAtMost(balances[i].toNumber(), highActiveBalanceBatchBound.toNumber(), `item ${i} is not included in the requested interval`)
            }

            const expectedSumTreeBalances = simulateComputeSearchRandomBalances({
              termRandomness,
              disputeId,
              sortitionIteration,
              batchRequestedJurors,
              lowActiveBalanceBatchBound,
              highActiveBalanceBatchBound
            })

            for (let i = 0; i < batchRequestedJurors; i++) {
              assertBn(balances[i], expectedSumTreeBalances[i], `balance ${i} doesn't match`)
            }
          })
        })

        context('when the requested number of jurors is zero', () => {
          const batchRequestedJurors = 0

          it('returns an empty list', async () => {
            const balances = await tree.computeSearchRandomBalances(termRandomness, disputeId, sortitionIteration, batchRequestedJurors, lowActiveBalanceBatchBound, highActiveBalanceBatchBound)

            assert.equal(balances.length, 0, 'list length does not match')
          })
        })
      })
    })
  })

  describe('batchedRandomSearch', () => {
    const termId = 0
    const disputeId = 0
    const sortitionIteration = 0
    const roundRequestedJurors = 10
    const termRandomness = '0x0000000000000000000000000000000000000000000000000000000000000000'

    context('when there are no balances in the tree', () => {
      const selectedJurors = 0
      const batchRequestedJurors = 5

      it('reverts', async () => {
        await assertRevert(tree.batchedRandomSearch(termRandomness, disputeId, termId, selectedJurors, batchRequestedJurors, roundRequestedJurors, sortitionIteration), 'TREE_INVALID_INTERVAL_SEARCH')
      })
    })

    context('when there are some balances in the tree', () => {
      const balances = Array.from(Array(100).keys()).map(x => bn(x))

      beforeEach('insert values', async () => {
        for(let i = 0; i < 100; i++) await tree.insert(termId, balances[i])
      })

      context('when the requested number of jurors is zero', () => {
        const selectedJurors = 0
        const batchRequestedJurors = 0

        it('reverts', async () => {
          await assertRevert(tree.batchedRandomSearch(termRandomness, disputeId, termId, selectedJurors, batchRequestedJurors, roundRequestedJurors, sortitionIteration), 'TREE_INVALID_INTERVAL_SEARCH')
        })
      })

      context('when the requested number of jurors is greater than zero', () => {
        context('for a first batch', () => {
          const selectedJurors = 0
          const batchRequestedJurors = 5

          it('returns the expected results', async () => {
            const { jurorsIds, activeBalances } = await tree.batchedRandomSearch(termRandomness, disputeId, termId, selectedJurors, batchRequestedJurors, roundRequestedJurors, sortitionIteration)

            assert.equal(jurorsIds.length, batchRequestedJurors, 'result keys length does not match')
            assert.equal(activeBalances.length, batchRequestedJurors, 'result values length does not match')

            const expectedJurorIds = simulateBatchedRandomSearch({
              termRandomness,
              disputeId,
              selectedJurors,
              batchRequestedJurors,
              roundRequestedJurors,
              sortitionIteration,
              balances,
              getTreeKey
            })

            for (let i = 0; i < batchRequestedJurors; i++) {
              assert.equal(jurorsIds[i].toString(), expectedJurorIds[i], `result key ${i} does not match`)
              assert.equal(activeBalances[i].toString(), expectedJurorIds[i], `result value ${i} does not match`)
            }
          })
        })

        context('for a second batch', () => {
          const selectedJurors = 5
          const batchRequestedJurors = 5

          it('returns the expected results', async () => {
            const { jurorsIds, activeBalances } = await tree.batchedRandomSearch(termRandomness, disputeId, termId, selectedJurors, batchRequestedJurors, roundRequestedJurors, sortitionIteration)

            assert.equal(jurorsIds.length, batchRequestedJurors, 'result keys length does not match')
            assert.equal(activeBalances.length, batchRequestedJurors, 'result values length does not match')

            const expectedJurorIds = simulateBatchedRandomSearch({
              termRandomness,
              disputeId,
              selectedJurors,
              batchRequestedJurors,
              roundRequestedJurors,
              sortitionIteration,
              balances,
              getTreeKey
            })

            for (let i = 0; i < batchRequestedJurors; i++) {
              assert.equal(jurorsIds[i].toString(), expectedJurorIds[i], `result key ${i} does not match`)
              assert.equal(activeBalances[i].toString(), expectedJurorIds[i], `result value ${i} does not match`)
            }
          })
        })
      })
    })
  })
})
