const { assertRevert } = require('../helpers/assertThrow')
const { assertAmountOfEvents, assertEvent } = require('../helpers/assertEvent')

const Controlled = artifacts.require('Controlled')
const Controller = artifacts.require('Controller')

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

contract('Controller', ([_, governor, someone]) => {
  let controller

  beforeEach('create controller', async () => {
    controller = await Controller.new(governor)
  })

  describe('getGovernor', () => {
    it('tells the expected governor', async () => {
      assert.equal(await controller.getGovernor(), governor, 'governor does not match')
    })
  })

  describe('changeGovernor', () => {
    context('when the sender is the governor', () => {
      const from = governor

      context('when the given address is not the zero address', () => {
        const newGovernor = someone

        it('changes the governor', async () => {
          await controller.changeGovernor(newGovernor, { from })

          assert.equal(await controller.getGovernor(), newGovernor, 'governor does not match')
        })

        it('emits an event', async () => {
          const receipt = await controller.changeGovernor(newGovernor, { from })

          assertAmountOfEvents(receipt, 'GovernorChanged')
          assertEvent(receipt, 'GovernorChanged', { previousGovernor: governor, currentGovernor: newGovernor })
        })
      })

      context('when the given address is not the zero address', () => {
        const newGovernor = ZERO_ADDRESS

        it('reverts', async () => {
          await assertRevert(controller.changeGovernor(newGovernor, { from }), 'CTR_INVALID_GOVERNOR_ADDRESS')
        })
      })
    })

    context('when the sender is not the governor', () => {
      const from = someone

      it('reverts', async () => {
        await assertRevert(controller.changeGovernor(someone, { from }), 'CTR_SENDER_NOT_GOVERNOR')
      })
    })
  })

  describe('eject', () => {
    context('when the sender is the governor', () => {
      const from = governor

      it('removes the governor', async () => {
        await controller.eject({ from })

        assert.equal(await controller.getGovernor(), ZERO_ADDRESS, 'governor does not match')
      })

      it('emits an event', async () => {
        const receipt = await controller.eject({ from })

        assertAmountOfEvents(receipt, 'GovernorChanged')
        assertEvent(receipt, 'GovernorChanged', { previousGovernor: governor, currentGovernor: ZERO_ADDRESS })
      })
    })

    context('when the sender is not the governor', () => {
      const from = someone

      it('reverts', async () => {
        await assertRevert(controller.eject({ from }), 'CTR_SENDER_NOT_GOVERNOR')
      })
    })
  })

  describe('setModule', () => {
    context('when the sender is the governor', () => {
      const from = governor

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

              assertAmountOfEvents(receipt, 'ModuleSet')
              assertEvent(receipt, 'ModuleSet', { id, addr: module.address })
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

              assertAmountOfEvents(receipt, 'ModuleSet')
              assertEvent(receipt, 'ModuleSet', { id, addr: module.address })
            })
          })
        })

        context('when the given id is one of the known IDs', () => {
          const modules = [
            { id: '0x26f3b895987e349a46d6d91132234924c6d45cfdc564b33427f53e3f9284955c', getter: 'getCourt' },
            { id: '0x7cbb12e82a6d63ff16fe43977f43e3e2b247ecd4e62c0e340da8800a48c67346', getter: 'getVoting' },
            { id: '0x3ec26b85a7d49ed13a920deeaceb063fa458eb25266fa7b504696047900a5b0f', getter: 'getAccounting' },
            { id: '0x3b21d36b36308c830e6c4053fb40a3b6d79dde78947fbf6b0accd30720ab5370', getter: 'getJurorsRegistry' },
            { id: '0x2bfa3327fe52344390da94c32a346eeb1b65a8b583e4335a419b9471e88c1365', getter: 'getSubscriptions' },
          ]

          for (const { id, getter } of modules) {
            describe(getter, () => {
              context('when the module was not set yet', () => {
                it('sets given module', async () => {
                  const receipt = await controller.setModule(id, module.address, { from })

                  assert.equal(await controller[getter](), module.address, 'module address does not match')

                  assertAmountOfEvents(receipt, 'ModuleSet')
                  assertEvent(receipt, 'ModuleSet', { id, addr: module.address })
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

                  assertAmountOfEvents(receipt, 'ModuleSet')
                  assertEvent(receipt, 'ModuleSet', { id, addr: module.address })
                })
              })
            })
          }
        })
      })

      context('when the given address is not a contract', () => {
        const module = someone

        it('reverts', async () => {
          await assertRevert(controller.setModule('0x0', module, { from }), 'CTR_IMPLEMENTATION_NOT_CONTRACT')
        })
      })

      context('when the given address is the zero address', () => {
        const module = ZERO_ADDRESS

        it('reverts', async () => {
          await assertRevert(controller.setModule('0x0', module, { from }), 'CTR_IMPLEMENTATION_NOT_CONTRACT')
        })
      })
    })

    context('when the sender is not the governor', () => {
      const from = someone

      it('reverts', async () => {
        await assertRevert(controller.setModule('0x0', ZERO_ADDRESS, { from }), 'CTR_SENDER_NOT_GOVERNOR')
      })
    })
  })
})
