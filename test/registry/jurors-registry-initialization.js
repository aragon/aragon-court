const { bigExp } = require('../helpers/numbers')
const { assertRevert } = require('../helpers/assertThrow')
const { ONE_DAY, NEXT_WEEK } = require('../helpers/time')

const JurorsRegistry = artifacts.require('JurorsRegistry')
const Controller = artifacts.require('ControllerMock')
const ERC20 = artifacts.require('ERC20Mock')

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

contract('JurorsRegistry', ([_, something]) => {
  let controller, ANJ

  const MIN_ACTIVE_AMOUNT = bigExp(100, 18)
  const TOTAL_ACTIVE_BALANCE_LIMIT = bigExp(100e6, 18)

  beforeEach('create base contracts', async () => {
    controller = await Controller.new(ONE_DAY, NEXT_WEEK)
    ANJ = await ERC20.new('ANJ Token', 'ANJ', 18)
  })

  describe('initialize', () => {
    context('when the initialization succeeds', () => {
      it('sets initial config correctly', async () => {
        const registry = await JurorsRegistry.new(controller.address, ANJ.address, MIN_ACTIVE_AMOUNT, TOTAL_ACTIVE_BALANCE_LIMIT)

        assert.isFalse(await registry.supportsHistory())
        assert.equal(await registry.getController(), controller.address, 'registry controller does not match')
        assert.equal(await registry.token(), ANJ.address, 'token address does not match')
        assert.equal((await registry.minJurorsActiveBalance()).toString(), MIN_ACTIVE_AMOUNT, 'min active token amount does not match')
        assert.equal((await registry.totalJurorsActiveBalanceLimit()).toString(), TOTAL_ACTIVE_BALANCE_LIMIT, 'total active balance limit does not match')
      })
    })

    context('initialization fails', () => {
      context('when the given token address is the zero address', () => {
        const token = ZERO_ADDRESS

        it('reverts', async () => {
          await assertRevert(JurorsRegistry.new(controller.address, token, MIN_ACTIVE_AMOUNT, TOTAL_ACTIVE_BALANCE_LIMIT), 'JR_NOT_CONTRACT')
        })
      })

      context('when the given token address is not a contract address', () => {
        const token = something

        it('reverts', async () => {
          await assertRevert(JurorsRegistry.new(controller.address, token, MIN_ACTIVE_AMOUNT, TOTAL_ACTIVE_BALANCE_LIMIT), 'JR_NOT_CONTRACT')
        })
      })

      context('when the given total active balance limit is zero', () => {
        const totalActiveBalanceLimit = 0

        it('reverts', async () => {
          await assertRevert(JurorsRegistry.new(controller.address, ANJ.address, MIN_ACTIVE_AMOUNT, totalActiveBalanceLimit), 'JR_BAD_TOTAL_ACTIVE_BAL_LIMIT')
        })
      })

      context('when the given controller is the zero address', () => {
        const controllerAddress = ZERO_ADDRESS

        it('reverts', async () => {
          await assertRevert(JurorsRegistry.new(controllerAddress, ANJ.address, MIN_ACTIVE_AMOUNT, TOTAL_ACTIVE_BALANCE_LIMIT), 'CTD_CONTROLLER_NOT_CONTRACT')
        })
      })

      context('when the given controller is not a contract address', () => {
        const controllerAddress = something

        it('reverts', async () => {
          await assertRevert(JurorsRegistry.new(controllerAddress, ANJ.address, MIN_ACTIVE_AMOUNT, TOTAL_ACTIVE_BALANCE_LIMIT), 'CTD_CONTROLLER_NOT_CONTRACT')
        })
      })
    })
  })
})
