const { buildHelper } = require('../helpers/controller')(web3, artifacts)
const { assertRevert } = require('../helpers/assertThrow')
const { decodeEventsOfType } = require('../helpers/decodeEvent')
const { assertBn, bn, bigExp, MAX_UINT256 } = require('../helpers/numbers')
const { assertEvent, assertAmountOfEvents } = require('../helpers/assertEvent')

const JurorsRegistry = artifacts.require('JurorsRegistry')
const Court = artifacts.require('CourtMockForRegistry')
const ERC20 = artifacts.require('ERC20Mock')

contract('JurorsRegistry', ([_, juror, someone]) => {
  let controller, registry, court, ANJ

  const TOTAL_ACTIVE_BALANCE_LIMIT = bigExp(100e6, 18)
  const BURN_ADDRESS = '0x000000000000000000000000000000000000dead'

  beforeEach('create base contracts', async () => {
    controller = await buildHelper().deploy()
    ANJ = await ERC20.new('ANJ Token', 'ANJ', 18)

    registry = await JurorsRegistry.new(controller.address, ANJ.address, TOTAL_ACTIVE_BALANCE_LIMIT)
    await controller.setJurorsRegistry(registry.address)

    court = await Court.new(controller.address)
    await controller.setCourt(court.address)
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
      const logs = decodeEventsOfType(receipt, JurorsRegistry.abi, 'JurorAvailableBalanceChanged')

      assertAmountOfEvents({ logs }, 'JurorAvailableBalanceChanged', 0)
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
      const logs = decodeEventsOfType(receipt, JurorsRegistry.abi, 'JurorAvailableBalanceChanged')

      assertAmountOfEvents({ logs }, 'JurorAvailableBalanceChanged')
      assertEvent({ logs }, 'JurorAvailableBalanceChanged', { juror: recipient, amount, positive: true })
    })
  }

  describe('assignTokens', () => {
    context('when the sender is the court', () => {
      context('when the given amount is zero', () => {
        const amount = bn(0)

        itHandlesZeroTokenAssignmentsProperly(() => court.assignTokens(juror, amount), juror)
      })

      context('when the given amount is greater than zero', () => {
        context('when the juror did not have balance', () => {
          const amount = bigExp(100, 18)

          itHandlesTokenAssignmentsProperly(() => court.assignTokens(juror, amount), juror, amount)
        })

        context('when the juror already had some balance', () => {
          beforeEach('stake some balance', async () => {
            const initialBalance = bigExp(50, 18)
            await ANJ.generateTokens(juror, initialBalance)
            await ANJ.approveAndCall(registry.address, initialBalance, '0x', { from: juror })
          })

          context('when the given amount does not overflow', () => {
            const amount = bigExp(100, 18)

            itHandlesTokenAssignmentsProperly(() => court.assignTokens(juror, amount), juror, amount)
          })

          context('when the given amount does overflow', () => {
            const amount = MAX_UINT256

            it('reverts', async () => {
              await assertRevert(court.assignTokens(juror, amount), 'MATH_ADD_OVERFLOW')
            })
          })
        })
      })
    })

    context('when the sender is not the court', () => {
      const from = someone

      it('reverts', async () => {
        await assertRevert(registry.assignTokens(juror, bigExp(100, 18), { from }), 'CTD_SENDER_NOT_COURT_MODULE')
      })
    })
  })

  describe('burnTokens', () => {
    context('when the sender is the court', () => {
      context('when the given amount is zero', () => {
        const amount = bn(0)

        itHandlesZeroTokenAssignmentsProperly(() => court.burnTokens(amount), BURN_ADDRESS)
      })

      context('when the given amount is greater than zero', () => {
        context('when the juror did not have balance', () => {
          const amount = bigExp(100, 18)

          itHandlesTokenAssignmentsProperly(() => court.burnTokens(amount), BURN_ADDRESS, amount)
        })

        context('when the burn address already had some balance', () => {
          beforeEach('burn some balance', async () => {
            await court.burnTokens(bigExp(50, 18))
          })

          context('when the given amount does not overflow', () => {
            const amount = bigExp(100, 18)

            itHandlesTokenAssignmentsProperly(() => court.burnTokens(amount), BURN_ADDRESS, amount)
          })

          context('when the given amount does overflow', () => {
            const amount = MAX_UINT256

            it('reverts', async () => {
              await assertRevert(court.burnTokens(amount), 'MATH_ADD_OVERFLOW')
            })
          })
        })
      })
    })

    context('when the sender is not the court', () => {
      const from = someone

      it('reverts', async () => {
        await assertRevert(registry.burnTokens(bigExp(100, 18), { from }), 'CTD_SENDER_NOT_COURT_MODULE')
      })
    })
  })
})
