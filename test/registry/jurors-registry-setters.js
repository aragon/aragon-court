const { bn, bigExp } = require('../helpers/numbers')
const { buildHelper } = require('../helpers/controller')(web3, artifacts)
const { assertRevert } = require('../helpers/assertThrow')
const { assertEvent, assertAmountOfEvents } = require('../helpers/assertEvent')

const JurorsRegistry = artifacts.require('JurorsRegistry')
const ERC20 = artifacts.require('ERC20Mock')

contract('JurorsRegistry', ([_, governor, someone]) => {
  let controller, registry, ANJ

  const MIN_ACTIVE_BALANCE = bigExp(100, 18)
  const TOTAL_ACTIVE_BALANCE_LIMIT = bigExp(100e6, 18)

  beforeEach('create base contracts', async () => {
    controller = await buildHelper().deploy({ configGovernor: governor })
    ANJ = await ERC20.new('ANJ Token', 'ANJ', 18)

    registry = await JurorsRegistry.new(controller.address, ANJ.address, MIN_ACTIVE_BALANCE, TOTAL_ACTIVE_BALANCE_LIMIT)
    await controller.setJurorsRegistry(registry.address)
  })

  describe('setMinActiveBalance', () => {
    context('when the sender is the governor', () => {
      const from = governor

      const itUpdatesTheMinActiveBalance = newMinActiveBalance => {
        it('updates the current total active balance limit', async () => {
          await registry.setMinActiveBalance(newMinActiveBalance, { from })

          const currentMinActiveBalance = await registry.minJurorsActiveBalance()
          assert.equal(currentMinActiveBalance.toString(), newMinActiveBalance.toString(), 'min active balance does not match')
        })

        it('emits an event', async () => {
          const previousMinActiveBalance = await registry.minJurorsActiveBalance()

          const receipt = await registry.setMinActiveBalance(newMinActiveBalance, { from })

          assertAmountOfEvents(receipt, 'MinActiveBalanceChanged')
          assertEvent(receipt, 'MinActiveBalanceChanged', { previousMinActiveBalance, currentMinActiveBalance: newMinActiveBalance })
        })
      }

      context('when the given value is greater than zero', async () => {
        const newMinActiveBalance = bn(500)

        itUpdatesTheMinActiveBalance(newMinActiveBalance)
      })

      context('when the given value is zero', async () => {
        const newMinActiveBalance = bn(0)

        itUpdatesTheMinActiveBalance(newMinActiveBalance)
      })
    })

    context('when the sender is not the governor', () => {
      const from = someone

      it('reverts', async () => {
        await assertRevert(registry.setMinActiveBalance(MIN_ACTIVE_BALANCE, { from }), 'CTD_SENDER_NOT_CONFIG_GOVERNOR')
      })
    })
  })

  describe('setTotalActiveBalanceLimit', () => {
    context('when the sender is the governor', () => {
      const from = governor

      context('when the given limit is greater than zero', () => {
        const itUpdatesTheTotalActiveBalanceLimit = newTotalActiveBalanceLimit => {
          it('updates the current total active balance limit', async () => {
            await registry.setTotalActiveBalanceLimit(newTotalActiveBalanceLimit, { from })

            const currentTotalActiveBalanceLimit = await registry.totalJurorsActiveBalanceLimit()
            assert.equal(currentTotalActiveBalanceLimit.toString(), newTotalActiveBalanceLimit.toString(), 'total active balance limit does not match')
          })

          it('emits an event', async () => {
            const previousTotalActiveBalanceLimit = await registry.totalJurorsActiveBalanceLimit()

            const receipt = await registry.setTotalActiveBalanceLimit(newTotalActiveBalanceLimit, { from })

            assertAmountOfEvents(receipt, 'TotalActiveBalanceLimitChanged')
            assertEvent(receipt, 'TotalActiveBalanceLimitChanged', { previousTotalActiveBalanceLimit, currentTotalActiveBalanceLimit: newTotalActiveBalanceLimit })
          })
        }

        context('when the given limit is below the minimum active balance', () => {
          const newTotalActiveBalanceLimit = MIN_ACTIVE_BALANCE.sub(bn(1))

          itUpdatesTheTotalActiveBalanceLimit(newTotalActiveBalanceLimit)
        })

        context('when the given limit is above the minimum active balance', () => {
          const newTotalActiveBalanceLimit = MIN_ACTIVE_BALANCE.add(bn(1))

          itUpdatesTheTotalActiveBalanceLimit(newTotalActiveBalanceLimit)
        })
      })

      context('when the given limit is zero', () => {
        const newTotalActiveBalanceLimit = bn(0)

        it('reverts', async () => {
          await assertRevert(registry.setTotalActiveBalanceLimit(newTotalActiveBalanceLimit, { from }), 'JR_BAD_TOTAL_ACTIVE_BAL_LIMIT')
        })
      })
    })

    context('when the sender is not the governor', () => {
      const from = someone

      it('reverts', async () => {
        await assertRevert(registry.setTotalActiveBalanceLimit(TOTAL_ACTIVE_BALANCE_LIMIT, { from }), 'CTD_SENDER_NOT_CONFIG_GOVERNOR')
      })
    })
  })
})
