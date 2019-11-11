const { assertBn } = require('../helpers/asserts/assertBn')
const { buildHelper } = require('../helpers/wrappers/court')(web3, artifacts)
const { assertRevert } = require('../helpers/asserts/assertThrow')
const { REGISTRY_EVENTS } = require('../helpers/utils/events')
const { decodeEventsOfType } = require('../helpers/lib/decodeEvent')
const { bigExp, bn, MAX_UINT256 } = require('../helpers/lib/numbers')
const { MATH_ERRORS, CONTROLLED_ERRORS } = require('../helpers/utils/errors')
const { assertEvent, assertAmountOfEvents } = require('../helpers/asserts/assertEvent')

const JurorsRegistry = artifacts.require('JurorsRegistry')
const DisputesManager = artifacts.require('DisputesManagerMockForRegistry')
const ERC20 = artifacts.require('ERC20Mock')

contract('JurorsRegistry', ([_, juror, someone]) => {
  let controller, registry, disputesManager, ANJ

  const TOTAL_ACTIVE_BALANCE_LIMIT = bigExp(100e6, 18)
  const BURN_ADDRESS = '0x000000000000000000000000000000000000dead'

  beforeEach('create base contracts', async () => {
    controller = await buildHelper().deploy()

    ANJ = await ERC20.new('ANJ Token', 'ANJ', 18)
    registry = await JurorsRegistry.new(controller.address, ANJ.address, TOTAL_ACTIVE_BALANCE_LIMIT)
    await controller.setJurorsRegistry(registry.address)

    disputesManager = await DisputesManager.new(controller.address)
    await controller.setDisputesManager(disputesManager.address)
  })

  const itHandlesZeroTokenAssignmentsProperly = (assignmentCall, recipient) => {
    it('does not affect any of the balances', async () => {
      const previousUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(recipient)
      const { active: previousActiveBalance, available: previousAvailableBalance, locked: previousLockedBalance, pendingDeactivation: previousDeactivationBalance } = await registry.balanceOf(recipient)

      await assignmentCall()

      await controller.mockIncreaseTerm()
      const currentUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(recipient)
      assertBn(previousUnlockedActiveBalance, currentUnlockedActiveBalance, 'unlocked balances do not match')

      const { active: currentActiveBalance, available: currentAvailableBalance, locked: currentLockedBalance, pendingDeactivation: currentDeactivationBalance } = await registry.balanceOf(recipient)
      assertBn(previousLockedBalance, currentLockedBalance, 'locked balances do not match')
      assertBn(previousActiveBalance, currentActiveBalance, 'active balances do not match')
      assertBn(previousAvailableBalance, currentAvailableBalance, 'available balances do not match')
      assertBn(previousDeactivationBalance, currentDeactivationBalance, 'deactivation balances do not match')
    })

    it('does not affect the staked balance', async () => {
      const previousTotalStake = await registry.totalStaked()
      const previousJurorStake = await registry.totalStakedFor(recipient)

      await assignmentCall()

      const currentTotalStake = await registry.totalStaked()
      assertBn(previousTotalStake, currentTotalStake, 'total stake amounts do not match')

      const currentJurorStake = await registry.totalStakedFor(recipient)
      assertBn(previousJurorStake, currentJurorStake, 'recipient stake amounts do not match')
    })

    it('does not affect the token balances', async () => {
      const previousJurorBalance = await ANJ.balanceOf(recipient)
      const previousRegistryBalance = await ANJ.balanceOf(registry.address)

      await assignmentCall()

      const currentSenderBalance = await ANJ.balanceOf(recipient)
      assertBn(previousJurorBalance, currentSenderBalance, 'recipient balances do not match')

      const currentRegistryBalance = await ANJ.balanceOf(registry.address)
      assertBn(previousRegistryBalance, currentRegistryBalance, 'registry balances do not match')
    })

    it('does not emit an available balance changed event', async () => {
      const receipt = await assignmentCall()
      const logs = decodeEventsOfType(receipt, JurorsRegistry.abi, REGISTRY_EVENTS.JUROR_AVAILABLE_BALANCE_CHANGED)

      assertAmountOfEvents({ logs }, REGISTRY_EVENTS.JUROR_AVAILABLE_BALANCE_CHANGED, 0)
    })
  }

  const itHandlesTokenAssignmentsProperly = (assignmentCall, recipient, amount) => {
    it('adds the given amount to the available balance', async () => {
      const { active: previousActiveBalance, available: previousAvailableBalance, locked: previousLockedBalance, pendingDeactivation: previousDeactivationBalance } = await registry.balanceOf(recipient)

      await assignmentCall()

      const { active: currentActiveBalance, available: currentAvailableBalance, locked: currentLockedBalance, pendingDeactivation: currentDeactivationBalance } = await registry.balanceOf(recipient)
      assertBn(previousAvailableBalance.add(amount), currentAvailableBalance, 'available balances do not match')

      assertBn(previousLockedBalance, currentLockedBalance, 'locked balances do not match')
      assertBn(previousActiveBalance, currentActiveBalance, 'active balances do not match')
      assertBn(previousDeactivationBalance, currentDeactivationBalance, 'deactivation balances do not match')
    })

    it('does not affect the unlocked balance of the recipient', async () => {
      const previousUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(recipient)

      await assignmentCall()

      await controller.mockIncreaseTerm()
      const currentUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(recipient)
      assertBn(previousUnlockedActiveBalance, currentUnlockedActiveBalance, 'unlocked balances do not match')
    })

    it('increments the staked balance for the recipient', async () => {
      const previousTotalStake = await registry.totalStaked()
      const previousJurorStake = await registry.totalStakedFor(recipient)

      await assignmentCall()

      const currentTotalStake = await registry.totalStaked()
      assertBn(previousTotalStake, currentTotalStake, 'total stake amounts do not match')

      const currentJurorStake = await registry.totalStakedFor(recipient)
      assertBn(previousJurorStake.add(amount), currentJurorStake, 'recipient stake amounts do not match')
    })

    it('does not affect the token balances', async () => {
      const previousJurorBalance = await ANJ.balanceOf(recipient)
      const previousRegistryBalance = await ANJ.balanceOf(registry.address)

      await assignmentCall()

      const currentSenderBalance = await ANJ.balanceOf(recipient)
      assertBn(previousJurorBalance, currentSenderBalance, 'recipient balances do not match')

      const currentRegistryBalance = await ANJ.balanceOf(registry.address)
      assertBn(previousRegistryBalance, currentRegistryBalance, 'registry balances do not match')
    })

    it('emits an available balance changed event', async () => {
      const receipt = await assignmentCall()
      const logs = decodeEventsOfType(receipt, JurorsRegistry.abi, REGISTRY_EVENTS.JUROR_AVAILABLE_BALANCE_CHANGED)

      assertAmountOfEvents({ logs }, REGISTRY_EVENTS.JUROR_AVAILABLE_BALANCE_CHANGED)
      assertEvent({ logs }, REGISTRY_EVENTS.JUROR_AVAILABLE_BALANCE_CHANGED, { juror: recipient, amount, positive: true })
    })
  }

  describe('assignTokens', () => {
    context('when the sender is the disputes manager', () => {
      context('when the given amount is zero', () => {
        const amount = bn(0)

        itHandlesZeroTokenAssignmentsProperly(() => disputesManager.assignTokens(juror, amount), juror)
      })

      context('when the given amount is greater than zero', () => {
        context('when the juror did not have balance', () => {
          const amount = bigExp(100, 18)

          itHandlesTokenAssignmentsProperly(() => disputesManager.assignTokens(juror, amount), juror, amount)
        })

        context('when the juror already had some balance', () => {
          beforeEach('stake some balance', async () => {
            const initialBalance = bigExp(50, 18)
            await ANJ.generateTokens(juror, initialBalance)
            await ANJ.approveAndCall(registry.address, initialBalance, '0x', { from: juror })
          })

          context('when the given amount does not overflow', () => {
            const amount = bigExp(100, 18)

            itHandlesTokenAssignmentsProperly(() => disputesManager.assignTokens(juror, amount), juror, amount)
          })

          context('when the given amount does overflow', () => {
            const amount = MAX_UINT256

            it('reverts', async () => {
              await assertRevert(disputesManager.assignTokens(juror, amount), MATH_ERRORS.ADD_OVERFLOW)
            })
          })
        })
      })
    })

    context('when the sender is not the disputes manager', () => {
      const from = someone

      it('reverts', async () => {
        await assertRevert(registry.assignTokens(juror, bigExp(100, 18), { from }), CONTROLLED_ERRORS.SENDER_NOT_DISPUTES_MODULE)
      })
    })
  })

  describe('burnTokens', () => {
    context('when the sender is the disputes manager', () => {
      context('when the given amount is zero', () => {
        const amount = bn(0)

        itHandlesZeroTokenAssignmentsProperly(() => disputesManager.burnTokens(amount), BURN_ADDRESS)
      })

      context('when the given amount is greater than zero', () => {
        context('when the juror did not have balance', () => {
          const amount = bigExp(100, 18)

          itHandlesTokenAssignmentsProperly(() => disputesManager.burnTokens(amount), BURN_ADDRESS, amount)
        })

        context('when the burn address already had some balance', () => {
          beforeEach('burn some balance', async () => {
            await disputesManager.burnTokens(bigExp(50, 18))
          })

          context('when the given amount does not overflow', () => {
            const amount = bigExp(100, 18)

            itHandlesTokenAssignmentsProperly(() => disputesManager.burnTokens(amount), BURN_ADDRESS, amount)
          })

          context('when the given amount does overflow', () => {
            const amount = MAX_UINT256

            it('reverts', async () => {
              await assertRevert(disputesManager.burnTokens(amount), MATH_ERRORS.ADD_OVERFLOW)
            })
          })
        })
      })
    })

    context('when the sender is not the disputes manager', () => {
      const from = someone

      it('reverts', async () => {
        await assertRevert(registry.burnTokens(bigExp(100, 18), { from }), CONTROLLED_ERRORS.SENDER_NOT_DISPUTES_MODULE)
      })
    })
  })
})
