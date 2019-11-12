const { sha3 } = require('web3-utils')
const { buildHelper } = require('../../helpers/wrappers/court')(web3, artifacts)
const { assertRevert } = require('../../helpers/asserts/assertThrow')
const { CONTROLLER_ERRORS } = require('../../helpers/utils/errors')
const { CONTROLLER_EVENTS } = require('../../helpers/utils/events')
const { assertAmountOfEvents, assertEvent } = require('../../helpers/asserts/assertEvent')

const Controlled = artifacts.require('Controlled')

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

contract('Controller', ([_, fundsGovernor, configGovernor, modulesGovernor, someone]) => {
  let controller

  beforeEach('create controller', async () => {
    controller = await buildHelper().deploy({ fundsGovernor, configGovernor, modulesGovernor })
  })

  describe('getFundsGovernor', () => {
    it('tells the expected governor', async () => {
      assert.equal(await controller.getFundsGovernor(), fundsGovernor, 'funds governor does not match')
    })
  })

  describe('getConfigGovernor', () => {
    it('tells the expected governor', async () => {
      assert.equal(await controller.getConfigGovernor(), configGovernor, 'config governor does not match')
    })
  })

  describe('getModulesGovernor', () => {
    it('tells the expected governor', async () => {
      assert.equal(await controller.getModulesGovernor(), modulesGovernor, 'modules governor does not match')
    })
  })

  describe('fundsConfigGovernor', () => {
    context('when the sender is the funds governor', () => {
      const from = fundsGovernor

      context('when the given address is not the zero address', () => {
        const newFundsGovernor = someone

        it('changes the funds governor', async () => {
          await controller.changeFundsGovernor(newFundsGovernor, { from })

          assert.equal(await controller.getFundsGovernor(), newFundsGovernor, 'funds governor does not match')
        })

        it('emits an event', async () => {
          const receipt = await controller.changeFundsGovernor(newFundsGovernor, { from })

          assertAmountOfEvents(receipt, CONTROLLER_EVENTS.FUNDS_GOVERNOR_CHANGED)
          assertEvent(receipt, CONTROLLER_EVENTS.FUNDS_GOVERNOR_CHANGED, { previousGovernor: fundsGovernor, currentGovernor: newFundsGovernor })
        })
      })

      context('when the given address is the zero address', () => {
        const newFundsGovernor = ZERO_ADDRESS

        it('reverts', async () => {
          await assertRevert(controller.changeFundsGovernor(newFundsGovernor, { from }), CONTROLLER_ERRORS.INVALID_GOVERNOR_ADDRESS)
        })
      })
    })

    context('when the sender is not the funds governor', () => {
      const from = modulesGovernor

      it('reverts', async () => {
        await assertRevert(controller.changeFundsGovernor(someone, { from }), CONTROLLER_ERRORS.SENDER_NOT_GOVERNOR)
      })
    })
  })

  describe('changeConfigGovernor', () => {
    context('when the sender is the config governor', () => {
      const from = configGovernor

      context('when the given address is not the zero address', () => {
        const newConfigGovernor = someone

        it('changes the config governor', async () => {
          await controller.changeConfigGovernor(newConfigGovernor, { from })

          assert.equal(await controller.getConfigGovernor(), newConfigGovernor, 'config governor does not match')
        })

        it('emits an event', async () => {
          const receipt = await controller.changeConfigGovernor(newConfigGovernor, { from })

          assertAmountOfEvents(receipt, CONTROLLER_EVENTS.CONFIG_GOVERNOR_CHANGED)
          assertEvent(receipt, CONTROLLER_EVENTS.CONFIG_GOVERNOR_CHANGED, { previousGovernor: configGovernor, currentGovernor: newConfigGovernor })
        })
      })

      context('when the given address is the zero address', () => {
        const newConfigGovernor = ZERO_ADDRESS

        it('reverts', async () => {
          await assertRevert(controller.changeConfigGovernor(newConfigGovernor, { from }), CONTROLLER_ERRORS.INVALID_GOVERNOR_ADDRESS)
        })
      })
    })

    context('when the sender is not the config governor', () => {
      const from = modulesGovernor

      it('reverts', async () => {
        await assertRevert(controller.changeConfigGovernor(someone, { from }), CONTROLLER_ERRORS.SENDER_NOT_GOVERNOR)
      })
    })
  })

  describe('changeModulesGovernor', () => {
    context('when the sender is the modules governor', () => {
      const from = modulesGovernor

      context('when the given address is not the zero address', () => {
        const newModulesGovernor = someone

        it('changes the modules governor', async () => {
          await controller.changeModulesGovernor(newModulesGovernor, { from })

          assert.equal(await controller.getModulesGovernor(), newModulesGovernor, 'modules governor does not match')
        })

        it('emits an event', async () => {
          const receipt = await controller.changeModulesGovernor(newModulesGovernor, { from })

          assertAmountOfEvents(receipt, CONTROLLER_EVENTS.MODULES_GOVERNOR_CHANGED)
          assertEvent(receipt, CONTROLLER_EVENTS.MODULES_GOVERNOR_CHANGED, { previousGovernor: modulesGovernor, currentGovernor: newModulesGovernor })
        })
      })

      context('when the given address is the zero address', () => {
        const newModulesGovernor = ZERO_ADDRESS

        it('reverts', async () => {
          await assertRevert(controller.changeModulesGovernor(newModulesGovernor, { from }), CONTROLLER_ERRORS.INVALID_GOVERNOR_ADDRESS)
        })
      })
    })

    context('when the sender is not the governor', () => {
      const from = configGovernor

      it('reverts', async () => {
        await assertRevert(controller.changeModulesGovernor(someone, { from }), CONTROLLER_ERRORS.SENDER_NOT_GOVERNOR)
      })
    })
  })

  describe('ejectFundsGovernor', () => {
    context('when the sender is the funds governor', () => {
      const from = fundsGovernor

      it('removes the funds governor', async () => {
        await controller.ejectFundsGovernor({ from })

        assert.equal(await controller.getFundsGovernor(), ZERO_ADDRESS, 'funds governor does not match')
      })

      it('emits an event', async () => {
        const receipt = await controller.ejectFundsGovernor({ from })

        assertAmountOfEvents(receipt, CONTROLLER_EVENTS.FUNDS_GOVERNOR_CHANGED)
        assertEvent(receipt, CONTROLLER_EVENTS.FUNDS_GOVERNOR_CHANGED, { previousGovernor: fundsGovernor, currentGovernor: ZERO_ADDRESS })
      })
    })

    context('when the sender is not the funds governor', () => {
      const from = configGovernor

      it('reverts', async () => {
        await assertRevert(controller.ejectModulesGovernor({ from }), CONTROLLER_ERRORS.SENDER_NOT_GOVERNOR)
      })
    })
  })

  describe('ejectModulesGovernor', () => {
    context('when the sender is the modules governor', () => {
      const from = modulesGovernor

      it('removes the modules governor', async () => {
        await controller.ejectModulesGovernor({ from })

        assert.equal(await controller.getModulesGovernor(), ZERO_ADDRESS, 'modules governor does not match')
      })

      it('emits an event', async () => {
        const receipt = await controller.ejectModulesGovernor({ from })

        assertAmountOfEvents(receipt, CONTROLLER_EVENTS.MODULES_GOVERNOR_CHANGED)
        assertEvent(receipt, CONTROLLER_EVENTS.MODULES_GOVERNOR_CHANGED, { previousGovernor: modulesGovernor, currentGovernor: ZERO_ADDRESS })
      })
    })

    context('when the sender is not the modules governor', () => {
      const from = configGovernor

      it('reverts', async () => {
        await assertRevert(controller.ejectModulesGovernor({ from }), CONTROLLER_ERRORS.SENDER_NOT_GOVERNOR)
      })
    })
  })

  describe('setModule', () => {
    context('when the sender is the governor', () => {
      const from = modulesGovernor

      context('when the given address is a contract', () => {
        let module

        beforeEach('deploy module', async () => {
          module = await Controlled.new(controller.address)
        })

        context('when the given id is an unknown ID', () => {
          const id = '0x0000000000000000000000000000000000000000000000000000000000000001'

          context('when the module was not set yet', () => {
            it('sets given module', async () => {
              const receipt = await controller.setModule(id, module.address, { from })

              assert.equal(await controller.getModule(id), module.address, 'module address does not match')

              assertAmountOfEvents(receipt, CONTROLLER_EVENTS.MODULE_SET)
              assertEvent(receipt, CONTROLLER_EVENTS.MODULE_SET, { id, addr: module.address })
            })
          })

          context('when the module was already set', () => {
            let previousModule

            beforeEach('set module', async () => {
              previousModule = await Controlled.new(controller.address)
              await controller.setModule(id, previousModule.address, { from })

              assert.equal(await controller.getModule(id), previousModule.address, 'module address does not match')
            })

            it('overwrites the previous address', async () => {
              const receipt = await controller.setModule(id, module.address, { from })

              assert.equal(await controller.getModule(id), module.address, 'module address does not match')

              assertAmountOfEvents(receipt, CONTROLLER_EVENTS.MODULE_SET)
              assertEvent(receipt, CONTROLLER_EVENTS.MODULE_SET, { id, addr: module.address })
            })
          })
        })

        context('when the given id is one of the known IDs', () => {
          const modules = [
            { name: 'DISPUTE_MANAGER', getter: 'getDisputeManager' },
            { name: 'VOTING', getter: 'getVoting' },
            { name: 'TREASURY', getter: 'getTreasury' },
            { name: 'JURORS_REGISTRY', getter: 'getJurorsRegistry' },
            { name: 'SUBSCRIPTIONS', getter: 'getSubscriptions' }
          ]

          for (const { name, getter } of modules) {
            const id = sha3(name)

            describe(getter, () => {
              context('when the module was not set yet', () => {
                it('sets given module', async () => {
                  const receipt = await controller.setModule(id, module.address, { from })

                  assert.equal(await controller[getter](), module.address, 'module address does not match')

                  assertAmountOfEvents(receipt, CONTROLLER_EVENTS.MODULE_SET)
                  assertEvent(receipt, CONTROLLER_EVENTS.MODULE_SET, { id, addr: module.address })
                })
              })

              context('when the module was already set', () => {
                let module

                beforeEach('set module', async () => {
                  module = await Controlled.new(controller.address)
                  await controller.setModule(id, module.address, { from })

                  assert.equal(await controller.getModule(id), module.address, 'module address does not match')
                })

                it('overwrites the previous implementation', async () => {
                  const receipt = await controller.setModule(id, module.address, { from })

                  assert.equal(await controller[getter](), module.address, 'module implementation does not match')

                  assertAmountOfEvents(receipt, CONTROLLER_EVENTS.MODULE_SET)
                  assertEvent(receipt, CONTROLLER_EVENTS.MODULE_SET, { id, addr: module.address })
                })
              })
            })
          }
        })
      })

      context('when the given address is not a contract', () => {
        const module = someone

        it('reverts', async () => {
          await assertRevert(controller.setModule('0x0', module, { from }), CONTROLLER_ERRORS.IMPLEMENTATION_NOT_CONTRACT)
        })
      })

      context('when the given address is the zero address', () => {
        const module = ZERO_ADDRESS

        it('reverts', async () => {
          await assertRevert(controller.setModule('0x0', module, { from }), CONTROLLER_ERRORS.IMPLEMENTATION_NOT_CONTRACT)
        })
      })
    })

    context('when the sender is not the governor', () => {
      const from = someone

      it('reverts', async () => {
        await assertRevert(controller.setModule('0x0', ZERO_ADDRESS, { from }), CONTROLLER_ERRORS.SENDER_NOT_GOVERNOR)
      })
    })
  })
})
