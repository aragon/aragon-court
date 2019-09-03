const { MAX_UINT256 } = require('../helpers/numbers')
const { assertRevert } = require('../helpers/assertThrow')

const Checkpointing = artifacts.require('CheckpointingMock')

contract('Checkpointing', () => {
  let checkpointing

  beforeEach('create tree', async () => {
    checkpointing = await Checkpointing.new()
  })

  const assertFetchedValue = async (time, expectedValue) => {
    for (const recentSearch of [true, false])
      assert.equal((await checkpointing.get(time, recentSearch)).toString(), expectedValue.toString(), 'value does not match')
  }

  describe('add', () => {
    context('when the given value is can be represented by 192 bits', () => {
      const value = 100

      context('when there was no value registered yet', async () => {
        context('when the given time is zero', async () => {
          const time = 0

          it('adds the new value', async () => {
            await checkpointing.add(time, value)

            await assertFetchedValue(time, value)
          })
        })

        context('when the given time is greater than zero', async () => {
          const time = 1

          it('adds the new value', async () => {
            await checkpointing.add(time, value)

            await assertFetchedValue(time, value)
          })
        })
      })

      context('when there were some values already registered', async () => {
        beforeEach('add some values', async () => {
          await checkpointing.add(30, 1)
          await checkpointing.add(50, 2)
          await checkpointing.add(90, 3)
        })

        context('when the given time is previous to the latest registered value', async () => {
          const time = 40

          it('reverts', async () => {
            await assertRevert(checkpointing.add(time, value), 'CHECKPOINT_CANNOT_ADD_PAST_VALUE')
          })
        })

        context('when the given time is equal to the latest registered value', async () => {
          const time = 90

          it('updates the already registered value', async () => {
            await checkpointing.add(time, value)

            await assertFetchedValue(time, value)
            await assertFetchedValue(time + 1, value)
          })
        })

        context('when the given time is after the latest registered value', async () => {
          const time = 95

          it('adds the new last value', async () => {
            const previousLast = await checkpointing.getLast()

            await checkpointing.add(time, value)

            await assertFetchedValue(time, value)
            await assertFetchedValue(time + 1, value)
            await assertFetchedValue(time - 1, previousLast)
          })
        })
      })
    })

    context('when the given value cannot be represented by 192 bits', () => {
      const value = MAX_UINT256

      it('reverts', async () => {
        await assertRevert(checkpointing.add(0, value), 'CHECKPOINT_VALUE_TOO_BIG')
      })
    })
  })

  describe('getLast', () => {
    context('when there are no values registered yet', () => {
      it('returns zero', async () => {
        assert.equal((await checkpointing.getLast()).toString(), 0, 'value does not match')
      })
    })

    context('when there are values already registered', () => {
      beforeEach('add some values', async () => {
        await checkpointing.add(30, 1)
        await checkpointing.add(50, 2)
        await checkpointing.add(90, 3)
      })

      it('returns the last registered value', async () => {
        assert.equal((await checkpointing.getLast()).toString(), 3, 'value does not match')
      })
    })
  })

  describe('get', () => {
    context('when there are no values registered yet', () => {
      context('when there given time is zero', () => {
        const time = 0

        it('returns zero', async () => {
          await assertFetchedValue(time, 0)
        })
      })

      context('when there given time is greater than zero', () => {
        const time = 1

        it('returns zero', async () => {
          await assertFetchedValue(time, 0)
        })
      })
    })

    context('when there are values already registered', () => {
      beforeEach('add some values', async () => {
        await checkpointing.add(30, 1)
        await checkpointing.add(50, 2)
        await checkpointing.add(90, 3)
      })

      context('when there given time is zero', () => {
        const time = 0

        it('returns zero', async () => {
          await assertFetchedValue(time, 0)
        })
      })

      context('when the given time is previous to the time of first registered value', () => {
        const time = 10

        it('returns zero', async () => {
          await assertFetchedValue(time, 0)
        })
      })

      context('when the given time is equal to the time of first registered value', () => {
        const time = 30

        it('returns the first registered value', async () => {
          await assertFetchedValue(time, 1)
        })
      })

      context('when the given time is between the times of first and the second registered values', () => {
        const time = 40

        it('returns the first registered value', async () => {
          await assertFetchedValue(time, 1)
        })
      })

      context('when the given time is between the times of second and the third registered values', () => {
        const time = 60

        it('returns the second registered value', async () => {
          await assertFetchedValue(time, 2)
        })
      })

      context('when the given time is equal to the time of the third registered values', () => {
        const time = 90

        it('returns the third registered value', async () => {
          await assertFetchedValue(time, 3)
        })
      })

      context('when the given time is after the time of the third registered values', () => {
        const time = 100

        it('returns the third registered value', async () => {
          await assertFetchedValue(time, 3)
        })
      })
    })
  })
})
