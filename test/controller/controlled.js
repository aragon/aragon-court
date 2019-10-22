const { assertRevert } = require('../helpers/assertThrow')
const { ONE_DAY, NEXT_WEEK } = require('../helpers/time')
const { assertAmountOfEvents } = require('../helpers/assertEvent')

const Controller = artifacts.require('Controller')
const Controlled = artifacts.require('ControlledMock')

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

contract('Controlled', ([_, fundsGovernor, configGovernor, modulesGovernor, someone]) => {
  let controller, controlled

  beforeEach('create controlled', async () => {
    controller = await Controller.new(ONE_DAY, NEXT_WEEK, fundsGovernor, configGovernor, modulesGovernor)
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
          await assertRevert(Controlled.new(controllerAddress), 'CTD_CONTROLLER_NOT_CONTRACT')
        })
      })

      context('when the given controller is the zero address', () => {
        const controllerAddress = ZERO_ADDRESS

        it('reverts', async () => {
          await assertRevert(Controlled.new(controllerAddress), 'CTD_CONTROLLER_NOT_CONTRACT')
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
        await assertRevert(controlled.onlyConfigGovernorFn({ from }), 'CTD_SENDER_NOT_CONFIG_GOVERNOR')
      })
    })
  })
})
