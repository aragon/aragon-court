const { bn, bigExp } = require('../helpers/numbers')
const { getEventArgument } = require('@aragon/test-helpers/events')

const HexSumTree = artifacts.require('HexSumTreeGasProfiler')

contract('HexSumTree', () => {
  let tree
  const CHILDREN = 16
  const BIG_KEY_HEIGHT = 27
  const BIG_KEY = bn(CHILDREN).pow(bn(BIG_KEY_HEIGHT))

  beforeEach(async () => {
    tree = await HexSumTree.new()
    await tree.init()
  })

  const itCostsAtMost = (expectedCost, call) => {
    it(`should cost up to ${expectedCost} gas`, async () => {
      const receipt = await call()
      const costs = getEventArgument(receipt, 'GasConsumed', 'gas').toNumber()
      console.log(`gas costs: ${costs}`)
      assert.isAtMost(costs, expectedCost)
    })
  }

  describe('gas costs', () => {
    describe('insert', () => {
      context('non increasing height', () => {
        context('small tree', () => {
          const expectedCost = 107e3

          itCostsAtMost(expectedCost, () => tree.insert(0, 10))
        })

        context('huge tree', () => {
          const expectedCost = 280e3

          itCostsAtMost(expectedCost, async () => {
            // mock huge next key
            const nextKey = BIG_KEY
            await tree.mockNextKey(0, nextKey)

            await tree.insert(0, 10)
            assert.equal((await tree.height()).toString(), 28, 'tree height does not match')
            return await tree.insert(0, 10)
          })
        })
      })

      context('increasing height', () => {
        context('small tree', () => {
          const expectedCost = 150e3

          itCostsAtMost(expectedCost, async () => {
            for (let i = 0; i < CHILDREN; i++) await tree.insert(0, 10)
            const receipt = await tree.insert(0, 10)
            assert.equal((await tree.height()).toString(), 2, 'tree height does not match')
            return receipt
          })
        })

        context('huge tree', () => {
          const expectedCost = 592e3

          itCostsAtMost(expectedCost, async () => {
            // mock huge next key
            const nextKey = bigExp(CHILDREN, 33).sub(bn(1))
            await tree.mockNextKey(0, nextKey)

            await tree.insert(0, 10)
            assert.equal((await tree.height()).toString(), 29, 'tree height does not match')
            return await tree.insert(0, 10)
          })
        })
      })
    })

    describe('set', () => {
      context('small tree', () => {
        const key = 0

        beforeEach('insert item', async () => {
          await tree.insert(0, 10)
        })

        context('previous registered checkpoint', () => {
          const setTime = 0
          const expectedCost = 19e3

          itCostsAtMost(expectedCost, () => tree.set(key, setTime, 50))
        })

        context('new registered checkpoint', () => {
          const setTime = 10
          const expectedCost = 59e3

          itCostsAtMost(expectedCost, () => tree.set(key, setTime, 50))
        })
      })

      context('huge tree', () => {
        const nextKey = BIG_KEY

        beforeEach('insert item', async () => {
          // mock huge next key
          await tree.mockNextKey(0, nextKey)
          await tree.insert(0, 10)
        })

        context('previous registered checkpoint', () => {
          const setTime = 0
          const expectedCost = 241e3

          itCostsAtMost(expectedCost, () => tree.set(nextKey, setTime, 50))
        })

        context('new registered checkpoint', () => {
          const setTime = 10
          const expectedCost = 816e3

          itCostsAtMost(expectedCost, () => tree.set(nextKey, setTime, 50))
        })
      })
    })

    describe('update', () => {
      context('small tree', () => {
        const key = 0

        beforeEach('insert item', async () => {
          await tree.insert(0, 10)
        })

        context('previous registered checkpoint', () => {
          const updateTime = 0
          const expectedCost = 19e3

          itCostsAtMost(expectedCost, () => tree.update(key, updateTime, 50, true))
        })

        context('new registered checkpoint', () => {
          const updateTime = 10
          const expectedCost = 59e3

          itCostsAtMost(expectedCost, () => tree.update(key, updateTime, 50, true))
        })
      })

      context('huge tree', () => {
        const nextKey = BIG_KEY

        beforeEach('insert item', async () => {
          // mock huge next key
          await tree.mockNextKey(0, nextKey)
          await tree.insert(0, 10)
        })

        context('previous registered checkpoint', () => {
          const updateTime = 0
          const expectedCost = 241e3

          itCostsAtMost(expectedCost, () => tree.update(nextKey, updateTime, 50, true))
        })

        context('new registered checkpoint', () => {
          const updateTime = 10
          const expectedCost = 816e3

          itCostsAtMost(expectedCost, () => tree.update(nextKey, updateTime, 50, true))
        })
      })
    })

    describe('search', () => {
      const mockNextKeyProgressively = async (exp) => {
        for (let i = 1; i <= exp; i++) {
          const nextKey = bn(CHILDREN).pow(bn(i))
          await tree.mockNextKey(i, nextKey)
        }
      }

      const value = 10
      const searchedValue = [value - 1]

      const updateMany = async (key, updateTimes) => {
        for (let time = 1; time <= updateTimes; time++) {
          await tree.set(key, time, value + time)
        }
      }

      context('searching one item', () => {
        context('small tree', () => {
          context('without checkpoints', () => {
            const expectedCost = 8e3

            itCostsAtMost(expectedCost, async () => {
              await tree.insert(0, value)

              return tree.search(searchedValue, 0)
            })
          })

          context('with checkpoints', () => {
            const updateTimes = 100
            const expectedCost = 20e3

            itCostsAtMost(expectedCost, async () => {
              await tree.insert(0, value)
              await updateMany(0, updateTimes)

              return tree.search(searchedValue, updateTimes - 10)
            })
          })
        })

        context('huge tree', () => {
          context('without checkpoints', () => {
            const expectedCost = 74e3

            itCostsAtMost(expectedCost, async () => {
              // mock huge next key
              const nextKey = BIG_KEY
              await tree.mockNextKey(0, nextKey)
              await tree.insert(0, value)

              return tree.search(searchedValue, 0)
            })
          })

          context('with checkpoints', () => {
            const updateTimes = 100
            const expectedCost = 256e3

            itCostsAtMost(expectedCost, async () => {
              // mock huge next key
              await mockNextKeyProgressively(BIG_KEY_HEIGHT)
              await tree.insert(0, value)
              await updateMany(0, updateTimes)

              return tree.search(searchedValue, updateTimes - 10)
            })
          })
        })
      })

      context('searching 10 items', () => {
        const value = 10
        const insertTimes = 20
        const searchValues = [3, 10, 15, 35, 50, 55, 70, 95, 110, 125]

        const insertMany = async (value, times) => {
          for (let i = 1; i <= times; i++) {
            await tree.insert(0, value * i)
          }
        }

        context('small tree', () => {
          context('without checkpoints', () => {
            const expectedCost = 22e3

            itCostsAtMost(expectedCost, async () => {
              await insertMany(value, insertTimes)

              return tree.search(searchValues, 0)
            })
          })

          context('with checkpoints', () => {
            const updateTimes = 100
            const expectedCost = 37e3

            itCostsAtMost(expectedCost, async () => {
              await insertMany(value, insertTimes)
              await updateMany(0, updateTimes)

              return tree.search(searchValues, updateTimes - 10)
            })
          })
        })

        context('huge tree', () => {
          context('without checkpoints', () => {
            const expectedCost = 116e3

            itCostsAtMost(expectedCost, async () => {
              // mock huge next key
              const nextKey = BIG_KEY
              await tree.mockNextKey(0, nextKey)
              await insertMany(value, insertTimes)

              return tree.search(searchValues, 0)
            })
          })

          context('with checkpoints', () => {
            const updateTimes = 100
            const expectedCost = 741e3

            itCostsAtMost(expectedCost, async () => {
              // mock huge next key
              await mockNextKeyProgressively(BIG_KEY_HEIGHT)
              await insertMany(value, insertTimes)
              await updateMany(0, updateTimes)

              return tree.search(searchValues, updateTimes - 10)
            })
          })
        })
      })
    })
  })
})
