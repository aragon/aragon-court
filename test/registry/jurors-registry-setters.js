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
    controller = await buildHelper().deploy({ configGovernor: governor, minActiveBalance: MIN_ACTIVE_BALANCE })
    ANJ = await ERC20.new('ANJ Token', 'ANJ', 18)

    registry = await JurorsRegistry.new(controller.address, ANJ.address, TOTAL_ACTIVE_BALANCE_LIMIT)
    await controller.setJurorsRegistry(registry.address)
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
