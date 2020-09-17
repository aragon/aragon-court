const { bigExp } = require('../helpers/lib/numbers')
const { assertBn } = require('../helpers/asserts/assertBn')
const { buildHelper } = require('../helpers/wrappers/court')(web3, artifacts)
const { buildBrightIdHelper } = require('../helpers/wrappers/brightid')(web3, artifacts)
const { assertRevert } = require('../helpers/asserts/assertThrow')
const { CONTROLLED_ERRORS, REGISTRY_ERRORS } = require('../helpers/utils/errors')

const JurorsRegistry = artifacts.require('JurorsRegistry')
const ERC20 = artifacts.require('ERC20Mock')

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

contract('JurorsRegistry', ([_, something]) => {
  let controller, ANJ, brightIdRegister

  const TOTAL_ACTIVE_BALANCE_LIMIT = bigExp(100e6, 18)

  beforeEach('create base contracts', async () => {
    controller = await buildHelper().deploy()
    ANJ = await ERC20.new('ANJ Token', 'ANJ', 18)

    const brightIdHelper = buildBrightIdHelper()
    brightIdRegister = await brightIdHelper.deploy()
  })

  describe('initialize', () => {
    context('when the initialization succeeds', () => {
      it('sets initial config correctly', async () => {
        const registry = await JurorsRegistry.new(controller.address, ANJ.address, TOTAL_ACTIVE_BALANCE_LIMIT, brightIdRegister.address)

        assert.isFalse(await registry.supportsHistory())
        assert.equal(await registry.getController(), controller.address, 'registry controller does not match')
        assert.equal(await registry.token(), ANJ.address, 'token address does not match')
        assertBn((await registry.totalJurorsActiveBalanceLimit()), TOTAL_ACTIVE_BALANCE_LIMIT, 'total active balance limit does not match')
        assert.equal(await registry.brightIdRegister(), brightIdRegister.address, 'incorrect brightid register')
      })
    })

    context('initialization fails', () => {
      context('when the given token address is the zero address', () => {
        const token = ZERO_ADDRESS

        it('reverts', async () => {
          await assertRevert(JurorsRegistry.new(controller.address, token, TOTAL_ACTIVE_BALANCE_LIMIT, brightIdRegister.address), REGISTRY_ERRORS.NOT_CONTRACT)
        })
      })

      context('when the given token address is not a contract address', () => {
        const token = something

        it('reverts', async () => {
          await assertRevert(JurorsRegistry.new(controller.address, token, TOTAL_ACTIVE_BALANCE_LIMIT, brightIdRegister.address), REGISTRY_ERRORS.NOT_CONTRACT)
        })
      })

      context('when the given total active balance limit is zero', () => {
        const totalActiveBalanceLimit = 0

        it('reverts', async () => {
          await assertRevert(JurorsRegistry.new(controller.address, ANJ.address, totalActiveBalanceLimit, brightIdRegister.address), REGISTRY_ERRORS.BAD_TOTAL_ACTIVE_BAL_LIMIT)
        })
      })

      context('when the given controller is the zero address', () => {
        const controllerAddress = ZERO_ADDRESS

        it('reverts', async () => {
          await assertRevert(JurorsRegistry.new(controllerAddress, ANJ.address, TOTAL_ACTIVE_BALANCE_LIMIT, brightIdRegister.address), CONTROLLED_ERRORS.CONTROLLER_NOT_CONTRACT)
        })
      })

      context('when the given controller is not a contract address', () => {
        const controllerAddress = something

        it('reverts', async () => {
          await assertRevert(JurorsRegistry.new(controllerAddress, ANJ.address, TOTAL_ACTIVE_BALANCE_LIMIT, brightIdRegister.address), CONTROLLED_ERRORS.CONTROLLER_NOT_CONTRACT)
        })
      })

      context('when the given brightid register is not a contract address', () => {
        const brightIdAddress = something

        it('reverts', async () => {
          await assertRevert(JurorsRegistry.new(controller.address, ANJ.address, TOTAL_ACTIVE_BALANCE_LIMIT, brightIdAddress), CONTROLLED_ERRORS.NOT_CONTRACT)
        })
      })
    })
  })
})
