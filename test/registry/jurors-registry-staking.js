const { sha3 } = require('web3-utils')
const { bn, bigExp } = require('../helpers/numbers')
const { assertRevert } = require('../helpers/assertThrow')
const { decodeEventsOfType } = require('../helpers/decodeEvent')
const { assertEvent, assertAmountOfEvents } = require('../helpers/assertEvent')

const JurorsRegistry = artifacts.require('JurorsRegistry')
const ERC20 = artifacts.require('ERC20Mock')
const JurorsRegistryOwnerMock = artifacts.require('JurorsRegistryOwnerMock')

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

contract('JurorsRegistry', ([_, juror, anotherJuror]) => {
  let registry, registryOwner, ANJ

  const MIN_ACTIVE_AMOUNT = bigExp(100, 18)
  const ACTIVATE_DATA = sha3('activate(uint256)').slice(0, 10)

  beforeEach('create base contracts', async () => {
    registry = await JurorsRegistry.new()
    registryOwner = await JurorsRegistryOwnerMock.new(registry.address)
    ANJ = await ERC20.new('ANJ Token', 'ANJ', 18)
  })

  describe('stake', () => {
    const from = juror

    context('when the registry is initialized', () => {
      beforeEach('initialize registry', async () => {
        await registry.init(registryOwner.address, ANJ.address, MIN_ACTIVE_AMOUNT)
      })

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
              assert.equal(previousAvailableBalance.add(amount).toString(), currentAvailableBalance.toString(), 'available balances do not match')

              assert.equal(previousActiveBalance.toString(), currentActiveBalance.toString(), 'active balances do not match')
              assert.equal(previousLockedBalance.toString(), currentLockedBalance.toString(), 'locked balances do not match')
              assert.equal(previousDeactivationBalance.toString(), currentDeactivationBalance.toString(), 'deactivation balances do not match')
            })

            it('does not affect the active balance of the current term', async () => {
              const termId = await registryOwner.getLastEnsuredTermId()
              const currentTermPreviousBalance = await registry.activeBalanceOfAt(from, termId)

              await registry.stake(amount, data, { from })

              const currentTermCurrentBalance = await registry.activeBalanceOfAt(from, termId)
              assert.equal(currentTermPreviousBalance.toString(), currentTermCurrentBalance.toString(), 'current term active balances do not match')
            })

            it('does not affect the unlocked balance of the juror', async () => {
              const previousUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(juror)

              await registry.stake(amount, data, { from })

              const currentUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(juror)
              assert.equal(previousUnlockedActiveBalance.toString(), currentUnlockedActiveBalance.toString(), 'unlocked balances do not match')
            })

            it('updates the total staked for the juror', async () => {
              const previousTotalStake = await registry.totalStakedFor(juror)

              await registry.stake(amount, data, { from })

              const currentTotalStake = await registry.totalStakedFor(juror)
              assert.equal(previousTotalStake.add(amount).toString(), currentTotalStake.toString(), 'total stake amounts do not match')
            })

            it('updates the total staked', async () => {
              const previousTotalStake = await registry.totalStaked()

              await registry.stake(amount, data, { from })

              const currentTotalStake = await registry.totalStaked()
              assert.equal(previousTotalStake.add(amount).toString(), currentTotalStake.toString(), 'total stake amounts do not match')
            })

            it('transfers the tokens to the registry', async () => {
              const previousSenderBalance = await ANJ.balanceOf(from)
              const previousRegistryBalance = await ANJ.balanceOf(registry.address)

              await registry.stake(amount, data, { from })

              const currentSenderBalance = await ANJ.balanceOf(from)
              assert.equal(previousSenderBalance.sub(amount).toString(), currentSenderBalance.toString(), 'sender balances do not match')

              const currentRegistryBalance = await ANJ.balanceOf(registry.address)
              assert.equal(previousRegistryBalance.add(amount).toString(), currentRegistryBalance.toString(), 'registry balances do not match')
            })

            it('emits an available balance changed event', async () => {
              const receipt = await registry.stake(amount, data, { from })

              assertAmountOfEvents(receipt, 'JurorAvailableBalanceChanged')
              assertEvent(receipt, 'JurorAvailableBalanceChanged', { juror, amount, positive: true })
            })

            it('emits a stake event', async () => {
              const previousTotalStake = await registry.totalStakedFor(juror)

              const receipt = await registry.stake(amount, data, { from })

              assertAmountOfEvents(receipt, 'Staked')
              assertEvent(receipt, 'Staked', { user: juror, amount, total: previousTotalStake.add(amount), data })
            })
          })

          context('when the juror does not have enough token balance', () => {
            it('reverts', async () => {
              await assertRevert(registry.stake(amount, data, { from }), 'JR_TOKEN_TRANSFER_FAILED')
            })
          })
        }

        const itHandlesStakesProperlyForDifferentAmounts = (data) => {
          context('when the given amount is zero', () => {
            const amount = bn(0)

            it('reverts', async () => {
              await assertRevert(registry.stake(amount, data, { from }), 'JR_INVALID_ZERO_AMOUNT')
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
            assert.equal(previousActiveBalance.add(amount).toString(), currentActiveBalance.toString(), 'active balances do not match')

            assert.equal(previousLockedBalance.toString(), currentLockedBalance.toString(), 'locked balances do not match')
            assert.equal(previousAvailableBalance.toString(), currentAvailableBalance.toString(), 'available balances do not match')
            assert.equal(previousDeactivationBalance.toString(), currentDeactivationBalance.toString(), 'deactivation balances do not match')
          })

          it('does not affect the active balance of the current term', async () => {
            const termId = await registryOwner.getLastEnsuredTermId()
            const currentTermPreviousBalance = await registry.activeBalanceOfAt(from, termId)

            await registry.stake(amount, data, { from })

            const currentTermCurrentBalance = await registry.activeBalanceOfAt(from, termId)
            assert.equal(currentTermPreviousBalance.toString(), currentTermCurrentBalance.toString(), 'current term active balances do not match')
          })

          it('updates the unlocked balance of the juror', async () => {
            const previousUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(juror)

            await registry.stake(amount, data, { from })

            const currentUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(juror)
            assert.equal(previousUnlockedActiveBalance.add(amount).toString(), currentUnlockedActiveBalance.toString(), 'unlocked balances do not match')
          })

          it('updates the total staked for the juror', async () => {
            const previousTotalStake = await registry.totalStakedFor(juror)

            await registry.stake(amount, data, { from })

            const currentTotalStake = await registry.totalStakedFor(juror)
            assert.equal(previousTotalStake.add(amount).toString(), currentTotalStake.toString(), 'total stake amounts do not match')
          })

          it('updates the total staked', async () => {
            const previousTotalStake = await registry.totalStaked()

            await registry.stake(amount, data, { from })

            const currentTotalStake = await registry.totalStaked()
            assert.equal(previousTotalStake.add(amount).toString(), currentTotalStake.toString(), 'total stake amounts do not match')
          })

          it('transfers the tokens to the registry', async () => {
            const previousSenderBalance = await ANJ.balanceOf(from)
            const previousRegistryBalance = await ANJ.balanceOf(registry.address)

            await registry.stake(amount, data, { from })

            const currentSenderBalance = await ANJ.balanceOf(from)
            assert.equal(previousSenderBalance.sub(amount).toString(), currentSenderBalance.toString(), 'sender balances do not match')

            const currentRegistryBalance = await ANJ.balanceOf(registry.address)
            assert.equal(previousRegistryBalance.add(amount).toString(), currentRegistryBalance.toString(), 'registry balances do not match')
          })

          it('emits two available balance changed events', async () => {
            const receipt = await registry.stake(amount, data, { from })

            assertAmountOfEvents(receipt, 'JurorAvailableBalanceChanged', 2)
            assertEvent(receipt, 'JurorAvailableBalanceChanged', { juror, amount, positive: true }, 0)
            assertEvent(receipt, 'JurorAvailableBalanceChanged', { juror, amount, positive: false }, 1)
          })

          it('emits a stake event', async () => {
            const previousTotalStake = await registry.totalStakedFor(juror)

            const receipt = await registry.stake(amount, data, { from })

            assertAmountOfEvents(receipt, 'Staked')
            assertEvent(receipt, 'Staked', { user: juror, amount, total: previousTotalStake.add(amount), data })
          })

          it('emits an activation event', async () => {
            const receipt = await registry.stake(amount, data, { from })

            assertAmountOfEvents(receipt, 'JurorActivated')
            assertEvent(receipt, 'JurorActivated', { juror, fromTermId: 1, amount })
          })
        }

        const itHandlesStakesProperlyForDifferentAmounts = (data) => {
          context('when the given amount is zero', () => {
            const amount = bn(0)

            it('reverts', async () => {
              await assertRevert(registry.stake(amount, data, { from }), 'JR_INVALID_ZERO_AMOUNT')
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
                await assertRevert(registry.stake(amount, data, { from }), 'JR_ACTIVE_BALANCE_BELOW_MIN')
              })
            })

            context('when the juror does not have enough token balance', () => {
              it('reverts', async () => {
                await assertRevert(registry.stake(amount, data, { from }), 'JR_ACTIVE_BALANCE_BELOW_MIN')
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
                await assertRevert(registry.stake(amount, data, { from }), 'JR_TOKEN_TRANSFER_FAILED')
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

    context('when the registry is not initialized', () => {
      it('reverts', async () => {
        await assertRevert(registry.stake(bigExp(100, 18), '0x', { from }), 'INIT_NOT_INITIALIZED')
      })
    })
  })

  describe('stake for', () => {
    const from = juror

    context('when the registry is initialized', () => {
      beforeEach('initialize registry', async () => {
        await registry.init(registryOwner.address, ANJ.address, MIN_ACTIVE_AMOUNT)
      })

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
            assert.equal(previousAvailableBalance.add(amount).toString(), currentAvailableBalance.toString(), 'recipient available balances do not match')

            assert.equal(previousActiveBalance.toString(), currentActiveBalance.toString(), 'recipient active balances do not match')
            assert.equal(previousLockedBalance.toString(), currentLockedBalance.toString(), 'recipient locked balances do not match')
            assert.equal(previousDeactivationBalance.toString(), currentDeactivationBalance.toString(), 'recipient deactivation balances do not match')
          })

          it('does not affect the active balance of the current term', async () => {
            const termId = await registryOwner.getLastEnsuredTermId()
            const currentTermPreviousBalance = await registry.activeBalanceOfAt(recipient, termId)

            await registry.stakeFor(recipient, amount, data, { from })

            const currentTermCurrentBalance = await registry.activeBalanceOfAt(recipient, termId)
            assert.equal(currentTermPreviousBalance.toString(), currentTermCurrentBalance.toString(), 'current term active balances do not match')
          })

          if (recipient !== from) {
            it('does not affect the sender balances', async () => {
              const { active: previousActiveBalance, available: previousAvailableBalance, locked: previousLockedBalance, pendingDeactivation: previousDeactivationBalance } = await registry.balanceOf(from)

              await registry.stakeFor(recipient, amount, data, { from })

              const { active: currentActiveBalance, available: currentAvailableBalance, locked: currentLockedBalance, pendingDeactivation: currentDeactivationBalance } = await registry.balanceOf(from)
              assert.equal(previousActiveBalance.toString(), currentActiveBalance.toString(), 'sender active balances do not match')
              assert.equal(previousLockedBalance.toString(), currentLockedBalance.toString(), 'sender locked balances do not match')
              assert.equal(previousAvailableBalance.toString(), currentAvailableBalance.toString(), 'sender available balances do not match')
              assert.equal(previousDeactivationBalance.toString(), currentDeactivationBalance.toString(), 'deactivation balances do not match')
            })
          }

          it('does not affect the unlocked balance of the recipient', async () => {
            const previousSenderUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(from)
            const previousRecipientUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(recipient)

            await registry.stakeFor(recipient, amount, data, { from })

            const currentRecipientUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(recipient)
            assert.equal(previousRecipientUnlockedActiveBalance.toString(), currentRecipientUnlockedActiveBalance.toString(), 'recipient unlocked balances do not match')

            if (recipient !== from) {
              const currentSenderUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(from)
              assert.equal(previousSenderUnlockedActiveBalance.toString(), currentSenderUnlockedActiveBalance.toString(), 'sender unlocked balances do not match')
            }
          })

          it('updates the total staked for the recipient', async () => {
            const previousSenderTotalStake = await registry.totalStakedFor(from)
            const previousRecipientTotalStake = await registry.totalStakedFor(recipient)

            await registry.stakeFor(recipient, amount, data, { from })

            const currentRecipientTotalStake = await registry.totalStakedFor(recipient)
            assert.equal(previousRecipientTotalStake.add(amount).toString(), currentRecipientTotalStake.toString(), 'recipient total stake amounts do not match')

            if (recipient !== from) {
              const currentSenderTotalStake = await registry.totalStakedFor(from)
              assert.equal(previousSenderTotalStake.toString(), currentSenderTotalStake.toString(), 'sender total stake amounts do not match')
            }
          })

          it('updates the total staked', async () => {
            const previousTotalStake = await registry.totalStaked()

            await registry.stakeFor(recipient, amount, data, { from })

            const currentTotalStake = await registry.totalStaked()
            assert.equal(previousTotalStake.add(amount).toString(), currentTotalStake.toString(), 'total stake amounts do not match')
          })

          it('transfers the tokens to the registry', async () => {
            const previousSenderBalance = await ANJ.balanceOf(from)
            const previousRegistryBalance = await ANJ.balanceOf(registry.address)
            const previousRecipientBalance = await ANJ.balanceOf(recipient)

            await registry.stakeFor(recipient, amount, data, { from })

            const currentSenderBalance = await ANJ.balanceOf(from)
            assert.equal(previousSenderBalance.sub(amount).toString(), currentSenderBalance.toString(), 'sender balances do not match')

            const currentRegistryBalance = await ANJ.balanceOf(registry.address)
            assert.equal(previousRegistryBalance.add(amount).toString(), currentRegistryBalance.toString(), 'registry balances do not match')

            if (recipient !== from) {
              const currentRecipientBalance = await ANJ.balanceOf(recipient)
              assert.equal(previousRecipientBalance.toString(), currentRecipientBalance.toString(), 'recipient balances do not match')
            }
          })

          it('emits an available balance changed event', async () => {
            const receipt = await registry.stakeFor(recipient, amount, data, { from })

            assertAmountOfEvents(receipt, 'JurorAvailableBalanceChanged')
            assertEvent(receipt, 'JurorAvailableBalanceChanged', { juror: recipient, amount, positive: true })
          })

          it('emits a stake event', async () => {
            const previousTotalStake = await registry.totalStakedFor(recipient)

            const receipt = await registry.stakeFor(recipient, amount, data, { from })

            assertAmountOfEvents(receipt, 'Staked')
            assertEvent(receipt, 'Staked', { user: recipient, amount, total: previousTotalStake.add(amount), data })
          })
        })

        context('when the juror does not have enough token balance', () => {
          it('reverts', async () => {
            await assertRevert(registry.stakeFor(recipient, amount, data, { from }), 'JR_TOKEN_TRANSFER_FAILED')
          })
        })
      }

      const itHandlesStakesWithoutActivationProperlyForDifferentAmounts = (recipient, data) => {
        context('when the given amount is zero', () => {
          const amount = bn(0)

          it('reverts', async () => {
            await assertRevert(registry.stakeFor(recipient, amount, data, { from }), 'JR_INVALID_ZERO_AMOUNT')
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
            assert.equal(previousActiveBalance.add(amount).toString(), currentActiveBalance.toString(), 'recipient active balances do not match')

            assert.equal(previousLockedBalance.toString(), currentLockedBalance.toString(), 'recipient locked balances do not match')
            assert.equal(previousAvailableBalance.toString(), currentAvailableBalance.toString(), 'recipient available balances do not match')
            assert.equal(previousDeactivationBalance.toString(), currentDeactivationBalance.toString(), 'recipient deactivation balances do not match')
          })

          it('does not affect the active balance of the current term', async () => {
            const termId = await registryOwner.getLastEnsuredTermId()
            const currentTermPreviousBalance = await registry.activeBalanceOfAt(recipient, termId)

            await registry.stakeFor(recipient, amount, data, { from })

            const currentTermCurrentBalance = await registry.activeBalanceOfAt(recipient, termId)
            assert.equal(currentTermPreviousBalance.toString(), currentTermCurrentBalance.toString(), 'current term active balances do not match')
          })

          if (recipient !== from) {
            it('does not affect the sender balances', async () => {
              const { active: previousActiveBalance, available: previousAvailableBalance, locked: previousLockedBalance, pendingDeactivation: previousDeactivationBalance } = await registry.balanceOf(from)

              await registry.stakeFor(recipient, amount, data, { from })

              const { active: currentActiveBalance, available: currentAvailableBalance, locked: currentLockedBalance, pendingDeactivation: currentDeactivationBalance } = await registry.balanceOf(from)
              assert.equal(previousActiveBalance.toString(), currentActiveBalance.toString(), 'sender active balances do not match')
              assert.equal(previousLockedBalance.toString(), currentLockedBalance.toString(), 'sender locked balances do not match')
              assert.equal(previousAvailableBalance.toString(), currentAvailableBalance.toString(), 'sender available balances do not match')
              assert.equal(previousDeactivationBalance.toString(), currentDeactivationBalance.toString(), 'deactivation balances do not match')
            })
          }

          it('updates the unlocked balance of the recipient', async () => {
            const previousSenderUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(from)
            const previousRecipientUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(recipient)

            await registry.stakeFor(recipient, amount, data, { from })

            const currentRecipientUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(recipient)
            assert.equal(previousRecipientUnlockedActiveBalance.add(amount).toString(), currentRecipientUnlockedActiveBalance.toString(), 'recipient unlocked balances do not match')

            if (recipient !== from) {
              const currentSenderUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(from)
              assert.equal(previousSenderUnlockedActiveBalance.toString(), currentSenderUnlockedActiveBalance.toString(), 'sender unlocked balances do not match')
            }
          })

          it('updates the total staked for the recipient', async () => {
            const previousSenderTotalStake = await registry.totalStakedFor(from)
            const previousRecipientTotalStake = await registry.totalStakedFor(juror)

            await registry.stakeFor(recipient, amount, data, { from })

            const currentRecipientTotalStake = await registry.totalStakedFor(juror)
            assert.equal(previousRecipientTotalStake.add(amount).toString(), currentRecipientTotalStake.toString(), 'recipient total stake amounts do not match')

            if (recipient !== from) {
              const currentSenderTotalStake = await registry.totalStakedFor(juror)
              assert.equal(previousSenderTotalStake.toString(), currentSenderTotalStake.toString(), 'sender total stake amounts do not match')
            }
          })

          it('updates the total staked', async () => {
            const previousTotalStake = await registry.totalStaked()

            await registry.stake(amount, data, { from })

            const currentTotalStake = await registry.totalStaked()
            assert.equal(previousTotalStake.add(amount).toString(), currentTotalStake.toString(), 'total stake amounts do not match')
          })

          it('transfers the tokens to the registry', async () => {
            const previousSenderBalance = await ANJ.balanceOf(from)
            const previousRegistryBalance = await ANJ.balanceOf(registry.address)
            const previousRecipientBalance = await ANJ.balanceOf(recipient)

            await registry.stakeFor(recipient, amount, data, { from })

            const currentSenderBalance = await ANJ.balanceOf(from)
            assert.equal(previousSenderBalance.sub(amount).toString(), currentSenderBalance.toString(), 'sender balances do not match')

            const currentRegistryBalance = await ANJ.balanceOf(registry.address)
            assert.equal(previousRegistryBalance.add(amount).toString(), currentRegistryBalance.toString(), 'registry balances do not match')

            if (recipient !== from) {
              const currentRecipientBalance = await ANJ.balanceOf(recipient)
              assert.equal(previousRecipientBalance.toString(), currentRecipientBalance.toString(), 'recipient balances do not match')
            }
          })

          it('emits two available balance changed events', async () => {
            const receipt = await registry.stakeFor(recipient, amount, data, { from })

            assertAmountOfEvents(receipt, 'JurorAvailableBalanceChanged', 2)
            assertEvent(receipt, 'JurorAvailableBalanceChanged', { juror: recipient, amount, positive: true }, 0)
            assertEvent(receipt, 'JurorAvailableBalanceChanged', { juror: recipient, amount, positive: false }, 1)
          })

          it('emits a stake event', async () => {
            const previousTotalStake = await registry.totalStakedFor(juror)

            const receipt = await registry.stakeFor(recipient, amount, data, { from })

            assertAmountOfEvents(receipt, 'Staked')
            assertEvent(receipt, 'Staked', { user: recipient, amount, total: previousTotalStake.add(amount), data })
          })

          it('emits an activation event', async () => {
            const receipt = await registry.stakeFor(recipient, amount, data, { from })

            assertAmountOfEvents(receipt, 'JurorActivated')
            assertEvent(receipt, 'JurorActivated', { juror: recipient, fromTermId: 1, amount })
          })
        }

        const itHandlesStakesWithActivationProperlyForDifferentAmounts = (recipient, data) => {
          context('when the given amount is zero', () => {
            const amount = bn(0)

            it('reverts', async () => {
              await assertRevert(registry.stakeFor(recipient, amount, data, { from }), 'JR_INVALID_ZERO_AMOUNT')
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
                await assertRevert(registry.stakeFor(recipient, amount, data, { from }), 'JR_ACTIVE_BALANCE_BELOW_MIN')
              })
            })

            context('when the juror does not have enough token balance', () => {
              it('reverts', async () => {
                await assertRevert(registry.stakeFor(recipient, amount, data, { from }), 'JR_ACTIVE_BALANCE_BELOW_MIN')
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
                await assertRevert(registry.stakeFor(recipient, amount, data, { from }), 'JR_TOKEN_TRANSFER_FAILED')
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
    })

    context('when the registry is not initialized', () => {
      it('reverts', async () => {
        await assertRevert(registry.stake(bigExp(100, 18), '0x', { from }), 'INIT_NOT_INITIALIZED')
      })
    })
  })

  describe('approve and call', () => {
    const from = juror

    context('when the registry is initialized', () => {
      beforeEach('initialize registry', async () => {
        await registry.init(registryOwner.address, ANJ.address, MIN_ACTIVE_AMOUNT)
      })

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
                assert.equal(previousAvailableBalance.add(amount).toString(), currentAvailableBalance.toString(), 'available balances do not match')

                assert.equal(previousActiveBalance.toString(), currentActiveBalance.toString(), 'active balances do not match')
                assert.equal(previousLockedBalance.toString(), currentLockedBalance.toString(), 'locked balances do not match')
                assert.equal(previousDeactivationBalance.toString(), currentDeactivationBalance.toString(), 'deactivation balances do not match')
              })

              it('does not affect the unlocked balance of the juror', async () => {
                const previousUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(juror)

                await ANJ.approveAndCall(registry.address, amount, data, { from })

                const currentUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(juror)
                assert.equal(previousUnlockedActiveBalance.toString(), currentUnlockedActiveBalance.toString(), 'unlocked balances do not match')
              })

              it('updates the total staked for the juror', async () => {
                const previousTotalStake = await registry.totalStakedFor(juror)

                await ANJ.approveAndCall(registry.address, amount, data, { from })

                const currentTotalStake = await registry.totalStakedFor(juror)
                assert.equal(previousTotalStake.add(amount).toString(), currentTotalStake.toString(), 'total stake amounts do not match')
              })

              it('updates the total staked', async () => {
                const previousTotalStake = await registry.totalStaked()

                await ANJ.approveAndCall(registry.address, amount, data, { from })

                const currentTotalStake = await registry.totalStaked()
                assert.equal(previousTotalStake.add(amount).toString(), currentTotalStake.toString(), 'total stake amounts do not match')
              })

              it('transfers the tokens to the registry', async () => {
                const previousSenderBalance = await ANJ.balanceOf(from)
                const previousRegistryBalance = await ANJ.balanceOf(registry.address)

                await ANJ.approveAndCall(registry.address, amount, data, { from })

                const currentSenderBalance = await ANJ.balanceOf(from)
                assert.equal(previousSenderBalance.sub(amount).toString(), currentSenderBalance.toString(), 'sender balances do not match')

                const currentRegistryBalance = await ANJ.balanceOf(registry.address)
                assert.equal(previousRegistryBalance.add(amount).toString(), currentRegistryBalance.toString(), 'registry balances do not match')
              })

              it('emits an available balance changed event', async () => {
                const receipt = await ANJ.approveAndCall(registry.address, amount, data, { from })
                const logs = decodeEventsOfType(receipt, JurorsRegistry.abi, 'JurorAvailableBalanceChanged')

                assertAmountOfEvents({ logs }, 'JurorAvailableBalanceChanged')
                assertEvent({ logs }, 'JurorAvailableBalanceChanged', { juror, amount, positive: true })
              })

              it('emits a stake event', async () => {
                const previousTotalStake = await registry.totalStakedFor(juror)

                const receipt = await ANJ.approveAndCall(registry.address, amount, data, { from })
                const logs = decodeEventsOfType(receipt, JurorsRegistry.abi, 'Staked')

                assertAmountOfEvents({ logs }, 'Staked')
                assertEvent({ logs }, 'Staked', { user: juror, amount, total: previousTotalStake.add(amount), data })
              })
            })

            context('when the juror does not have enough token balance', () => {
              it('reverts', async () => {
                await assertRevert(registry.stake(amount, data, { from }), 'JR_TOKEN_TRANSFER_FAILED')
              })
            })
          }

          const itHandlesStakesProperlyForDifferentAmounts = (data) => {
            context('when the given amount is zero', () => {
              const amount = bn(0)

              it('reverts', async () => {
                await assertRevert(registry.stake(amount, data, { from }), 'JR_INVALID_ZERO_AMOUNT')
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
            assert.equal(previousActiveBalance.add(amount).toString(), currentActiveBalance.toString(), 'active balances do not match')

            assert.equal(previousLockedBalance.toString(), currentLockedBalance.toString(), 'locked balances do not match')
            assert.equal(previousAvailableBalance.toString(), currentAvailableBalance.toString(), 'available balances do not match')
            assert.equal(previousDeactivationBalance.toString(), currentDeactivationBalance.toString(), 'deactivation balances do not match')
          })

          it('does not affect the active balance of the current term', async () => {
            const termId = await registryOwner.getLastEnsuredTermId()
            const currentTermPreviousBalance = await registry.activeBalanceOfAt(from, termId)

            await ANJ.approveAndCall(registry.address, amount, data, { from })

            const currentTermCurrentBalance = await registry.activeBalanceOfAt(from, termId)
            assert.equal(currentTermPreviousBalance.toString(), currentTermCurrentBalance.toString(), 'current term active balances do not match')
          })

          it('updates the unlocked balance of the juror', async () => {
            const previousUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(juror)

            await ANJ.approveAndCall(registry.address, amount, data, { from })

            const currentUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(juror)
            assert.equal(previousUnlockedActiveBalance.add(amount).toString(), currentUnlockedActiveBalance.toString(), 'unlocked balances do not match')
          })

          it('updates the total staked for the juror', async () => {
            const previousTotalStake = await registry.totalStakedFor(juror)

            await ANJ.approveAndCall(registry.address, amount, data, { from })

            const currentTotalStake = await registry.totalStakedFor(juror)
            assert.equal(previousTotalStake.add(amount).toString(), currentTotalStake.toString(), 'total stake amounts do not match')
          })

          it('updates the total staked', async () => {
            const previousTotalStake = await registry.totalStaked()

            await ANJ.approveAndCall(registry.address, amount, data, { from })

            const currentTotalStake = await registry.totalStaked()
            assert.equal(previousTotalStake.add(amount).toString(), currentTotalStake.toString(), 'total stake amounts do not match')
          })

          it('transfers the tokens to the registry', async () => {
            const previousSenderBalance = await ANJ.balanceOf(from)
            const previousRegistryBalance = await ANJ.balanceOf(registry.address)

            await ANJ.approveAndCall(registry.address, amount, data, { from })

            const currentSenderBalance = await ANJ.balanceOf(from)
            assert.equal(previousSenderBalance.sub(amount).toString(), currentSenderBalance.toString(), 'sender balances do not match')

            const currentRegistryBalance = await ANJ.balanceOf(registry.address)
            assert.equal(previousRegistryBalance.add(amount).toString(), currentRegistryBalance.toString(), 'registry balances do not match')
          })

          it('emits two available balance changed events', async () => {
            const receipt = await ANJ.approveAndCall(registry.address, amount, data, { from })
            const logs = decodeEventsOfType(receipt, JurorsRegistry.abi, 'JurorAvailableBalanceChanged')

            assertAmountOfEvents({ logs }, 'JurorAvailableBalanceChanged', 2)
            assertEvent({ logs }, 'JurorAvailableBalanceChanged', { juror: juror, amount, positive: true }, 0)
            assertEvent({ logs }, 'JurorAvailableBalanceChanged', { juror: juror, amount, positive: null }, 1)
          })

          it('emits a stake event', async () => {
            const previousTotalStake = await registry.totalStakedFor(juror)

            const receipt = await ANJ.approveAndCall(registry.address, amount, data, { from })
            const logs = decodeEventsOfType(receipt, JurorsRegistry.abi, 'Staked')

            assertAmountOfEvents({ logs }, 'Staked')
            assertEvent({ logs }, 'Staked', { user: juror, amount, total: previousTotalStake.add(amount), data })
          })

          it('emits an activation event', async () => {
            const receipt = await ANJ.approveAndCall(registry.address, amount, data, { from })
            const logs = decodeEventsOfType(receipt, JurorsRegistry.abi, 'JurorActivated')

            assertAmountOfEvents({ logs }, 'JurorActivated')
            assertEvent({ logs }, 'JurorActivated', { juror, fromTermId: 1, amount })
          })
        }

        const itHandlesStakesProperlyForDifferentAmounts = (data) => {
          context('when the given amount is zero', () => {
            const amount = bn(0)

            it('reverts', async () => {
              await assertRevert(registry.stake(amount, data, { from }), 'JR_INVALID_ZERO_AMOUNT')
            })
          })

          context('when the given amount is lower than the minimum active value', () => {
            const amount = MIN_ACTIVE_AMOUNT.sub(bn(1))

            context('when the juror has enough token balance', () => {
              beforeEach('mint tokens', async () => {
                await ANJ.generateTokens(from, amount)
              })

              it('reverts', async () => {
                await assertRevert(registry.stake(amount, data, { from }), 'JR_ACTIVE_BALANCE_BELOW_MIN')
              })
            })

            context('when the juror does not have enough token balance', () => {
              it('reverts', async () => {
                await assertRevert(registry.stake(amount, data, { from }), 'JR_ACTIVE_BALANCE_BELOW_MIN')
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
                await assertRevert(registry.stake(amount, data, { from }), 'JR_TOKEN_TRANSFER_FAILED')
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

          await assertRevert(anotherToken.approveAndCall(registry.address, jurorBalance, ACTIVATE_DATA, { from: juror }), 'JR_TOKEN_APPROVE_NOT_ALLOWED')
        })
      })
    })

    context('when the registry is not initialized', () => {
      it('reverts', async () => {
        await assertRevert(registry.stake(bigExp(100, 18), '0x', { from }), 'INIT_NOT_INITIALIZED')
      })
    })
  })

  describe('unstake', () => {
    const from = juror
    const data = '0xabcdef0123456789'

    context('when the registry is initialized', () => {
      beforeEach('initialize registry', async () => {
        await registry.init(registryOwner.address, ANJ.address, MIN_ACTIVE_AMOUNT)
      })

      const itRevertsForDifferentAmounts = () => {
        context('when the given amount is zero', () => {
          const amount = bn(0)

          it('reverts', async () => {
            await assertRevert(registry.unstake(amount, data, { from }), 'JR_INVALID_ZERO_AMOUNT')
          })
        })

        context('when the given amount is lower than the minimum active value', () => {
          const amount = MIN_ACTIVE_AMOUNT.sub(bn(1))

          it('reverts', async () => {
            await assertRevert(registry.unstake(amount, data, { from }), 'JR_NOT_ENOUGH_AVAILABLE_BALANCE')
          })
        })

        context('when the given amount is greater than the minimum active value', () => {
          const amount = MIN_ACTIVE_AMOUNT.mul(bn(2))

          it('reverts', async () => {
            await assertRevert(registry.unstake(amount, data, { from }), 'JR_NOT_ENOUGH_AVAILABLE_BALANCE')
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
            assert.equal(previousDeactivationBalance.sub(deactivationAmount).toString(), currentDeactivationBalance.toString(), 'deactivation balances do not match')
            assert.equal(previousAvailableBalance.add(deactivationAmount).sub(amount).toString(), currentAvailableBalance.toString(), 'available balances do not match')

            assert.equal(previousActiveBalance.toString(), currentActiveBalance.toString(), 'active balances do not match')
            assert.equal(previousLockedBalance.toString(), currentLockedBalance.toString(), 'locked balances do not match')
          })

          it('does not affect the unlocked balance of the juror', async () => {
            const previousUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(juror)

            await registry.unstake(amount, data, { from })

            const currentUnlockedActiveBalance = await registry.unlockedActiveBalanceOf(juror)
            assert.equal(previousUnlockedActiveBalance.toString(), currentUnlockedActiveBalance.toString(), 'unlocked balances do not match')
          })

          it('updates the total staked', async () => {
            const previousTotalStake = await registry.totalStaked()

            await registry.unstake(amount, data, { from })

            const currentTotalStake = await registry.totalStaked()
            assert.equal(previousTotalStake.sub(amount).toString(), currentTotalStake.toString(), 'total stake amounts do not match')
          })

          it('updates the total staked for the juror', async () => {
            const previousTotalStake = await registry.totalStakedFor(juror)

            await registry.unstake(amount, data, { from })

            const currentTotalStake = await registry.totalStakedFor(juror)
            assert.equal(previousTotalStake.sub(amount).toString(), currentTotalStake.toString(), 'total stake amounts do not match')
          })

          it('transfers the tokens to the juror', async () => {
            const previousSenderBalance = await ANJ.balanceOf(from)
            const previousRegistryBalance = await ANJ.balanceOf(registry.address)

            await registry.unstake(amount, data, { from })

            const currentSenderBalance = await ANJ.balanceOf(from)
            assert.equal(previousSenderBalance.add(amount).toString(), currentSenderBalance.toString(), 'sender balances do not match')

            const currentRegistryBalance = await ANJ.balanceOf(registry.address)
            assert.equal(previousRegistryBalance.sub(amount).toString(), currentRegistryBalance.toString(), 'registry balances do not match')
          })

          it('emits an unstake event', async () => {
            const previousTotalStake = await registry.totalStakedFor(juror)

            const receipt = await registry.unstake(amount, data, { from })

            assertAmountOfEvents(receipt, 'Unstaked')
            assertEvent(receipt, 'Unstaked', { user: juror, amount, total: previousTotalStake.sub(amount), data })
          })

          if (deactivationAmount.eq(bn(0))) {
            it('emits an available balance changed event', async () => {
              const receipt = await registry.unstake(amount, data, { from })

              assertAmountOfEvents(receipt, 'JurorAvailableBalanceChanged')
              assertEvent(receipt, 'JurorAvailableBalanceChanged', { juror, amount, positive: false })
            })
          } else {
            it('emits two available balance changed events', async () => {
              const receipt = await registry.unstake(amount, data, { from })

              assertAmountOfEvents(receipt, 'JurorAvailableBalanceChanged', 2)
              assertEvent(receipt, 'JurorAvailableBalanceChanged', { juror, amount: deactivationAmount, positive: true }, 0)
              assertEvent(receipt, 'JurorAvailableBalanceChanged', { juror, amount, positive: false }, 1)
            })

            it('emits a deactivation processed event', async () => {
              const termId = await registryOwner.getLastEnsuredTermId()

              const receipt = await registry.unstake(amount, data, { from })

              assertAmountOfEvents(receipt, 'JurorDeactivationProcessed')
              assertEvent(receipt, 'JurorDeactivationProcessed', { juror, amount: deactivationAmount, availableTermId: 1, processedTermId: termId })
            })
          }
        }

        context('when the juror tokens were not activated', () => {
          context('when the given amount is zero', () => {
            const amount = bn(0)

            it('reverts', async () => {
              await assertRevert(registry.unstake(amount, data, { from }), 'JR_INVALID_ZERO_AMOUNT')
            })
          })

          context('when the given amount is lower than the available balance', () => {
            const amount = stakedBalance.sub(bn(1))

            itHandlesUnstakesProperlyFor(amount)
          })

          context('when the given amount is greater than the available balance', () => {
            const amount = stakedBalance.add(bn(1))

            it('reverts', async () => {
              await assertRevert(registry.unstake(amount, data, { from }), 'JR_NOT_ENOUGH_AVAILABLE_BALANCE')
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
                await registryOwner.incrementTerm()
              })

              context('when the given amount is zero', () => {
                const amount = bn(0)

                it('reverts', async () => {
                  await assertRevert(registry.unstake(amount, data, { from }), 'JR_INVALID_ZERO_AMOUNT')
                })
              })

              context('when the given amount is lower than the available balance', () => {
                const amount = stakedBalance.sub(bn(1))

                itHandlesUnstakesProperlyFor(amount, deactivationAmount)
              })

              context('when the given amount is greater than the available balance', () => {
                const amount = stakedBalance.add(bn(1))

                it('reverts', async () => {
                  await assertRevert(registry.unstake(amount, data, { from }), 'JR_NOT_ENOUGH_AVAILABLE_BALANCE')
                })
              })
            })
          })
        })
      })
    })

    context('when the registry is not initialized', () => {
      it('reverts', async () => {
        await assertRevert(registry.stake(bigExp(100, 18), '0x', { from }), 'INIT_NOT_INITIALIZED')
      })
    })
  })
})
