const { assertBn } = require('../helpers/asserts/assertBn')
const { bn, bigExp } = require('../helpers/lib/numbers')
const { buildHelper } = require('../helpers/wrappers/court')(web3, artifacts)
const { buildBrightIdHelper } = require('../helpers/wrappers/brightid')(web3, artifacts)

const { assertRevert } = require('../helpers/asserts/assertThrow')
const { REGISTRY_EVENTS } = require('../helpers/utils/events')
const { assertEvent, assertAmountOfEvents } = require('../helpers/asserts/assertEvent')
const { CONTROLLED_ERRORS, REGISTRY_ERRORS } = require('../helpers/utils/errors')

const JurorsRegistry = artifacts.require('JurorsRegistry')
const ERC20 = artifacts.require('ERC20Mock')

contract('JurorsRegistry', ([_, governor, someone]) => {
  let controller, registry, ANJ, brightIdHelper

  const MIN_ACTIVE_BALANCE = bigExp(100, 18)
  const TOTAL_ACTIVE_BALANCE_LIMIT = bigExp(100e6, 18)

  before('create base contracts', async () => {
    controller = await buildHelper().deploy({ configGovernor: governor, minActiveBalance: MIN_ACTIVE_BALANCE })
    ANJ = await ERC20.new('ANJ Token', 'ANJ', 18)
  })

  beforeEach('create jurors registry module', async () => {
    brightIdHelper = buildBrightIdHelper()
    const brightIdRegister = await brightIdHelper.deploy()

    registry = await JurorsRegistry.new(controller.address, ANJ.address, TOTAL_ACTIVE_BALANCE_LIMIT, brightIdRegister.address)
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
            assertBn(currentTotalActiveBalanceLimit, newTotalActiveBalanceLimit, 'total active balance limit does not match')
          })

          it('emits an event', async () => {
            const previousTotalActiveBalanceLimit = await registry.totalJurorsActiveBalanceLimit()

            const receipt = await registry.setTotalActiveBalanceLimit(newTotalActiveBalanceLimit, { from })

            assertAmountOfEvents(receipt, REGISTRY_EVENTS.TOTAL_ACTIVE_BALANCE_LIMIT_CHANGED)
            assertEvent(receipt, REGISTRY_EVENTS.TOTAL_ACTIVE_BALANCE_LIMIT_CHANGED, {
              previousTotalActiveBalanceLimit,
              currentTotalActiveBalanceLimit: newTotalActiveBalanceLimit
            })
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
          await assertRevert(registry.setTotalActiveBalanceLimit(newTotalActiveBalanceLimit, { from }), REGISTRY_ERRORS.BAD_TOTAL_ACTIVE_BALANCE_LIMIT)
        })
      })
    })

    context('when the sender is not the governor', () => {
      const from = someone

      it('reverts', async () => {
        await assertRevert(registry.setTotalActiveBalanceLimit(TOTAL_ACTIVE_BALANCE_LIMIT, { from }), CONTROLLED_ERRORS.SENDER_NOT_CONFIG_GOVERNOR)
      })
    })
  })

  describe('setBrightIdRegister', () => {
    context('when the sender is the governor', () => {
      const from = governor

      context('when the bright id register is a contract', () => {
        it('updates the bright id register', async () => {
          const newBrightIdRegister = await brightIdHelper.deploy()

          await registry.setBrightIdRegister(newBrightIdRegister.address, { from })

          const actualBrightIdRegister = await registry.brightIdRegister()
          assertBn(actualBrightIdRegister, newBrightIdRegister.address, 'incorrect bright id register')
        })
      })

      context('when the given address is not a contract', () => {
        const newBrightIdRegister = someone

        it('reverts', async () => {
          await assertRevert(registry.setBrightIdRegister(newBrightIdRegister, { from }), REGISTRY_ERRORS.NOT_CONTRACT)
        })
      })
    })

    context('when the sender is not the governor', () => {
      const from = someone

      it('reverts', async () => {
        const newBrightIdRegister = await brightIdHelper.deploy()
        await assertRevert(registry.setBrightIdRegister(newBrightIdRegister.address, { from }), CONTROLLED_ERRORS.SENDER_NOT_CONFIG_GOVERNOR)
      })
    })
  })
})


