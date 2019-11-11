const { assertBn } = require('../helpers/asserts/assertBn')
const { buildHelper } = require('../helpers/wrappers/court')(web3, artifacts)
const { assertRevert } = require('../helpers/asserts/assertThrow')
const { TREASURY_EVENTS } = require('../helpers/utils/events')
const { bn, bigExp, MAX_UINT256 } = require('../helpers/lib/numbers')
const { assertEvent, assertAmountOfEvents } = require('../helpers/asserts/assertEvent')
const { TREASURY_ERRORS, CONTROLLED_ERRORS, MATH_ERRORS } = require('../helpers/utils/errors')

const CourtTreasury = artifacts.require('CourtTreasury')
const ERC20 = artifacts.require('ERC20Mock')

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

contract('CourtTreasury', ([_, disputesManager, holder, someone]) => {
  let controller, treasury, DAI, ANT

  beforeEach('create treasury', async () => {
    controller = await buildHelper().deploy()
    treasury = await CourtTreasury.new(controller.address)
    await controller.setTreasury(treasury.address)
    await controller.setDisputesManagerMock(disputesManager)
  })

  describe('constructor', () => {
    context('when the initialization succeeds', () => {
      it('is initialized', async () => {
        treasury = await CourtTreasury.new(controller.address)

        assert.equal(await treasury.getController(), controller.address, 'treasury is not initialized')
      })
    })

    context('initialization fails', () => {
      context('when the given controller is the zero address', () => {
        const controllerAddress = ZERO_ADDRESS

        it('reverts', async () => {
          await assertRevert(CourtTreasury.new(controllerAddress), CONTROLLED_ERRORS.CONTROLLER_NOT_CONTRACT)
        })
      })

      context('when the given owner is not a contract address', () => {
        const controllerAddress = someone

        it('reverts', async () => {
          await assertRevert(CourtTreasury.new(controllerAddress), CONTROLLED_ERRORS.CONTROLLER_NOT_CONTRACT)
        })
      })
    })
  })

  describe('assign', () => {
    beforeEach('create tokens', async () => {
      DAI = await ERC20.new('DAI Token', 'DAI', 18)
      ANT = await ERC20.new('AN Token', 'ANT', 18)
    })

    const itHandlesDepositsProperly = account => {
      context('when the sender is the disputes manager', () => {
        const from = disputesManager

        context('when the account did not have previous balance', () => {
          context('when the given amount is zero', () => {
            const amount = bn(0)

            it('reverts', async () => {
              await assertRevert(treasury.assign(DAI.address, account, amount, { from }), TREASURY_ERRORS.DEPOSIT_AMOUNT_ZERO)
            })
          })

          context('when the given amount is greater than zero', () => {
            const amount = bigExp(10, 18)

            it('adds the new balance to the previous token balance', async () => {
              await treasury.assign(DAI.address, account, amount, { from })

              assertBn((await treasury.balanceOf(DAI.address, account)), amount, 'account balance do not match')
            })

            it('emits an event', async () => {
              const receipt = await treasury.assign(DAI.address, account, amount, { from })

              assertAmountOfEvents(receipt, TREASURY_EVENTS.ASSIGN)
              assertEvent(receipt, TREASURY_EVENTS.ASSIGN, { from: disputesManager, to: account, token: DAI.address, amount })
            })
          })
        })

        context('when the account had previous balance', () => {
          beforeEach('deposit some tokens', async () => {
            await treasury.assign(ANT.address, account, bigExp(100, 18), { from: disputesManager })
            await treasury.assign(DAI.address, account, bigExp(200, 18), { from: disputesManager })
          })

          context('when the given amount is zero', () => {
            const amount = bn(0)

            it('reverts', async () => {
              await assertRevert(treasury.assign(DAI.address, account, amount, { from }), TREASURY_ERRORS.DEPOSIT_AMOUNT_ZERO)
            })
          })

          context('when the given amount is greater than zero', () => {
            context('when the given amount does not overflow', () => {
              const amount = bigExp(10, 18)

              it('adds the new balance to the previous token balance', async () => {
                const previousBalance = await treasury.balanceOf(DAI.address, account)

                await treasury.assign(DAI.address, account, amount, { from })

                const currentBalance = await treasury.balanceOf(DAI.address, account)
                assertBn(currentBalance, previousBalance.add(amount), 'account balance do not match')
              })

              it('emits an event', async () => {
                const receipt = await treasury.assign(DAI.address, account, amount, { from })

                assertAmountOfEvents(receipt, TREASURY_EVENTS.ASSIGN)
                assertEvent(receipt, TREASURY_EVENTS.ASSIGN, { from: disputesManager, to: account, token: DAI.address, amount })
              })

              it('does not affect other token balances', async () => {
                const previousANTBalance = await treasury.balanceOf(ANT.address, account)

                await treasury.assign(DAI.address, account, amount, { from })

                const currentANTBalance = await treasury.balanceOf(ANT.address, account)
                assertBn(currentANTBalance, previousANTBalance, 'account balance do not match')
              })
            })

            context('when the given amount overflows', () => {
              const amount = MAX_UINT256

              it('reverts', async () => {
                await assertRevert(treasury.assign(DAI.address, account, amount, { from }), MATH_ERRORS.ADD_OVERFLOW)
              })
            })
          })
        })
      })

      context('when the sender is not the disputes manager', () => {
        const from = someone

        it('reverts', async () => {
          await assertRevert(treasury.assign(DAI.address, account, bigExp(10, 18), { from }), CONTROLLED_ERRORS.SENDER_NOT_DISPUTES_MODULE)
        })
      })
    }

    context('when the given recipient is not the zero address', () => {
      itHandlesDepositsProperly(holder)
    })

    context('when the given recipient is the zero address', () => {
      itHandlesDepositsProperly(ZERO_ADDRESS)
    })
  })

  describe('withdraw', () => {
    beforeEach('create tokens', async () => {
      DAI = await ERC20.new('DAI Token', 'DAI', 18)
      ANT = await ERC20.new('AN Token', 'ANT', 18)
    })

    context('when the sender has some balance', () => {
      const from = holder

      beforeEach('deposit some tokens', async () => {
        await treasury.assign(ANT.address, holder, bigExp(100, 18), { from: disputesManager })
        await treasury.assign(DAI.address, holder, bigExp(200, 18), { from: disputesManager })
      })

      context('when the given recipient is not the zero address', () => {
        const recipient = holder

        context('when the given amount is zero', () => {
          const amount = bn(0)

          it('reverts', async () => {
            await assertRevert(treasury.withdraw(DAI.address, recipient, amount, { from }), TREASURY_ERRORS.WITHDRAW_AMOUNT_ZERO)
          })
        })

        context('when the given amount is lower than the balance of the account', () => {
          const amount = bigExp(10, 18)

          context('when the treasury contract has enough tokens', () => {
            beforeEach('mint tokens', async () => {
              await DAI.generateTokens(treasury.address, amount)
            })

            it('subtracts the requested amount from the previous token balance', async () => {
              const previousBalance = await treasury.balanceOf(DAI.address, recipient)

              await treasury.withdraw(DAI.address, recipient, amount, { from })

              const currentBalance = await treasury.balanceOf(DAI.address, recipient)
              assertBn(currentBalance, previousBalance.sub(amount), 'account balance do not match')
            })

            it('transfers the requested amount to the recipient', async () => {
              await treasury.withdraw(DAI.address, recipient, amount, { from })

              const balance = await DAI.balanceOf(recipient)
              assertBn(balance, amount, 'token balance do not match')
            })

            it('emits an event', async () => {
              const receipt = await treasury.withdraw(DAI.address, recipient, amount, { from })

              assertAmountOfEvents(receipt, TREASURY_EVENTS.WITHDRAW)
              assertEvent(receipt, TREASURY_EVENTS.WITHDRAW, { from, to: recipient, token: DAI.address, amount })
            })

            it('does not affect other token balances', async () => {
              const previousANTBalance = await treasury.balanceOf(ANT.address, recipient)

              await treasury.withdraw(DAI.address, recipient, amount, { from })

              const currentANTBalance = await treasury.balanceOf(ANT.address, recipient)
              assertBn(currentANTBalance, previousANTBalance, 'account balance do not match')
            })
          })

          context('when the treasury contract does not have enough tokens', () => {
            it('reverts', async () => {
              await assertRevert(treasury.withdraw(DAI.address, recipient, amount, { from }), TREASURY_ERRORS.WITHDRAW_FAILED)
            })
          })
        })

        context('when the given amount is equal to the balance of the account', () => {
          const amount = bigExp(200, 18)

          context('when the treasury contract has enough tokens', () => {
            beforeEach('mint tokens', async () => {
              await DAI.generateTokens(treasury.address, amount)
            })

            it('reduces the account balance to 0', async () => {
              await treasury.withdraw(DAI.address, recipient, amount, { from })

              const currentBalance = await treasury.balanceOf(DAI.address, recipient)
              assertBn(currentBalance, 0, 'account balance do not match')
            })

            it('transfers the requested amount to the recipient', async () => {
              await treasury.withdraw(DAI.address, recipient, amount, { from })

              const balance = await DAI.balanceOf(recipient)
              assertBn(balance, amount, 'token balance do not match')
            })

            it('emits an event', async () => {
              const receipt = await treasury.withdraw(DAI.address, recipient, amount, { from })

              assertAmountOfEvents(receipt, TREASURY_EVENTS.WITHDRAW)
              assertEvent(receipt, TREASURY_EVENTS.WITHDRAW, { from, to: recipient, token: DAI.address, amount })
            })

            it('does not affect other token balances', async () => {
              const previousANTBalance = await treasury.balanceOf(ANT.address, recipient)

              await treasury.withdraw(DAI.address, recipient, amount, { from })

              const currentANTBalance = await treasury.balanceOf(ANT.address, recipient)
              assertBn(currentANTBalance, previousANTBalance, 'account balance do not match')
            })
          })

          context('when the treasury contract does not have enough tokens', () => {
            it('reverts', async () => {
              await assertRevert(treasury.withdraw(DAI.address, recipient, amount, { from }), TREASURY_ERRORS.WITHDRAW_FAILED)
            })
          })
        })

        context('when the given amount is grater than the balance of the account', () => {
          const amount = bigExp(201, 18)

          it('reverts', async () => {
            await assertRevert(treasury.withdraw(DAI.address, recipient, amount, { from }), TREASURY_ERRORS.WITHDRAW_INVALID_AMOUNT)
          })
        })
      })

      context('when the given recipient is the zero address', () => {
        const recipient = ZERO_ADDRESS

        context('when the given amount is zero', () => {
          const amount = bn(0)

          it('reverts', async () => {
            await assertRevert(treasury.withdraw(DAI.address, recipient, amount, { from }), TREASURY_ERRORS.WITHDRAW_AMOUNT_ZERO)
          })
        })

        context('when the given amount is lower than the balance of the account', () => {
          const amount = bigExp(10, 18)

          it('reverts', async () => {
            await assertRevert(treasury.withdraw(DAI.address, recipient, amount, { from }), TREASURY_ERRORS.WITHDRAW_FAILED)
          })
        })

        context('when the given amount is equal to the balance of the account', () => {
          const amount = bigExp(200, 18)

          it('reverts', async () => {
            await assertRevert(treasury.withdraw(DAI.address, recipient, amount, { from }), TREASURY_ERRORS.WITHDRAW_FAILED)
          })
        })

        context('when the given amount is grater than the balance of the account', () => {
          const amount = bigExp(201, 18)

          it('reverts', async () => {
            await assertRevert(treasury.withdraw(DAI.address, recipient, amount, { from }), TREASURY_ERRORS.WITHDRAW_INVALID_AMOUNT)
          })
        })
      })
    })

    context('when the sender does not have balance', () => {
      const from = holder

      it('reverts', async () => {
        await assertRevert(treasury.withdraw(DAI.address, holder, bigExp(10, 18), { from }), TREASURY_ERRORS.WITHDRAW_INVALID_AMOUNT)
      })
    })
  })

  describe('withdrawAll', () => {
    const from = someone
    const recipient = holder

    beforeEach('create tokens', async () => {
      DAI = await ERC20.new('DAI Token', 'DAI', 18)
      ANT = await ERC20.new('AN Token', 'ANT', 18)
    })

    context('when the holder accepts automatic withdraws', () => {
      beforeEach('accept automatic withdraws', async () => {
        await controller.setAutomaticWithdrawals(true, { from: recipient })
      })

      context('when the recipient has some assigned tokens', () => {
        const balance = bigExp(200, 18)

        beforeEach('deposit some tokens to the recipient', async () => {
          await treasury.assign(DAI.address, recipient, balance, { from: disputesManager })
          await treasury.assign(ANT.address, recipient, balance, { from: disputesManager })
        })

        context('when the treasury contract has enough tokens', () => {
          beforeEach('mint tokens', async () => {
            await DAI.generateTokens(treasury.address, balance)
          })

          it('subtracts the total balance from the recipient', async () => {
            await treasury.withdrawAll(DAI.address, recipient, { from })

            const currentBalance = await treasury.balanceOf(DAI.address, recipient)
            assertBn(currentBalance, 0, 'account balance do not match')
          })

          it('transfers the total balance to the recipient', async () => {
            await treasury.withdrawAll(DAI.address, recipient, { from })

            const currentBalance = await DAI.balanceOf(recipient)
            assertBn(currentBalance, balance, 'token balance do not match')
          })

          it('emits an event', async () => {
            const receipt = await treasury.withdrawAll(DAI.address, recipient, { from })

            assertAmountOfEvents(receipt, TREASURY_EVENTS.WITHDRAW)
            assertEvent(receipt, TREASURY_EVENTS.WITHDRAW, { from: recipient, to: recipient, token: DAI.address, amount: balance })
          })

          it('does not affect other token balances', async () => {
            const previousANTBalance = await treasury.balanceOf(ANT.address, recipient)

            await treasury.withdrawAll(DAI.address, recipient, { from })

            const currentANTBalance = await treasury.balanceOf(ANT.address, recipient)
            assertBn(currentANTBalance, previousANTBalance, 'account balance do not match')
          })
        })

        context('when the treasury contract does not have enough tokens', () => {
          it('reverts', async () => {
            await assertRevert(treasury.withdrawAll(DAI.address, recipient, { from }), TREASURY_ERRORS.WITHDRAW_FAILED)
          })
        })
      })

      context('when the recipient does not tokens assigned', () => {
        const from = holder

        it('reverts', async () => {
          await assertRevert(treasury.withdrawAll(DAI.address, recipient, { from }), TREASURY_ERRORS.WITHDRAW_AMOUNT_ZERO)
        })
      })
    })

    context('when the holder does not accept automatic withdraws', () => {
      it('reverts', async () => {
        await assertRevert(treasury.withdrawAll(DAI.address, recipient, { from }), TREASURY_ERRORS.WITHDRAWALS_DISALLOWED)
      })
    })
  })
})
