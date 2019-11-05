const { buildHelper } = require('../helpers/wrappers/controller')(web3, artifacts)
const { assertRevert } = require('../helpers/asserts/assertThrow')
const { CONTROLLED_ERRORS } = require('../helpers/utils/errors')
const { assertAmountOfEvents } = require('../helpers/asserts/assertEvent')

const Controlled = artifacts.require('ControlledMock')

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

contract('Controlled', ([_, fundsGovernor, configGovernor, modulesGovernor, someone]) => {
  let controller, controlled

  beforeEach('create controlled', async () => {
    controller = await buildHelper().deploy({ fundsGovernor, configGovernor, modulesGovernor })
    controlled = await Controlled.new(controller.address)
  })

  describe('constructor', () => {
    context('when the initialization succeeds', () => {
      it('initializes the controlled', async () => {
        controlled = await Controlled.new(controller.address)

        assert.equal(await controlled.getController(), controller.address, 'controller does not match')
      })
    })

    context('when the initialization fails', () => {
      context('when the given controller is not a contract', () => {
        const controllerAddress = someone

        it('reverts', async () => {
          await assertRevert(Controlled.new(controllerAddress), CONTROLLED_ERRORS.CONTROLLER_NOT_CONTRACT)
        })
      })

      context('when the given controller is the zero address', () => {
        const controllerAddress = ZERO_ADDRESS

        it('reverts', async () => {
          await assertRevert(Controlled.new(controllerAddress), CONTROLLED_ERRORS.CONTROLLER_NOT_CONTRACT)
        })
      })
    })
  })

  describe('onlyConfigGovernor', () => {
    context('when the sender is the governor', () => {
      const from = configGovernor

      it('executes call', async () => {
        const receipt = await controlled.onlyConfigGovernorFn({ from })

        assertAmountOfEvents(receipt, 'OnlyConfigGovernorCalled')
      })
    })

    context('when the sender is not the governor', () => {
      const from = someone

      it('reverts', async () => {
        await assertRevert(controlled.onlyConfigGovernorFn({ from }), CONTROLLED_ERRORS.SENDER_NOT_CONFIG_GOVERNOR)
      })
    })
  })
})
