const { assertBn } = require('../helpers/asserts/assertBn')
const { bn, bigExp } = require('../helpers/lib/numbers')
const { buildHelper } = require('../helpers/wrappers/court')(web3, artifacts)
const { assertRevert } = require('../helpers/asserts/assertThrow')
const { ACTIVATE_DATA } = require('../helpers/utils/jurors')
const { REGISTRY_EVENTS } = require('../helpers/utils/events')
const { REGISTRY_ERRORS } = require('../helpers/utils/errors')
const { decodeEventsOfType } = require('../helpers/lib/decodeEvent')
const { assertEvent, assertAmountOfEvents } = require('../helpers/asserts/assertEvent')

const JurorsRegistry = artifacts.require('JurorsRegistry')
const DisputeManager = artifacts.require('DisputeManagerMockForRegistry')
const ERC20 = artifacts.require('ERC20Mock')

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

contract('JurorsRegistry', ([_, juror, anotherJuror]) => {
  let controller, registry, disputeManager, ANJ

  const MIN_ACTIVE_AMOUNT = bigExp(100, 18)
  const TOTAL_ACTIVE_BALANCE_LIMIT = bigExp(100e6, 18)

  before('create court and custom disputes module', async () => {
    controller = await buildHelper().deploy({ minActiveBalance: MIN_ACTIVE_AMOUNT })
    disputeManager = await DisputeManager.new(controller.address)
    await controller.setDisputeManager(disputeManager.address)
    ANJ = await ERC20.new('ANJ Token', 'ANJ', 18)
  })

  beforeEach('create jurors registry module', async () => {
    registry = await JurorsRegistry.new(controller.address, ANJ.address, TOTAL_ACTIVE_BALANCE_LIMIT)
    await controller.setJurorsRegistry(registry.address)
  })

  describe('stake', () => {
    const from = juror

    context('when the juror does not request to activate the tokens', () => {
      const data = '0xabcdef0123456789'

      const itHandlesStakesProperlyFor = (amount, data) => {
        context('when the juror has enough token balance', () => {
          beforeEach('mint and approve tokens', async () => {
            await ANJ.generateTokens(from, amount)
            await ANJ.approve(registry.address, amount, { from })
          })

          it('adds the staked amount to the available balance of the juror', async () => {
            const { active: previousActiveBalance, available: previousAvailableBalance, locked: previousLockedBalance, pendingDeactivation: previousDeactivationBalance } = await registry.balanceOf(juror)

            await registry.stake(amount, data, { from })

            const { active: currentActiveBalance, available: currentAvailableBalance, locked: currentLockedBalance, pendingDeactivation: currentDeactivationBalance } = await registry.balanceOf(juror)
            assertBn(previousAvailableBalance.add(amount), currentAvailableBalance, 'available balances do not match')

            assertBn(previousActiveBalance, currentActiveBalance, 'active balances do not match')
            assertBn(previousLockedBalance, currentLockedBalance, 'locked balances do not match')
            assertBn(previousDeactivationBalance, currentDeactivationBalance, 'deactivation balances do not match')
          })

          it('does not affect the active balance of the current term', async () => {
            const termId = await controller.getLastEnsuredTermId()
            const currentTermPreviousBalance = await registry.activeBalanceOfAt(from, termId)

            await registry.stake(amount, data, { from })

            const currentTermCurrentBalance = await registry.activeBalanceOfAt(from, termId)
            assertBn(currentTermPreviousBalance, currentTermCurrentBalance, 'current term active balances do not match')
          })

          it('does not affect the unlocked balance of the juror', async () => {
            const previousUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(juror)

            await registry.stake(amount, data, { from })

            await controller.mockIncreaseTerm()
            const currentUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(juror)
            assertBn(previousUnlockedActiveBalance, currentUnlockedActiveBalance, 'unlocked balances do not match')
          })

          it('updates the total staked for the juror', async () => {
            const previousTotalStake = await registry.totalStakedFor(juror)

            await registry.stake(amount, data, { from })

            const currentTotalStake = await registry.totalStakedFor(juror)
            assertBn(previousTotalStake.add(amount), currentTotalStake, 'total stake amounts do not match')
          })

          it('updates the total staked', async () => {
            const previousTotalStake = await registry.totalStaked()

            await registry.stake(amount, data, { from })

            const currentTotalStake = await registry.totalStaked()
            assertBn(previousTotalStake.add(amount), currentTotalStake, 'total stake amounts do not match')
          })

          it('transfers the tokens to the registry', async () => {
            const previousSenderBalance = await ANJ.balanceOf(from)
            const previousRegistryBalance = await ANJ.balanceOf(registry.address)

            await registry.stake(amount, data, { from })

            const currentSenderBalance = await ANJ.balanceOf(from)
            assertBn(previousSenderBalance.sub(amount), currentSenderBalance, 'sender balances do not match')

            const currentRegistryBalance = await ANJ.balanceOf(registry.address)
            assertBn(previousRegistryBalance.add(amount), currentRegistryBalance, 'registry balances do not match')
          })

          it('emits a stake event', async () => {
            const previousTotalStake = await registry.totalStakedFor(juror)

            const receipt = await registry.stake(amount, data, { from })

            assertAmountOfEvents(receipt, REGISTRY_EVENTS.STAKED)
            assertEvent(receipt, REGISTRY_EVENTS.STAKED, { user: juror, amount, total: previousTotalStake.add(amount), data })
          })
        })

        context('when the juror does not have enough token balance', () => {
          it('reverts', async () => {
            await assertRevert(registry.stake(amount, data, { from }), REGISTRY_ERRORS.TOKEN_TRANSFER_FAILED)
          })
        })
      }

      const itHandlesStakesProperlyForDifferentAmounts = (data) => {
        context('when the given amount is zero', () => {
          const amount = bn(0)

          it('reverts', async () => {
            await assertRevert(registry.stake(amount, data, { from }), REGISTRY_ERRORS.INVALID_ZERO_AMOUNT)
          })
        })

        context('when the given amount is lower than the minimum active value', () => {
          const amount = MIN_ACTIVE_AMOUNT.sub(bn(1))

          itHandlesStakesProperlyFor(amount, data)
        })

        context('when the given amount is greater than the minimum active value', () => {
          const amount = MIN_ACTIVE_AMOUNT.mul(bn(2))

          itHandlesStakesProperlyFor(amount, data)
        })
      }

      context('when the juror has not staked before', () => {
        itHandlesStakesProperlyForDifferentAmounts(data)
      })

      context('when the juror has already staked some tokens before', () => {
        beforeEach('stake some tokens', async () => {
          const initialAmount = bigExp(50, 18)
          await ANJ.generateTokens(from, initialAmount)
          await ANJ.approve(registry.address, initialAmount, { from })
          await registry.stake(initialAmount, '0x', { from })
        })

        itHandlesStakesProperlyForDifferentAmounts(data)
      })
    })

    context('when the juror requests to activate the tokens', () => {
      const data = ACTIVATE_DATA

      const itHandlesStakesProperlyFor = (amount, data) => {
        it('adds the staked amount to the active balance of the juror', async () => {
          const { active: previousActiveBalance, available: previousAvailableBalance, locked: previousLockedBalance, pendingDeactivation: previousDeactivationBalance } = await registry.balanceOf(juror)

          await registry.stake(amount, data, { from })

          const { active: currentActiveBalance, available: currentAvailableBalance, locked: currentLockedBalance, pendingDeactivation: currentDeactivationBalance } = await registry.balanceOf(juror)
          assertBn(previousActiveBalance.add(amount), currentActiveBalance, 'active balances do not match')

          assertBn(previousLockedBalance, currentLockedBalance, 'locked balances do not match')
          assertBn(previousAvailableBalance, currentAvailableBalance, 'available balances do not match')
          assertBn(previousDeactivationBalance, currentDeactivationBalance, 'deactivation balances do not match')
        })

        it('does not affect the active balance of the current term', async () => {
          const termId = await controller.getLastEnsuredTermId()
          const currentTermPreviousBalance = await registry.activeBalanceOfAt(from, termId)

          await registry.stake(amount, data, { from })

          const currentTermCurrentBalance = await registry.activeBalanceOfAt(from, termId)
          assertBn(currentTermPreviousBalance, currentTermCurrentBalance, 'current term active balances do not match')
        })

        it('updates the unlocked balance of the juror', async () => {
          const previousUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(juror)

          await registry.stake(amount, data, { from })

          await controller.mockIncreaseTerm()
          const currentUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(juror)
          assertBn(previousUnlockedActiveBalance.add(amount), currentUnlockedActiveBalance, 'unlocked balances do not match')
        })

        it('updates the total staked for the juror', async () => {
          const previousTotalStake = await registry.totalStakedFor(juror)

          await registry.stake(amount, data, { from })

          const currentTotalStake = await registry.totalStakedFor(juror)
          assertBn(previousTotalStake.add(amount), currentTotalStake, 'total stake amounts do not match')
        })

        it('updates the total staked', async () => {
          const previousTotalStake = await registry.totalStaked()

          await registry.stake(amount, data, { from })

          const currentTotalStake = await registry.totalStaked()
          assertBn(previousTotalStake.add(amount), currentTotalStake, 'total stake amounts do not match')
        })

        it('transfers the tokens to the registry', async () => {
          const previousSenderBalance = await ANJ.balanceOf(from)
          const previousRegistryBalance = await ANJ.balanceOf(registry.address)

          await registry.stake(amount, data, { from })

          const currentSenderBalance = await ANJ.balanceOf(from)
          assertBn(previousSenderBalance.sub(amount), currentSenderBalance, 'sender balances do not match')

          const currentRegistryBalance = await ANJ.balanceOf(registry.address)
          assertBn(previousRegistryBalance.add(amount), currentRegistryBalance, 'registry balances do not match')
        })

        it('emits a stake event', async () => {
          const previousTotalStake = await registry.totalStakedFor(juror)

          const receipt = await registry.stake(amount, data, { from })

          assertAmountOfEvents(receipt, REGISTRY_EVENTS.STAKED)
          assertEvent(receipt, REGISTRY_EVENTS.STAKED, { user: juror, amount, total: previousTotalStake.add(amount), data })
        })

        it('emits an activation event', async () => {
          const termId = await controller.getCurrentTermId()

          const receipt = await registry.stake(amount, data, { from })

          assertAmountOfEvents(receipt, REGISTRY_EVENTS.JUROR_ACTIVATED)
          assertEvent(receipt, REGISTRY_EVENTS.JUROR_ACTIVATED, { juror, fromTermId: termId.add(bn(1)), amount, sender: from })
        })
      }

      const itHandlesStakesProperlyForDifferentAmounts = (data) => {
        context('when the given amount is zero', () => {
          const amount = bn(0)

          it('reverts', async () => {
            await assertRevert(registry.stake(amount, data, { from }), REGISTRY_ERRORS.INVALID_ZERO_AMOUNT)
          })
        })

        context('when the given amount is lower than the minimum active value', () => {
          const amount = MIN_ACTIVE_AMOUNT.sub(bn(1))

          context('when the juror has enough token balance', () => {
            beforeEach('mint and approve tokens', async () => {
              await ANJ.generateTokens(from, amount)
              await ANJ.approve(registry.address, amount, { from })
            })

            it('reverts', async () => {
              await assertRevert(registry.stake(amount, data, { from }), REGISTRY_ERRORS.ACTIVE_BALANCE_BELOW_MIN)
            })
          })

          context('when the juror does not have enough token balance', () => {
            it('reverts', async () => {
              await assertRevert(registry.stake(amount, data, { from }), REGISTRY_ERRORS.ACTIVE_BALANCE_BELOW_MIN)
            })
          })
        })

        context('when the given amount is greater than the minimum active value', () => {
          const amount = MIN_ACTIVE_AMOUNT.mul(bn(2))

          context('when the juror has enough token balance', () => {
            beforeEach('mint and approve tokens', async () => {
              await ANJ.generateTokens(from, amount)
              await ANJ.approve(registry.address, amount, { from })
            })

            itHandlesStakesProperlyFor(amount, data)
          })

          context('when the juror does not have enough token balance', () => {
            it('reverts', async () => {
              await assertRevert(registry.stake(amount, data, { from }), REGISTRY_ERRORS.TOKEN_TRANSFER_FAILED)
            })
          })
        })
      }

      context('when the juror has not staked before', () => {
        itHandlesStakesProperlyForDifferentAmounts(data)
      })

      context('when the juror has already staked some tokens before', () => {
        beforeEach('stake some tokens', async () => {
          const initialAmount = bigExp(50, 18)
          await ANJ.generateTokens(from, initialAmount)
          await ANJ.approve(registry.address, initialAmount, { from })
          await registry.stake(initialAmount, '0x', { from })
        })

        itHandlesStakesProperlyForDifferentAmounts(data)
      })
    })
  })

  describe('stake for', () => {
    const from = juror

    const itHandlesStakesWithoutActivationProperlyFor = (recipient, amount, data) => {
      context('when the juror has enough token balance', () => {
        beforeEach('mint and approve tokens', async () => {
          await ANJ.generateTokens(from, amount)
          await ANJ.approve(registry.address, amount, { from })
        })

        it('adds the staked amount to the available balance of the recipient', async () => {
          const { active: previousActiveBalance, available: previousAvailableBalance, locked: previousLockedBalance, pendingDeactivation: previousDeactivationBalance } = await registry.balanceOf(recipient)

          await registry.stakeFor(recipient, amount, data, { from })

          const { active: currentActiveBalance, available: currentAvailableBalance, locked: currentLockedBalance, pendingDeactivation: currentDeactivationBalance } = await registry.balanceOf(recipient)
          assertBn(previousAvailableBalance.add(amount), currentAvailableBalance, 'recipient available balances do not match')

          assertBn(previousActiveBalance, currentActiveBalance, 'recipient active balances do not match')
          assertBn(previousLockedBalance, currentLockedBalance, 'recipient locked balances do not match')
          assertBn(previousDeactivationBalance, currentDeactivationBalance, 'recipient deactivation balances do not match')
        })

        it('does not affect the active balance of the current term', async () => {
          const termId = await controller.getLastEnsuredTermId()
          const currentTermPreviousBalance = await registry.activeBalanceOfAt(recipient, termId)

          await registry.stakeFor(recipient, amount, data, { from })

          const currentTermCurrentBalance = await registry.activeBalanceOfAt(recipient, termId)
          assertBn(currentTermPreviousBalance, currentTermCurrentBalance, 'current term active balances do not match')
        })

        if (recipient !== from) {
          it('does not affect the sender balances', async () => {
            const { active: previousActiveBalance, available: previousAvailableBalance, locked: previousLockedBalance, pendingDeactivation: previousDeactivationBalance } = await registry.balanceOf(from)

            await registry.stakeFor(recipient, amount, data, { from })

            const { active: currentActiveBalance, available: currentAvailableBalance, locked: currentLockedBalance, pendingDeactivation: currentDeactivationBalance } = await registry.balanceOf(from)
            assertBn(previousActiveBalance, currentActiveBalance, 'sender active balances do not match')
            assertBn(previousLockedBalance, currentLockedBalance, 'sender locked balances do not match')
            assertBn(previousAvailableBalance, currentAvailableBalance, 'sender available balances do not match')
            assertBn(previousDeactivationBalance, currentDeactivationBalance, 'deactivation balances do not match')
          })
        }

        it('does not affect the unlocked balance of the recipient', async () => {
          const previousSenderUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(from)
          const previousRecipientUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(recipient)

          await registry.stakeFor(recipient, amount, data, { from })

          await controller.mockIncreaseTerm()
          const currentRecipientUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(recipient)
          assertBn(previousRecipientUnlockedActiveBalance, currentRecipientUnlockedActiveBalance, 'recipient unlocked balances do not match')

          if (recipient !== from) {
            const currentSenderUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(from)
            assertBn(previousSenderUnlockedActiveBalance, currentSenderUnlockedActiveBalance, 'sender unlocked balances do not match')
          }
        })

        it('updates the total staked for the recipient', async () => {
          const previousSenderTotalStake = await registry.totalStakedFor(from)
          const previousRecipientTotalStake = await registry.totalStakedFor(recipient)

          await registry.stakeFor(recipient, amount, data, { from })

          const currentRecipientTotalStake = await registry.totalStakedFor(recipient)
          assertBn(previousRecipientTotalStake.add(amount), currentRecipientTotalStake, 'recipient total stake amounts do not match')

          if (recipient !== from) {
            const currentSenderTotalStake = await registry.totalStakedFor(from)
            assertBn(previousSenderTotalStake, currentSenderTotalStake, 'sender total stake amounts do not match')
          }
        })

        it('updates the total staked', async () => {
          const previousTotalStake = await registry.totalStaked()

          await registry.stakeFor(recipient, amount, data, { from })

          const currentTotalStake = await registry.totalStaked()
          assertBn(previousTotalStake.add(amount), currentTotalStake, 'total stake amounts do not match')
        })

        it('transfers the tokens to the registry', async () => {
          const previousSenderBalance = await ANJ.balanceOf(from)
          const previousRegistryBalance = await ANJ.balanceOf(registry.address)
          const previousRecipientBalance = await ANJ.balanceOf(recipient)

          await registry.stakeFor(recipient, amount, data, { from })

          const currentSenderBalance = await ANJ.balanceOf(from)
          assertBn(previousSenderBalance.sub(amount), currentSenderBalance, 'sender balances do not match')

          const currentRegistryBalance = await ANJ.balanceOf(registry.address)
          assertBn(previousRegistryBalance.add(amount), currentRegistryBalance, 'registry balances do not match')

          if (recipient !== from) {
            const currentRecipientBalance = await ANJ.balanceOf(recipient)
            assertBn(previousRecipientBalance, currentRecipientBalance, 'recipient balances do not match')
          }
        })

        it('emits a stake event', async () => {
          const previousTotalStake = await registry.totalStakedFor(recipient)

          const receipt = await registry.stakeFor(recipient, amount, data, { from })

          assertAmountOfEvents(receipt, REGISTRY_EVENTS.STAKED)
          assertEvent(receipt, REGISTRY_EVENTS.STAKED, { user: recipient, amount, total: previousTotalStake.add(amount), data })
        })
      })

      context('when the juror does not have enough token balance', () => {
        it('reverts', async () => {
          await assertRevert(registry.stakeFor(recipient, amount, data, { from }), REGISTRY_ERRORS.TOKEN_TRANSFER_FAILED)
        })
      })
    }

    const itHandlesStakesWithoutActivationProperlyForDifferentAmounts = (recipient, data) => {
      context('when the given amount is zero', () => {
        const amount = bn(0)

        it('reverts', async () => {
          await assertRevert(registry.stakeFor(recipient, amount, data, { from }), REGISTRY_ERRORS.INVALID_ZERO_AMOUNT)
        })
      })

      context('when the given amount is lower than the minimum active value', () => {
        const amount = MIN_ACTIVE_AMOUNT.sub(bn(1))

        itHandlesStakesWithoutActivationProperlyFor(recipient, amount, data)
      })

      context('when the given amount is greater than the minimum active value', () => {
        const amount = MIN_ACTIVE_AMOUNT.mul(bn(2))

        itHandlesStakesWithoutActivationProperlyFor(recipient, amount, data)
      })
    }

    context('when the juror does not request to activate the tokens', () => {
      const data = '0xabcdef0123456789'

      const itHandlesStakesProperlyForDifferentRecipients = (data) => {
        context('when the recipient and the sender are the same', async () => {
          const recipient = from

          itHandlesStakesWithoutActivationProperlyForDifferentAmounts(recipient, data)
        })

        context('when the recipient and the sender are not the same', async () => {
          const recipient = anotherJuror

          itHandlesStakesWithoutActivationProperlyForDifferentAmounts(recipient, data)
        })

        context('when the recipient is the zero address', async () => {
          const recipient = ZERO_ADDRESS

          itHandlesStakesWithoutActivationProperlyForDifferentAmounts(recipient, data)
        })
      }

      context('when the juror has not staked before', () => {
        itHandlesStakesProperlyForDifferentRecipients(data)
      })

      context('when the juror has already staked some tokens before', () => {
        beforeEach('stake some tokens', async () => {
          const initialAmount = bigExp(50, 18)
          await ANJ.generateTokens(from, initialAmount)
          await ANJ.approve(registry.address, initialAmount, { from })
          await registry.stake(initialAmount, '0x', { from })
        })

        itHandlesStakesProperlyForDifferentRecipients(data)
      })
    })

    context('when the juror requests to activate the tokens', () => {
      const data = ACTIVATE_DATA

      const itHandlesStakesWithActivationProperlyFor = (recipient, amount, data) => {
        it('adds the staked amount to the active balance of the recipient', async () => {
          const { active: previousActiveBalance, available: previousAvailableBalance, locked: previousLockedBalance, pendingDeactivation: previousDeactivationBalance } = await registry.balanceOf(recipient)

          await registry.stakeFor(recipient, amount, data, { from })

          const { active: currentActiveBalance, available: currentAvailableBalance, locked: currentLockedBalance, pendingDeactivation: currentDeactivationBalance } = await registry.balanceOf(recipient)
          assertBn(previousActiveBalance.add(amount), currentActiveBalance, 'recipient active balances do not match')

          assertBn(previousLockedBalance, currentLockedBalance, 'recipient locked balances do not match')
          assertBn(previousAvailableBalance, currentAvailableBalance, 'recipient available balances do not match')
          assertBn(previousDeactivationBalance, currentDeactivationBalance, 'recipient deactivation balances do not match')
        })

        it('does not affect the active balance of the current term', async () => {
          const termId = await controller.getLastEnsuredTermId()
          const currentTermPreviousBalance = await registry.activeBalanceOfAt(recipient, termId)

          await registry.stakeFor(recipient, amount, data, { from })

          const currentTermCurrentBalance = await registry.activeBalanceOfAt(recipient, termId)
          assertBn(currentTermPreviousBalance, currentTermCurrentBalance, 'current term active balances do not match')
        })

        if (recipient !== from) {
          it('does not affect the sender balances', async () => {
            const { active: previousActiveBalance, available: previousAvailableBalance, locked: previousLockedBalance, pendingDeactivation: previousDeactivationBalance } = await registry.balanceOf(from)

            await registry.stakeFor(recipient, amount, data, { from })

            const { active: currentActiveBalance, available: currentAvailableBalance, locked: currentLockedBalance, pendingDeactivation: currentDeactivationBalance } = await registry.balanceOf(from)
            assertBn(previousActiveBalance, currentActiveBalance, 'sender active balances do not match')
            assertBn(previousLockedBalance, currentLockedBalance, 'sender locked balances do not match')
            assertBn(previousAvailableBalance, currentAvailableBalance, 'sender available balances do not match')
            assertBn(previousDeactivationBalance, currentDeactivationBalance, 'deactivation balances do not match')
          })
        }

        it('updates the unlocked balance of the recipient', async () => {
          const previousSenderUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(from)
          const previousRecipientUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(recipient)

          await registry.stakeFor(recipient, amount, data, { from })

          await controller.mockIncreaseTerm()
          const currentRecipientUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(recipient)
          assertBn(previousRecipientUnlockedActiveBalance.add(amount), currentRecipientUnlockedActiveBalance, 'recipient unlocked balances do not match')

          if (recipient !== from) {
            const currentSenderUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(from)
            assertBn(previousSenderUnlockedActiveBalance, currentSenderUnlockedActiveBalance, 'sender unlocked balances do not match')
          }
        })

        it('updates the total staked for the recipient', async () => {
          const previousSenderTotalStake = await registry.totalStakedFor(from)
          const previousRecipientTotalStake = await registry.totalStakedFor(recipient)

          await registry.stakeFor(recipient, amount, data, { from })

          const currentRecipientTotalStake = await registry.totalStakedFor(recipient)
          assertBn(previousRecipientTotalStake.add(amount), currentRecipientTotalStake, 'recipient total stake amounts do not match')

          if (recipient !== from) {
            const currentSenderTotalStake = await registry.totalStakedFor(from)
            assertBn(previousSenderTotalStake, currentSenderTotalStake, 'sender total stake amounts do not match')
          }
        })

        it('updates the total staked', async () => {
          const previousTotalStake = await registry.totalStaked()

          await registry.stake(amount, data, { from })

          const currentTotalStake = await registry.totalStaked()
          assertBn(previousTotalStake.add(amount), currentTotalStake, 'total stake amounts do not match')
        })

        it('transfers the tokens to the registry', async () => {
          const previousSenderBalance = await ANJ.balanceOf(from)
          const previousRegistryBalance = await ANJ.balanceOf(registry.address)
          const previousRecipientBalance = await ANJ.balanceOf(recipient)

          await registry.stakeFor(recipient, amount, data, { from })

          const currentSenderBalance = await ANJ.balanceOf(from)
          assertBn(previousSenderBalance.sub(amount), currentSenderBalance, 'sender balances do not match')

          const currentRegistryBalance = await ANJ.balanceOf(registry.address)
          assertBn(previousRegistryBalance.add(amount), currentRegistryBalance, 'registry balances do not match')

          if (recipient !== from) {
            const currentRecipientBalance = await ANJ.balanceOf(recipient)
            assertBn(previousRecipientBalance, currentRecipientBalance, 'recipient balances do not match')
          }
        })

        it('emits a stake event', async () => {
          const previousTotalStake = await registry.totalStakedFor(recipient)

          const receipt = await registry.stakeFor(recipient, amount, data, { from })

          assertAmountOfEvents(receipt, REGISTRY_EVENTS.STAKED)
          assertEvent(receipt, REGISTRY_EVENTS.STAKED, { user: recipient, amount, total: previousTotalStake.add(amount), data })
        })

        it('emits an activation event', async () => {
          const termId = await controller.getCurrentTermId()

          const receipt = await registry.stakeFor(recipient, amount, data, { from })

          assertAmountOfEvents(receipt, REGISTRY_EVENTS.JUROR_ACTIVATED)
          assertEvent(receipt, REGISTRY_EVENTS.JUROR_ACTIVATED, { juror: recipient, fromTermId: termId.add(bn(1)), amount, sender: from })
        })
      }

      const itHandlesStakesWithActivationProperlyForDifferentAmounts = (recipient, data) => {
        context('when the given amount is zero', () => {
          const amount = bn(0)

          it('reverts', async () => {
            await assertRevert(registry.stakeFor(recipient, amount, data, { from }), REGISTRY_ERRORS.INVALID_ZERO_AMOUNT)
          })
        })

        context('when the given amount is lower than the minimum active value', () => {
          const amount = MIN_ACTIVE_AMOUNT.sub(bn(1))

          context('when the juror has enough token balance', () => {
            beforeEach('mint and approve tokens', async () => {
              await ANJ.generateTokens(from, amount)
              await ANJ.approve(registry.address, amount, { from })
            })

            it('reverts', async () => {
              await assertRevert(registry.stakeFor(recipient, amount, data, { from }), REGISTRY_ERRORS.ACTIVE_BALANCE_BELOW_MIN)
            })
          })

          context('when the juror does not have enough token balance', () => {
            it('reverts', async () => {
              await assertRevert(registry.stakeFor(recipient, amount, data, { from }), REGISTRY_ERRORS.ACTIVE_BALANCE_BELOW_MIN)
            })
          })
        })

        context('when the given amount is greater than the minimum active value', () => {
          const amount = MIN_ACTIVE_AMOUNT.mul(bn(2))

          context('when the juror has enough token balance', () => {
            beforeEach('mint and approve tokens', async () => {
              await ANJ.generateTokens(from, amount)
              await ANJ.approve(registry.address, amount, { from })
            })

            itHandlesStakesWithActivationProperlyFor(recipient, amount, data)
          })

          context('when the juror does not have enough token balance', () => {
            it('reverts', async () => {
              await assertRevert(registry.stakeFor(recipient, amount, data, { from }), REGISTRY_ERRORS.TOKEN_TRANSFER_FAILED)
            })
          })
        })
      }

      const itHandlesStakesProperlyForDifferentRecipients = (data) => {
        context('when the recipient and the sender are the same', async () => {
          const recipient = from

          itHandlesStakesWithActivationProperlyForDifferentAmounts(recipient, data)
        })

        context('when the recipient and the sender are not the same', async () => {
          const recipient = anotherJuror

          itHandlesStakesWithActivationProperlyForDifferentAmounts(recipient, data)
        })

        context('when the recipient is the zero address', async () => {
          const recipient = ZERO_ADDRESS

          itHandlesStakesWithActivationProperlyForDifferentAmounts(recipient, data)
        })
      }

      context('when the juror has not staked before', () => {
        itHandlesStakesProperlyForDifferentRecipients(data)
      })

      context('when the juror has already staked some tokens before', () => {
        beforeEach('stake some tokens', async () => {
          const initialAmount = bigExp(50, 18)
          await ANJ.generateTokens(from, initialAmount)
          await ANJ.approve(registry.address, initialAmount, { from })
          await registry.stake(initialAmount, '0x', { from })
        })

        itHandlesStakesProperlyForDifferentRecipients(data)
      })
    })
  })

  describe('approve and call', () => {
    const from = juror

    context('when the calling contract is ANJ', () => {
      context('when the juror does not request to activate the tokens', () => {
        const data = '0xabcdef0123456789'

        const itHandlesStakesProperlyFor = (amount, data) => {
          context('when the juror has enough token balance', () => {
            beforeEach('mint', async () => {
              await ANJ.generateTokens(from, amount)
            })

            it('adds the staked amount to the available balance of the juror', async () => {
              const { active: previousActiveBalance, available: previousAvailableBalance, locked: previousLockedBalance, pendingDeactivation: previousDeactivationBalance } = await registry.balanceOf(juror)

              await ANJ.approveAndCall(registry.address, amount, data, { from })

              const { active: currentActiveBalance, available: currentAvailableBalance, locked: currentLockedBalance, pendingDeactivation: currentDeactivationBalance } = await registry.balanceOf(juror)
              assertBn(previousAvailableBalance.add(amount), currentAvailableBalance, 'available balances do not match')

              assertBn(previousActiveBalance, currentActiveBalance, 'active balances do not match')
              assertBn(previousLockedBalance, currentLockedBalance, 'locked balances do not match')
              assertBn(previousDeactivationBalance, currentDeactivationBalance, 'deactivation balances do not match')
            })

            it('does not affect the unlocked balance of the juror', async () => {
              const previousUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(juror)

              await ANJ.approveAndCall(registry.address, amount, data, { from })

              await controller.mockIncreaseTerm()
              const currentUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(juror)
              assertBn(previousUnlockedActiveBalance, currentUnlockedActiveBalance, 'unlocked balances do not match')
            })

            it('updates the total staked for the juror', async () => {
              const previousTotalStake = await registry.totalStakedFor(juror)

              await ANJ.approveAndCall(registry.address, amount, data, { from })

              const currentTotalStake = await registry.totalStakedFor(juror)
              assertBn(previousTotalStake.add(amount), currentTotalStake, 'total stake amounts do not match')
            })

            it('updates the total staked', async () => {
              const previousTotalStake = await registry.totalStaked()

              await ANJ.approveAndCall(registry.address, amount, data, { from })

              const currentTotalStake = await registry.totalStaked()
              assertBn(previousTotalStake.add(amount), currentTotalStake, 'total stake amounts do not match')
            })

            it('transfers the tokens to the registry', async () => {
              const previousSenderBalance = await ANJ.balanceOf(from)
              const previousRegistryBalance = await ANJ.balanceOf(registry.address)

              await ANJ.approveAndCall(registry.address, amount, data, { from })

              const currentSenderBalance = await ANJ.balanceOf(from)
              assertBn(previousSenderBalance.sub(amount), currentSenderBalance, 'sender balances do not match')

              const currentRegistryBalance = await ANJ.balanceOf(registry.address)
              assertBn(previousRegistryBalance.add(amount), currentRegistryBalance, 'registry balances do not match')
            })

            it('emits a stake event', async () => {
              const previousTotalStake = await registry.totalStakedFor(juror)

              const receipt = await ANJ.approveAndCall(registry.address, amount, data, { from })
              const logs = decodeEventsOfType(receipt, JurorsRegistry.abi, REGISTRY_EVENTS.STAKED)

              assertAmountOfEvents({ logs }, REGISTRY_EVENTS.STAKED)
              assertEvent({ logs }, REGISTRY_EVENTS.STAKED, { user: juror, amount, total: previousTotalStake.add(amount), data })
            })
          })

          context('when the juror does not have enough token balance', () => {
            it('reverts', async () => {
              await assertRevert(registry.stake(amount, data, { from }), REGISTRY_ERRORS.TOKEN_TRANSFER_FAILED)
            })
          })
        }

        const itHandlesStakesProperlyForDifferentAmounts = (data) => {
          context('when the given amount is zero', () => {
            const amount = bn(0)

            it('reverts', async () => {
              await assertRevert(registry.stake(amount, data, { from }), REGISTRY_ERRORS.INVALID_ZERO_AMOUNT)
            })
          })

          context('when the given amount is lower than the minimum active value', () => {
            const amount = MIN_ACTIVE_AMOUNT.sub(bn(1))

            itHandlesStakesProperlyFor(amount, data)
          })

          context('when the given amount is greater than the minimum active value', () => {
            const amount = MIN_ACTIVE_AMOUNT.mul(bn(2))

            itHandlesStakesProperlyFor(amount, data)
          })
        }

        context('when the juror has not staked before', () => {
          itHandlesStakesProperlyForDifferentAmounts(data)
        })

        context('when the juror has already staked some tokens before', () => {
          beforeEach('stake some tokens', async () => {
            const initialAmount = bigExp(50, 18)
            await ANJ.generateTokens(from, initialAmount)
            await ANJ.approveAndCall(registry.address, initialAmount, '0x', { from })
          })

          itHandlesStakesProperlyForDifferentAmounts(data)
        })
      })

      context('when the juror requests to activate the tokens', () => {
        const data = ACTIVATE_DATA

        const itHandlesStakesProperlyFor = (amount, data) => {
          it('adds the staked amount to the active balance of the juror', async () => {
            const { active: previousActiveBalance, available: previousAvailableBalance, locked: previousLockedBalance, pendingDeactivation: previousDeactivationBalance } = await registry.balanceOf(juror)

            await ANJ.approveAndCall(registry.address, amount, data, { from })

            const { active: currentActiveBalance, available: currentAvailableBalance, locked: currentLockedBalance, pendingDeactivation: currentDeactivationBalance } = await registry.balanceOf(juror)
            assertBn(previousActiveBalance.add(amount), currentActiveBalance, 'active balances do not match')

            assertBn(previousLockedBalance, currentLockedBalance, 'locked balances do not match')
            assertBn(previousAvailableBalance, currentAvailableBalance, 'available balances do not match')
            assertBn(previousDeactivationBalance, currentDeactivationBalance, 'deactivation balances do not match')
          })

          it('does not affect the active balance of the current term', async () => {
            const termId = await controller.getLastEnsuredTermId()
            const currentTermPreviousBalance = await registry.activeBalanceOfAt(from, termId)

            await ANJ.approveAndCall(registry.address, amount, data, { from })

            const currentTermCurrentBalance = await registry.activeBalanceOfAt(from, termId)
            assertBn(currentTermPreviousBalance, currentTermCurrentBalance, 'current term active balances do not match')
          })

          it('updates the unlocked balance of the juror', async () => {
            const previousUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(juror)

            await ANJ.approveAndCall(registry.address, amount, data, { from })

            await controller.mockIncreaseTerm()
            const currentUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(juror)
            assertBn(previousUnlockedActiveBalance.add(amount), currentUnlockedActiveBalance, 'unlocked balances do not match')
          })

          it('updates the total staked for the juror', async () => {
            const previousTotalStake = await registry.totalStakedFor(juror)

            await ANJ.approveAndCall(registry.address, amount, data, { from })

            const currentTotalStake = await registry.totalStakedFor(juror)
            assertBn(previousTotalStake.add(amount), currentTotalStake, 'total stake amounts do not match')
          })

          it('updates the total staked', async () => {
            const previousTotalStake = await registry.totalStaked()

            await ANJ.approveAndCall(registry.address, amount, data, { from })

            const currentTotalStake = await registry.totalStaked()
            assertBn(previousTotalStake.add(amount), currentTotalStake, 'total stake amounts do not match')
          })

          it('transfers the tokens to the registry', async () => {
            const previousSenderBalance = await ANJ.balanceOf(from)
            const previousRegistryBalance = await ANJ.balanceOf(registry.address)

            await ANJ.approveAndCall(registry.address, amount, data, { from })

            const currentSenderBalance = await ANJ.balanceOf(from)
            assertBn(previousSenderBalance.sub(amount), currentSenderBalance, 'sender balances do not match')

            const currentRegistryBalance = await ANJ.balanceOf(registry.address)
            assertBn(previousRegistryBalance.add(amount), currentRegistryBalance, 'registry balances do not match')
          })

          it('emits a stake event', async () => {
            const previousTotalStake = await registry.totalStakedFor(juror)

            const receipt = await ANJ.approveAndCall(registry.address, amount, data, { from })
            const logs = decodeEventsOfType(receipt, JurorsRegistry.abi, REGISTRY_EVENTS.STAKED)

            assertAmountOfEvents({ logs }, REGISTRY_EVENTS.STAKED)
            assertEvent({ logs }, REGISTRY_EVENTS.STAKED, { user: juror, amount, total: previousTotalStake.add(amount), data })
          })

          it('emits an activation event', async () => {
            const termId = await controller.getCurrentTermId()

            const receipt = await ANJ.approveAndCall(registry.address, amount, data, { from })
            const logs = decodeEventsOfType(receipt, JurorsRegistry.abi, REGISTRY_EVENTS.JUROR_ACTIVATED)

            assertAmountOfEvents({ logs }, REGISTRY_EVENTS.JUROR_ACTIVATED)
            assertEvent({ logs }, REGISTRY_EVENTS.JUROR_ACTIVATED, { juror, fromTermId: termId.add(bn(1)), amount, sender: from })
          })
        }

        const itHandlesStakesProperlyForDifferentAmounts = (data) => {
          context('when the given amount is zero', () => {
            const amount = bn(0)

            it('reverts', async () => {
              await assertRevert(registry.stake(amount, data, { from }), REGISTRY_ERRORS.INVALID_ZERO_AMOUNT)
            })
          })

          context('when the given amount is lower than the minimum active value', () => {
            const amount = MIN_ACTIVE_AMOUNT.sub(bn(1))

            context('when the juror has enough token balance', () => {
              beforeEach('mint tokens', async () => {
                await ANJ.generateTokens(from, amount)
              })

              it('reverts', async () => {
                await assertRevert(registry.stake(amount, data, { from }), REGISTRY_ERRORS.ACTIVE_BALANCE_BELOW_MIN)
              })
            })

            context('when the juror does not have enough token balance', () => {
              it('reverts', async () => {
                await assertRevert(registry.stake(amount, data, { from }), REGISTRY_ERRORS.ACTIVE_BALANCE_BELOW_MIN)
              })
            })
          })

          context('when the given amount is greater than the minimum active value', () => {
            const amount = MIN_ACTIVE_AMOUNT.mul(bn(2))

            context('when the juror has enough token balance', () => {
              beforeEach('mint tokens', async () => {
                await ANJ.generateTokens(from, amount)
              })

              itHandlesStakesProperlyFor(amount, data)
            })

            context('when the juror does not have enough token balance', () => {
              it('reverts', async () => {
                await assertRevert(registry.stake(amount, data, { from }), REGISTRY_ERRORS.TOKEN_TRANSFER_FAILED)
              })
            })
          })
        }

        context('when the juror has not staked before', () => {
          itHandlesStakesProperlyForDifferentAmounts(data)
        })

        context('when the juror has already staked some tokens before', () => {
          beforeEach('stake some tokens', async () => {
            const initialAmount = bigExp(50, 18)
            await ANJ.generateTokens(from, initialAmount)
            await ANJ.approveAndCall(registry.address, initialAmount, '0x', { from })
          })

          itHandlesStakesProperlyForDifferentAmounts(data)
        })
      })
    })

    context('when the calling contract is another token', () => {
      it('reverts', async () => {
        const anotherToken = await ERC20.new('Another Token', 'ATK', 18)
        const jurorBalance = bigExp(100, 18)
        await anotherToken.generateTokens(juror, jurorBalance)

        await assertRevert(anotherToken.approveAndCall(registry.address, jurorBalance, ACTIVATE_DATA, { from: juror }), REGISTRY_ERRORS.TOKEN_APPROVE_NOT_ALLOWED)
      })
    })
  })

  describe('unstake', () => {
    const from = juror
    const data = '0xabcdef0123456789'

    const itRevertsForDifferentAmounts = () => {
      context('when the given amount is zero', () => {
        const amount = bn(0)

        it('reverts', async () => {
          await assertRevert(registry.unstake(amount, data, { from }), REGISTRY_ERRORS.INVALID_ZERO_AMOUNT)
        })
      })

      context('when the given amount is lower than the minimum active value', () => {
        const amount = MIN_ACTIVE_AMOUNT.sub(bn(1))

        it('reverts', async () => {
          await assertRevert(registry.unstake(amount, data, { from }), REGISTRY_ERRORS.NOT_ENOUGH_AVAILABLE_BALANCE)
        })
      })

      context('when the given amount is greater than the minimum active value', () => {
        const amount = MIN_ACTIVE_AMOUNT.mul(bn(2))

        it('reverts', async () => {
          await assertRevert(registry.unstake(amount, data, { from }), REGISTRY_ERRORS.NOT_ENOUGH_AVAILABLE_BALANCE)
        })
      })
    }

    context('when the juror has not staked before', () => {
      itRevertsForDifferentAmounts()
    })

    context('when the juror has already staked some tokens before', () => {
      const stakedBalance = MIN_ACTIVE_AMOUNT

      beforeEach('stake some tokens', async () => {
        await ANJ.generateTokens(from, stakedBalance)
        await ANJ.approve(registry.address, stakedBalance, { from })
        await registry.stake(stakedBalance, '0x', { from })
      })

      const itHandlesUnstakesProperlyFor = (amount, deactivationAmount = bn(0)) => {
        it('removes the unstaked amount from the available balance of the juror', async () => {
          const { active: previousActiveBalance, available: previousAvailableBalance, locked: previousLockedBalance, pendingDeactivation: previousDeactivationBalance } = await registry.balanceOf(juror)

          await registry.unstake(amount, data, { from })

          const { active: currentActiveBalance, available: currentAvailableBalance, locked: currentLockedBalance, pendingDeactivation: currentDeactivationBalance } = await registry.balanceOf(juror)
          assertBn(previousDeactivationBalance.sub(deactivationAmount), currentDeactivationBalance, 'deactivation balances do not match')
          assertBn(previousAvailableBalance.add(deactivationAmount).sub(amount), currentAvailableBalance, 'available balances do not match')

          assertBn(previousActiveBalance, currentActiveBalance, 'active balances do not match')
          assertBn(previousLockedBalance, currentLockedBalance, 'locked balances do not match')
        })

        it('does not affect the unlocked balance of the juror', async () => {
          const previousUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(juror)

          await registry.unstake(amount, data, { from })

          const currentUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(juror)
          assertBn(previousUnlockedActiveBalance, currentUnlockedActiveBalance, 'unlocked balances do not match')
        })

        it('updates the total staked', async () => {
          const previousTotalStake = await registry.totalStaked()

          await registry.unstake(amount, data, { from })

          const currentTotalStake = await registry.totalStaked()
          assertBn(previousTotalStake.sub(amount), currentTotalStake, 'total stake amounts do not match')
        })

        it('updates the total staked for the juror', async () => {
          const previousTotalStake = await registry.totalStakedFor(juror)

          await registry.unstake(amount, data, { from })

          const currentTotalStake = await registry.totalStakedFor(juror)
          assertBn(previousTotalStake.sub(amount), currentTotalStake, 'total stake amounts do not match')
        })

        it('transfers the tokens to the juror', async () => {
          const previousSenderBalance = await ANJ.balanceOf(from)
          const previousRegistryBalance = await ANJ.balanceOf(registry.address)

          await registry.unstake(amount, data, { from })

          const currentSenderBalance = await ANJ.balanceOf(from)
          assertBn(previousSenderBalance.add(amount), currentSenderBalance, 'sender balances do not match')

          const currentRegistryBalance = await ANJ.balanceOf(registry.address)
          assertBn(previousRegistryBalance.sub(amount), currentRegistryBalance, 'registry balances do not match')
        })

        it('emits an unstake event', async () => {
          const previousTotalStake = await registry.totalStakedFor(juror)

          const receipt = await registry.unstake(amount, data, { from })

          assertAmountOfEvents(receipt, REGISTRY_EVENTS.UNSTAKED)
          assertEvent(receipt, REGISTRY_EVENTS.UNSTAKED, { user: juror, amount, total: previousTotalStake.sub(amount), data })
        })

        if (deactivationAmount.gt(bn(0))) {
          it('emits a deactivation processed event', async () => {
            const termId = await controller.getCurrentTermId()
            const { availableTermId } = await registry.getDeactivationRequest(juror)

            const receipt = await registry.unstake(amount, data, { from })

            assertAmountOfEvents(receipt, REGISTRY_EVENTS.JUROR_DEACTIVATION_PROCESSED)
            assertEvent(receipt, REGISTRY_EVENTS.JUROR_DEACTIVATION_PROCESSED, { juror, amount: deactivationAmount, availableTermId, processedTermId: termId })
          })
        }
      }

      context('when the juror tokens were not activated', () => {
        context('when the given amount is zero', () => {
          const amount = bn(0)

          it('reverts', async () => {
            await assertRevert(registry.unstake(amount, data, { from }), REGISTRY_ERRORS.INVALID_ZERO_AMOUNT)
          })
        })

        context('when the given amount is lower than the available balance', () => {
          const amount = stakedBalance.sub(bn(1))

          itHandlesUnstakesProperlyFor(amount)
        })

        context('when the given amount is greater than the available balance', () => {
          const amount = stakedBalance.add(bn(1))

          it('reverts', async () => {
            await assertRevert(registry.unstake(amount, data, { from }), REGISTRY_ERRORS.NOT_ENOUGH_AVAILABLE_BALANCE)
          })
        })
      })

      context('when the juror tokens were activated', () => {
        const activeAmount = stakedBalance

        beforeEach('activate tokens', async () => {
          await registry.activate(stakedBalance, { from })
        })

        context('when the juror tokens were not deactivated', () => {
          itRevertsForDifferentAmounts()
        })

        context('when the juror tokens were deactivated', () => {
          const deactivationAmount = activeAmount

          beforeEach('deactivate tokens', async () => {
            await registry.deactivate(deactivationAmount, { from })
          })

          context('when the juror tokens are deactivated for the next term', () => {
            itRevertsForDifferentAmounts()
          })

          context('when the juror tokens are deactivated for the current term', () => {
            beforeEach('increment term', async () => {
              await controller.mockIncreaseTerm()
            })

            context('when the given amount is zero', () => {
              const amount = bn(0)

              it('reverts', async () => {
                await assertRevert(registry.unstake(amount, data, { from }), REGISTRY_ERRORS.INVALID_ZERO_AMOUNT)
              })
            })

            context('when the given amount is lower than the available balance', () => {
              const amount = stakedBalance.sub(bn(1))

              itHandlesUnstakesProperlyFor(amount, deactivationAmount)
            })

            context('when the given amount is greater than the available balance', () => {
              const amount = stakedBalance.add(bn(1))

              it('reverts', async () => {
                await assertRevert(registry.unstake(amount, data, { from }), REGISTRY_ERRORS.NOT_ENOUGH_AVAILABLE_BALANCE)
              })
            })
          })
        })
      })
    })
  })
})
