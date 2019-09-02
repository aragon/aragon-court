const { assertRevert } = require('../helpers/assertThrow')
const { bn, bigExp, MAX_UINT256 } = require('../helpers/numbers')
const { assertEvent, assertAmountOfEvents } = require('../helpers/assertEvent')

const MiniMeToken = artifacts.require('MiniMeToken')
const CourtAccounting = artifacts.require('CourtAccounting')

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

contract('CourtAccounting', ([_, owner, holder, someone]) => {
  let accounting, DAI, ANT

  beforeEach('create accounting', async () => {
    accounting = await CourtAccounting.new()
  })

  describe('init', () => {
    beforeEach('initialize the accounting', async () => {
      await accounting.init(owner)
    })

    it('sets the owner of the contract', async () => {
      assert.equal(await accounting.owner(), owner)
    })

    it('reverts when trying to initialize it again', async () => {
      await assertRevert(accounting.init(owner), 'ACCOUNTING_ALREADY_INITIALIZED')
    })
  })

  describe('assign', () => {
    beforeEach('initialize the accounting', async () => {
      await accounting.init(owner)
    })

    beforeEach('create tokens', async () => {
      DAI = await MiniMeToken.new(ZERO_ADDRESS, ZERO_ADDRESS, 0, 'DAI Token', 18, 'DAI', true)
      ANT = await MiniMeToken.new(ZERO_ADDRESS, ZERO_ADDRESS, 0, 'AN Token', 18, 'ANT', true)
    })

    const itHandlesDepositsProperly = account => {
      context('when the sender is the owner', () => {
        const from = owner

        context('when the account did not have previous balance', () => {

          context('when the given amount is zero', () => {
            const amount = bn(0)

            it('reverts', async () => {
              await assertRevert(accounting.assign(DAI.address, account, amount, { from }), 'ACCOUNTING_DEPOSIT_AMOUNT_ZERO')
            })
          })

          context('when the given amount is greater than zero', () => {
            const amount = bigExp(10, 18)

            it('adds the new balance to the previous token balance', async () => {
              await accounting.assign(DAI.address, account, amount, { from })

              assert.equal((await accounting.balanceOf(DAI.address, account)).toString(), amount.toString(), 'account balance do not match')
            })

            it('emits an event', async () => {
              const receipt = await accounting.assign(DAI.address, account, amount, { from })

              assertAmountOfEvents(receipt, 'Assign')
              assertEvent(receipt, 'Assign', { from: owner, to: account, token: DAI.address, amount })
            })
          })
        })

        context('when the account had previous balance', () => {
          beforeEach('deposit some tokens', async () => {
            await accounting.assign(ANT.address, account, bigExp(100, 18), { from: owner })
            await accounting.assign(DAI.address, account, bigExp(200, 18), { from: owner })
          })

          context('when the given amount is zero', () => {
            const amount = bn(0)

            it('reverts', async () => {
              await assertRevert(accounting.assign(DAI.address, account, amount, { from }), 'ACCOUNTING_DEPOSIT_AMOUNT_ZERO')
            })
          })

          context('when the given amount is greater than zero', () => {
            context('when the given amount does not overflow', () => {
              const amount = bigExp(10, 18)

              it('adds the new balance to the previous token balance', async () => {
                const previousBalance = await accounting.balanceOf(DAI.address, account)

                await accounting.assign(DAI.address, account, amount, { from })

                const currentBalance = await accounting.balanceOf(DAI.address, account)
                assert.equal(currentBalance.toString(), previousBalance.add(amount).toString(), 'account balance do not match')
              })

              it('emits an event', async () => {
                const receipt = await accounting.assign(DAI.address, account, amount, { from })

                assertAmountOfEvents(receipt, 'Assign')
                assertEvent(receipt, 'Assign', { from: owner, to: account, token: DAI.address, amount })
              })

              it('does not affect other token balances', async () => {
                const previousANTBalance = await accounting.balanceOf(ANT.address, account)

                await accounting.assign(DAI.address, account, amount, { from })

                const currentANTBalance = await accounting.balanceOf(ANT.address, account)
                assert.equal(currentANTBalance.toString(), previousANTBalance.toString(), 'account balance do not match')
              })
            })

            context('when the given amount overflows', () => {
              const amount = MAX_UINT256

              it('reverts', async () => {
                await assertRevert(accounting.assign(DAI.address, account, amount, { from }), 'MATH_ADD_OVERFLOW')
              })
            })
          })
        })
      })

      context('when the sender is not the owner', () => {
        const from = someone

        it('reverts', async () => {
          await assertRevert(accounting.assign(DAI.address, account, bigExp(10, 18), { from }), 'ACCOUNTING_SENDER_NOT_OWNER')
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
    beforeEach('initialize the accounting', async () => {
      await accounting.init(owner)
    })

    beforeEach('create tokens and mint to accounting', async () => {
      DAI = await MiniMeToken.new(ZERO_ADDRESS, ZERO_ADDRESS, 0, 'DAI Token', 18, 'DAI', true)
      ANT = await MiniMeToken.new(ZERO_ADDRESS, ZERO_ADDRESS, 0, 'AN Token', 18, 'ANT', true)
    })

    context('when the sender has some balance', () => {
      const from = holder

      beforeEach('deposit some tokens', async () => {
        await accounting.assign(ANT.address, holder, bigExp(100, 18), { from: owner })
        await accounting.assign(DAI.address, holder, bigExp(200, 18), { from: owner })
      })

      context('when the given recipient is not the zero address', () => {
        const recipient = holder

        context('when the given amount is zero', () => {
          const amount = bn(0)

          it('reverts', async () => {
            await assertRevert(accounting.withdraw(DAI.address, recipient, amount, { from }), 'ACCOUNTING_WITHDRAW_AMOUNT_ZERO')
          })
        })

        context('when the given amount is lower than the balance of the account', () => {
          const amount = bigExp(10, 18)

          context('when the accounting contract has enough tokens', () => {
            beforeEach('mint tokens', async () => {
              await DAI.generateTokens(accounting.address, amount)
            })

            it('subtracts the requested amount from the previous token balance', async () => {
              const previousBalance = await accounting.balanceOf(DAI.address, recipient)

              await accounting.withdraw(DAI.address, recipient, amount, { from })

              const currentBalance = await accounting.balanceOf(DAI.address, recipient)
              assert.equal(currentBalance.toString(), previousBalance.sub(amount).toString(), 'account balance do not match')
            })

            it('transfers the requested amount to the recipient', async () => {
              await accounting.withdraw(DAI.address, recipient, amount, { from })

              const balance = await DAI.balanceOf(recipient)
              assert.equal(balance.toString(), amount.toString(), 'token balance do not match')
            })

            it('emits an event', async () => {
              const receipt = await accounting.withdraw(DAI.address, recipient, amount, { from })

              assertAmountOfEvents(receipt, 'Withdraw')
              assertEvent(receipt, 'Withdraw', { from, to: recipient, token: DAI.address, amount })
            })

            it('does not affect other token balances', async () => {
              const previousANTBalance = await accounting.balanceOf(ANT.address, recipient)

              await accounting.withdraw(DAI.address, recipient, amount, { from })

              const currentANTBalance = await accounting.balanceOf(ANT.address, recipient)
              assert.equal(currentANTBalance.toString(), previousANTBalance.toString(), 'account balance do not match')
            })
          })

          context('when the accounting contract has enough tokens', () => {
            it('reverts', async () => {
              await assertRevert(accounting.withdraw(DAI.address, recipient, amount, { from }), 'ACCOUNTING_WITHDRAW_FAILED')
            })
          })
        })

        context('when the given amount is equal to the balance of the account', () => {
          const amount = bigExp(200, 18)

          context('when the accounting contract has enough tokens', () => {
            beforeEach('mint tokens', async () => {
              await DAI.generateTokens(accounting.address, amount)
            })

            it('reduces the account balance to 0', async () => {
              await accounting.withdraw(DAI.address, recipient, amount, { from })

              const currentBalance = await accounting.balanceOf(DAI.address, recipient)
              assert.equal(currentBalance.toString(), 0, 'account balance do not match')
            })

            it('transfers the requested amount to the recipient', async () => {
              await accounting.withdraw(DAI.address, recipient, amount, { from })

              const balance = await DAI.balanceOf(recipient)
              assert.equal(balance.toString(), amount.toString(), 'token balance do not match')
            })

            it('emits an event', async () => {
              const receipt = await accounting.withdraw(DAI.address, recipient, amount, { from })

              assertAmountOfEvents(receipt, 'Withdraw')
              assertEvent(receipt, 'Withdraw', { from, to: recipient, token: DAI.address, amount })
            })

            it('does not affect other token balances', async () => {
              const previousANTBalance = await accounting.balanceOf(ANT.address, recipient)

              await accounting.withdraw(DAI.address, recipient, amount, { from })

              const currentANTBalance = await accounting.balanceOf(ANT.address, recipient)
              assert.equal(currentANTBalance.toString(), previousANTBalance.toString(), 'account balance do not match')
            })
          })

          context('when the accounting contract has enough tokens', () => {
            it('reverts', async () => {
              await assertRevert(accounting.withdraw(DAI.address, recipient, amount, { from }), 'ACCOUNTING_WITHDRAW_FAILED')
            })
          })
        })

        context('when the given amount is grater than the balance of the account', () => {
          const amount = bigExp(201, 18)

          it('reverts', async () => {
            await assertRevert(accounting.withdraw(DAI.address, recipient, amount, { from }), 'ACCOUNTING_WITHDRAW_INVALID_AMOUNT')
          })
        })
      })

      context('when the given recipient is the zero address', () => {
        const recipient = ZERO_ADDRESS

        context('when the given amount is zero', () => {
          const amount = bn(0)

          it('reverts', async () => {
            await assertRevert(accounting.withdraw(DAI.address, recipient, amount, { from }), 'ACCOUNTING_WITHDRAW_AMOUNT_ZERO')
          })
        })

        context('when the given amount is lower than the balance of the account', () => {
          const amount = bigExp(10, 18)

          it('reverts', async () => {
            await assertRevert(accounting.withdraw(DAI.address, recipient, amount, { from }), 'ACCOUNTING_WITHDRAW_FAILED')
          })
        })

        context('when the given amount is equal to the balance of the account', () => {
          const amount = bigExp(200, 18)

          it('reverts', async () => {
            await assertRevert(accounting.withdraw(DAI.address, recipient, amount, { from }), 'ACCOUNTING_WITHDRAW_FAILED')
          })
        })

        context('when the given amount is grater than the balance of the account', () => {
          const amount = bigExp(201, 18)

          it('reverts', async () => {
            await assertRevert(accounting.withdraw(DAI.address, recipient, amount, { from }), 'ACCOUNTING_WITHDRAW_INVALID_AMOUNT')
          })
        })
      })
    })

    context('when the sender does not have balance', () => {
      const from = holder

      it('reverts', async () => {
        await assertRevert(accounting.withdraw(DAI.address, holder, bigExp(10, 18), { from }), 'ACCOUNTING_WITHDRAW_INVALID_AMOUNT')
      })
    })
  })
})
