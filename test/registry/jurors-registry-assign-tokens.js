const { assertRevert } = require('@aragon/test-helpers/assertThrow')
const { decodeEventsOfType } = require('../helpers/decodeEvent')
const { bigExp, MAX_UINT256 } = require('../helpers/numbers')(web3)
const { assertEvent, assertAmountOfEvents } = require('@aragon/test-helpers/assertEvent')(web3)

const JurorsRegistry = artifacts.require('JurorsRegistry')
const MiniMeToken = artifacts.require('MiniMeToken')
const JurorsRegistryOwnerMock = artifacts.require('JurorsRegistryOwnerMock')

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const BURN_ADDRESS = '0x000000000000000000000000000000000000dead'

contract('JurorsRegistry assign tokens', ([_, juror, someone]) => {
  let registry, registryOwner, ANJ

  const MIN_ACTIVE_TOKENS = bigExp(100, 18)

  beforeEach('create base contracts', async () => {
    registry = await JurorsRegistry.new()
    registryOwner = await JurorsRegistryOwnerMock.new(registry.address)
    ANJ = await MiniMeToken.new(ZERO_ADDRESS, ZERO_ADDRESS, 0, 'n', 18, 'ANJ', true)
  })

  const itHandlesTokenAssignmentsProperly = (assignmentCall, recipient, amount) => {
    it('adds the given amount to the available balance', async () => {
      const [previousActiveBalance, previousAvailableBalance, previousLockedBalance, previousDeactivationBalance] = await registry.balanceOf(recipient)

      await assignmentCall()

      const [currentActiveBalance, currentAvailableBalance, currentLockedBalance, currentDeactivationBalance] = await registry.balanceOf(recipient)
      assert.equal(previousAvailableBalance.plus(amount).toString(), currentAvailableBalance.toString(), 'available balances do not match')

      assert.equal(previousLockedBalance.toString(), currentLockedBalance.toString(), 'locked balances do not match')
      assert.equal(previousActiveBalance.toString(), currentActiveBalance.toString(), 'active balances do not match')
      assert.equal(previousDeactivationBalance.toString(), currentDeactivationBalance.toString(), 'deactivation balances do not match')
    })

    it('does not affect the unlocked balance of the recipient', async () => {
      const previousUnlockedBalance = await registry.unlockedBalanceOf(recipient)

      await assignmentCall()

      const currentUnlockedBalance = await registry.unlockedBalanceOf(recipient)
      assert.equal(previousUnlockedBalance.toString(), currentUnlockedBalance.toString(), 'unlocked balances do not match')
    })

    it('increments the staked balance for the recipient', async () => {
      const previousTotalStake = await registry.totalStaked()
      const previousJurorStake = await registry.totalStakedFor(recipient)

      await assignmentCall()

      const currentTotalStake = await registry.totalStaked()
      assert.equal(previousTotalStake.toString(), currentTotalStake.toString(), 'total stake amounts do not match')

      const currentJurorStake = await registry.totalStakedFor(recipient)
      assert.equal(previousJurorStake.plus(amount).toString(), currentJurorStake.toString(), 'recipient stake amounts do not match')
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
      const { tx } = await assignmentCall()
      const receipt = await web3.eth.getTransactionReceipt(tx)
      const logs = decodeEventsOfType({ receipt }, JurorsRegistry.abi, 'JurorAvailableBalanceChanged')

      assertAmountOfEvents({ logs }, 'JurorAvailableBalanceChanged')
      assertEvent({ logs }, 'JurorAvailableBalanceChanged', { juror: web3.toChecksumAddress(recipient), amount, positive: true })
    })
  }

  describe('assignTokens', () => {
    context('when the registry is initialized', () => {
      beforeEach('initialize registry', async () => {
        await registry.init(registryOwner.address, ANJ.address, MIN_ACTIVE_TOKENS)
      })

      context('when the sender is the owner', () => {
        context('when the given amount is zero', () => {
          const amount = 0

          it('reverts', async () => {
            await assertRevert(registryOwner.assignTokens(juror, amount), 'REGISTRY_INVALID_ZERO_AMOUNT')
          })
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
          await assertRevert(registry.assignTokens(juror, bigExp(100, 18), { from }), 'REGISTRY_SENDER_NOT_OWNER')
        })
      })
    })

    context('when the registry is not initialized', () => {
      it('reverts', async () => {
        await assertRevert(registryOwner.assignTokens(juror, bigExp(100, 18)), 'REGISTRY_SENDER_NOT_OWNER')
      })
    })
  })

  describe('burnTokens', () => {
    context('when the registry is initialized', () => {
      beforeEach('initialize registry', async () => {
        await registry.init(registryOwner.address, ANJ.address, MIN_ACTIVE_TOKENS)
      })

      context('when the sender is the owner', () => {
        context('when the given amount is zero', () => {
          const amount = 0

          it('reverts', async () => {
            await assertRevert(registryOwner.burnTokens(amount), 'REGISTRY_INVALID_ZERO_AMOUNT')
          })
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
          await assertRevert(registry.burnTokens(bigExp(100, 18), { from }), 'REGISTRY_SENDER_NOT_OWNER')
        })
      })
    })

    context('when the registry is not initialized', () => {
      it('reverts', async () => {
        await assertRevert(registryOwner.burnTokens(bigExp(100, 18)), 'REGISTRY_SENDER_NOT_OWNER')
      })
    })
  })
})
