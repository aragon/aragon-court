const { assertRevert } = require('../helpers/assertThrow')
const { assertAmountOfEvents, assertEvent } = require('../helpers/assertEvent')

const Controlled = artifacts.require('Controlled')
const Controller = artifacts.require('Controller')

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

contract('Controller', ([_, governor, someone, anotherone]) => {
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
        let implementation
        
        beforeEach('deploy implementation', async () => {
          implementation = await Controlled.new(controller.address)
        })
        
        context('when the given owner is valid', () => {
          const owner = someone

          context('when the given id is an unknown ID', () => {
            const id = '0x0000000000000000000000000000000000000000000000000000000000000001'

            context('when the implementation was not set yet', () => {
              it('sets given implementation', async () => {
                const receipt = await controller.setModule(id, owner, implementation.address, { from })

                const module = await controller.getModule(id)
                assert.equal(module.owner, owner, 'module owner does not match')
                assert.equal(module.implementation, implementation.address, 'module implementation does not match')

                assertAmountOfEvents(receipt, 'ModuleSet')
                assertEvent(receipt, 'ModuleSet', { id, owner, implementation: implementation.address })
              })
            })

            context('when the implementation was already set', () => {
              let previousImplementation
              
              beforeEach('set implementation', async () => {
                previousImplementation = await Controlled.new(controller.address)
                await controller.setModule(id, anotherone, previousImplementation.address, { from })

                const module = await controller.getModule(id)
                assert.equal(module.owner, anotherone, 'module owner does not match')
                assert.equal(module.implementation, previousImplementation.address, 'module implementation does not match')
              })

              it('overwrites the previous implementation', async () => {
                const receipt = await controller.setModule(id, owner, implementation.address, { from })

                const module = await controller.getModule(id)
                assert.equal(module.owner, owner, 'module owner does not match')
                assert.equal(module.implementation, implementation.address, 'module implementation does not match')
  
                assertAmountOfEvents(receipt, 'ModuleSet')
                assertEvent(receipt, 'ModuleSet', { id, owner, implementation: implementation.address })
              })
            })
          })

          context('when the given id is one of the known IDs', () => {
            const implementations = [
              { id: '0x3ec26b85a7d49ed13a920deeaceb063fa458eb25266fa7b504696047900a5b0f', getter: 'getAccounting' },
              { id: '0xa334dcfd63312f27d3bdd4b12fef158515746c4bdb2f54bd1312f28b269bf207', getter: 'getCRVoting' },
              { id: '0x3b21d36b36308c830e6c4053fb40a3b6d79dde78947fbf6b0accd30720ab5370', getter: 'getJurorsRegistry' },
              { id: '0x2bfa3327fe52344390da94c32a346eeb1b65a8b583e4335a419b9471e88c1365', getter: 'getSubscriptions' },
            ]

            for (const { id, getter } of implementations) {
              describe(getter, () => {
                context('when the implementation was not set yet', () => {
                  it('sets given implementation', async () => {
                    const receipt = await controller.setModule(id, owner, implementation.address, { from })

                    assert.equal(await controller[getter](), implementation.address, 'module implementation does not match')
                    assert.equal(await controller[`${getter}Owner`](), owner, 'module owner does not match')

                    assertAmountOfEvents(receipt, 'ModuleSet')
                    assertEvent(receipt, 'ModuleSet', { id, owner, implementation: implementation.address })
                  })
                })

                context('when the implementation was already set', () => {
                  let previousImplementation

                  beforeEach('set implementation', async () => {
                    previousImplementation = await Controlled.new(controller.address)
                    await controller.setModule(id, anotherone, previousImplementation.address, { from })

                    const module = await controller.getModule(id)
                    assert.equal(module.owner, anotherone, 'module owner does not match')
                    assert.equal(module.implementation, previousImplementation.address, 'module implementation does not match')
                  })

                  it('overwrites the previous implementation', async () => {
                    const receipt = await controller.setModule(id, owner, implementation.address, { from })

                    assert.equal(await controller[getter](), implementation.address, 'module implementation does not match')
                    assert.equal(await controller[`${getter}Owner`](), owner, 'module owner does not match')

                    assertAmountOfEvents(receipt, 'ModuleSet')
                    assertEvent(receipt, 'ModuleSet', { id, owner, implementation: implementation.address })
                  })
                })
              })
            }
          })
        })

        context('when the given owner is not valid', () => {
          const owner = ZERO_ADDRESS

          it('reverts', async () => {
            await assertRevert(controller.setModule('0x0', owner, ZERO_ADDRESS, { from }), 'CTR_ZERO_MODULE_OWNER')
          })
        })
      })

      context('when the given address is not a contract', () => {
        const implementation = someone

        it('reverts', async () => {
          await assertRevert(controller.setModule('0x0', someone, implementation, { from }), 'CTR_IMPLEMENTATION_NOT_CONTRACT')
        })
      })

      context('when the given address is the zero address', () => {
        const implementation = ZERO_ADDRESS

        it('reverts', async () => {
          await assertRevert(controller.setModule('0x0', someone, implementation, { from }), 'CTR_IMPLEMENTATION_NOT_CONTRACT')
        })
      })
    })

    context('when the sender is not the governor', () => {
      const from = someone

      it('reverts', async () => {
        await assertRevert(controller.setModule('0x0', someone, ZERO_ADDRESS, { from }), 'CTR_SENDER_NOT_GOVERNOR')
      })
    })
  })
})
