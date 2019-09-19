const { assertRevert } = require('../helpers/assertThrow')
const { decodeEventsOfType } = require('../helpers/decodeEvent')
const { bn, bigExp, MAX_UINT256 } = require('../helpers/numbers')
const { assertEvent, assertAmountOfEvents } = require('../helpers/assertEvent')

const ERC20 = artifacts.require('ERC20Mock')
const JurorsRegistry = artifacts.require('JurorsRegistry')
const JurorsRegistryOwnerMock = artifacts.require('JurorsRegistryOwnerMock')

contract('JurorsRegistry', ([_, juror, someone]) => {
  let registry, registryOwner, ANJ

  const MIN_ACTIVE_AMOUNT = bigExp(100, 18)
  const BURN_ADDRESS = '0x000000000000000000000000000000000000dead'

  beforeEach('create base contracts', async () => {
    registry = await JurorsRegistry.new()
    registryOwner = await JurorsRegistryOwnerMock.new(registry.address)
    ANJ = await ERC20.new('ANJ Token', 'ANJ', 18)
  })

  const itHandlesZeroTokenAssignmentsProperly = (assignmentCall, recipient) => {
    it('does not affect any of the balances', async () => {
      const previousUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(recipient)
      const { active: previousActiveBalance, available: previousAvailableBalance, locked: previousLockedBalance, pendingDeactivation: previousDeactivationBalance } = await registry.balanceOf(recipient)

      await assignmentCall()

      const currentUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(recipient)
      assert.equal(previousUnlockedActiveBalance.toString(), currentUnlockedActiveBalance.toString(), 'unlocked balances do not match')

      const { active: currentActiveBalance, available: currentAvailableBalance, locked: currentLockedBalance, pendingDeactivation: currentDeactivationBalance } = await registry.balanceOf(recipient)
      assert.equal(previousLockedBalance.toString(), currentLockedBalance.toString(), 'locked balances do not match')
      assert.equal(previousActiveBalance.toString(), currentActiveBalance.toString(), 'active balances do not match')
      assert.equal(previousAvailableBalance.toString(), currentAvailableBalance.toString(), 'available balances do not match')
      assert.equal(previousDeactivationBalance.toString(), currentDeactivationBalance.toString(), 'deactivation balances do not match')
    })

    it('does not affect the staked balance', async () => {
      const previousTotalStake = await registry.totalStaked()
      const previousJurorStake = await registry.totalStakedFor(recipient)

      await assignmentCall()

      const currentTotalStake = await registry.totalStaked()
      assert.equal(previousTotalStake.toString(), currentTotalStake.toString(), 'total stake amounts do not match')

      const currentJurorStake = await registry.totalStakedFor(recipient)
      assert.equal(previousJurorStake.toString(), currentJurorStake.toString(), 'recipient stake amounts do not match')
    })

    it('does not affect the token balances', async () => {
      const previousJurorBalance = await ANJ.balanceOf(recipient)
      const previousRegistryBalance = await ANJ.balanceOf(registry.address)

      await assignmentCall()

      const currentSenderBalance = await ANJ.balanceOf(recipient)
      assert.equal(previousJurorBalance.toString(), currentSenderBalance.toString(), 'recipient balances do not match')

      const currentRegistryBalance = await ANJ.balanceOf(registry.address)
      assert.equal(previousRegistryBalance.toString(), currentRegistryBalance.toString(), 'registry balances do not match')
    })

    it('does not emit an available balance changed event', async () => {
      const receipt = await assignmentCall()
      const logs = decodeEventsOfType(receipt, JurorsRegistry.abi, 'JurorAvailableBalanceChanged')

      assertAmountOfEvents({ logs }, 'JurorAvailableBalanceChanged', 0)
    })
  }

  const itHandlesTokenAssignmentsProperly = (assignmentCall, recipient, amount) => {
    it('adds the given amount to the available balance', async () => {
      const { active: previousActiveBalance, available: previousAvailableBalance, locked: previousLockedBalance, pendingDeactivation: previousDeactivationBalance } = await registry.balanceOf(recipient)

      await assignmentCall()

      const { active: currentActiveBalance, available: currentAvailableBalance, locked: currentLockedBalance, pendingDeactivation: currentDeactivationBalance } = await registry.balanceOf(recipient)
      assert.equal(previousAvailableBalance.add(amount).toString(), currentAvailableBalance.toString(), 'available balances do not match')

      assert.equal(previousLockedBalance.toString(), currentLockedBalance.toString(), 'locked balances do not match')
      assert.equal(previousActiveBalance.toString(), currentActiveBalance.toString(), 'active balances do not match')
      assert.equal(previousDeactivationBalance.toString(), currentDeactivationBalance.toString(), 'deactivation balances do not match')
    })

    it('does not affect the unlocked balance of the recipient', async () => {
      const previousUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(recipient)

      await assignmentCall()

      const currentUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(recipient)
      assert.equal(previousUnlockedActiveBalance.toString(), currentUnlockedActiveBalance.toString(), 'unlocked balances do not match')
    })

    it('increments the staked balance for the recipient', async () => {
      const previousTotalStake = await registry.totalStaked()
      const previousJurorStake = await registry.totalStakedFor(recipient)

      await assignmentCall()

      const currentTotalStake = await registry.totalStaked()
      assert.equal(previousTotalStake.toString(), currentTotalStake.toString(), 'total stake amounts do not match')

      const currentJurorStake = await registry.totalStakedFor(recipient)
      assert.equal(previousJurorStake.add(amount).toString(), currentJurorStake.toString(), 'recipient stake amounts do not match')
    })

    it('does not affect the token balances', async () => {
      const previousJurorBalance = await ANJ.balanceOf(recipient)
      const previousRegistryBalance = await ANJ.balanceOf(registry.address)

      await assignmentCall()

      const currentSenderBalance = await ANJ.balanceOf(recipient)
      assert.equal(previousJurorBalance.toString(), currentSenderBalance.toString(), 'recipient balances do not match')

      const currentRegistryBalance = await ANJ.balanceOf(registry.address)
      assert.equal(previousRegistryBalance.toString(), currentRegistryBalance.toString(), 'registry balances do not match')
    })

    it('emits an available balance changed event', async () => {
      const receipt = await assignmentCall()
      const logs = decodeEventsOfType(receipt, JurorsRegistry.abi, 'JurorAvailableBalanceChanged')

      assertAmountOfEvents({ logs }, 'JurorAvailableBalanceChanged')
      assertEvent({ logs }, 'JurorAvailableBalanceChanged', { juror: recipient, amount, positive: true })
    })
  }

  describe('assignTokens', () => {
    context('when the registry is initialized', () => {
      beforeEach('initialize registry', async () => {
        await registry.init(registryOwner.address, ANJ.address, MIN_ACTIVE_AMOUNT)
      })

      context('when the sender is the owner', () => {
        context('when the given amount is zero', () => {
          const amount = bn(0)

          itHandlesZeroTokenAssignmentsProperly(() => registryOwner.assignTokens(juror, amount), juror)
        })

        context('when the given amount is greater than zero', () => {
          context('when the juror did not have balance', () => {
            const amount = bigExp(100, 18)

            itHandlesTokenAssignmentsProperly(() => registryOwner.assignTokens(juror, amount), juror, amount)
          })

          context('when the juror already had some balance', () => {
            beforeEach('stake some balance', async () => {
              const initialBalance = bigExp(50, 18)
              await ANJ.generateTokens(juror, initialBalance)
              await ANJ.approveAndCall(registry.address, initialBalance, '0x', { from: juror })
            })

            context('when the given amount does not overflow', () => {
              const amount = bigExp(100, 18)

              itHandlesTokenAssignmentsProperly(() => registryOwner.assignTokens(juror, amount), juror, amount)
            })

            context('when the given amount does overflow', () => {
              const amount = MAX_UINT256

              it('reverts', async () => {
                await assertRevert(registryOwner.assignTokens(juror, amount), 'MATH_ADD_OVERFLOW')
              })
            })
          })
        })
      })

      context('when the sender is not the owner', () => {
        const from = someone

        it('reverts', async () => {
          await assertRevert(registry.assignTokens(juror, bigExp(100, 18), { from }), 'JR_SENDER_NOT_OWNER')
        })
      })
    })

    context('when the registry is not initialized', () => {
      it('reverts', async () => {
        await assertRevert(registryOwner.assignTokens(juror, bigExp(100, 18)), 'JR_SENDER_NOT_OWNER')
      })
    })
  })

  describe('burnTokens', () => {
    context('when the registry is initialized', () => {
      beforeEach('initialize registry', async () => {
        await registry.init(registryOwner.address, ANJ.address, MIN_ACTIVE_AMOUNT)
      })

      context('when the sender is the owner', () => {
        context('when the given amount is zero', () => {
          const amount = bn(0)

          itHandlesZeroTokenAssignmentsProperly(() => registryOwner.burnTokens(amount), BURN_ADDRESS)
        })

        context('when the given amount is greater than zero', () => {
          context('when the juror did not have balance', () => {
            const amount = bigExp(100, 18)

            itHandlesTokenAssignmentsProperly(() => registryOwner.burnTokens(amount), BURN_ADDRESS, amount)
          })

          context('when the burn address already had some balance', () => {
            beforeEach('burn some balance', async () => {
              await registryOwner.burnTokens(bigExp(50, 18))
            })

            context('when the given amount does not overflow', () => {
              const amount = bigExp(100, 18)

              itHandlesTokenAssignmentsProperly(() => registryOwner.burnTokens(amount), BURN_ADDRESS, amount)
            })

            context('when the given amount does overflow', () => {
              const amount = MAX_UINT256

              it('reverts', async () => {
                await assertRevert(registryOwner.burnTokens(amount), 'MATH_ADD_OVERFLOW')
              })
            })
          })
        })
      })

      context('when the sender is not the owner', () => {
        const from = someone

        it('reverts', async () => {
          await assertRevert(registry.burnTokens(bigExp(100, 18), { from }), 'JR_SENDER_NOT_OWNER')
        })
      })
    })

    context('when the registry is not initialized', () => {
      it('reverts', async () => {
        await assertRevert(registryOwner.burnTokens(bigExp(100, 18)), 'JR_SENDER_NOT_OWNER')
      })
    })
  })
})
