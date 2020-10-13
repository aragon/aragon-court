const { ZERO_ADDRESS, bigExp } = require('@aragon/contract-helpers-test')
const { assertRevert, assertBn, assertAmountOfEvents, assertEvent } = require('@aragon/contract-helpers-test/src/asserts')

const { buildHelper } = require('../../helpers/wrappers/court')
const { CONTROLLED_EVENTS } = require('../../helpers/utils/events')
const { CONTROLLED_ERRORS } = require('../../helpers/utils/errors')

const ERC20 = artifacts.require('ERC20Mock')
const ControlledRecoverable = artifacts.require('ControlledRecoverable')

contract('ControlledRecoverable', ([_, fundsGovernor, configGovernor, modulesGovernor, someone, recipient]) => {
  let recoverable, controller

  describe('recoverFunds', () => {
    let token
    const amount = bigExp(10, 18)

    beforeEach('create token and recoverable instance', async () => {
      token = await ERC20.new('DAI', 'DAI', 18)
      controller = await buildHelper().deploy({ fundsGovernor, configGovernor, modulesGovernor })
      recoverable = await ControlledRecoverable.new(controller.address)
    })

    context('when the sender is the governor', () => {
      const from = fundsGovernor

      context('when the governed has some funds', () => {
        beforeEach('mint some tokens', async () => {
          await token.generateTokens(recoverable.address, amount)
        })

        it('transfers the requested amount to the given recipient', async () => {
          const previousGovernorBalance = await token.balanceOf(configGovernor)
          const previousGovernedBalance = await token.balanceOf(recoverable.address)
          const previousRecipientBalance = await token.balanceOf(recipient)

          await recoverable.recoverFunds(token.address, recipient, { from })

          const currentGovernorBalance = await token.balanceOf(configGovernor)
          assertBn(previousGovernorBalance, currentGovernorBalance, 'governor balances do not match')

          const currentGovernedBalance = await token.balanceOf(recoverable.address)
          assertBn(previousGovernedBalance.sub(amount), currentGovernedBalance, 'governed balances do not match')

          const currentRecipientBalance = await token.balanceOf(recipient)
          assertBn(previousRecipientBalance.add(amount), currentRecipientBalance, 'recipient balances do not match')
        })

        it('emits an event', async () => {
          const receipt = await recoverable.recoverFunds(token.address, recipient, { from })

          assertAmountOfEvents(receipt, CONTROLLED_EVENTS.RECOVER_FUNDS)
          assertEvent(receipt, CONTROLLED_EVENTS.RECOVER_FUNDS, { expectedArgs: { token: token.address, recipient, balance: amount } })
        })
      })

      context('when the governed does not have funds', () => {
        it('reverts', async () => {
          await assertRevert(recoverable.recoverFunds(token.address, recipient, { from }), CONTROLLED_ERRORS.INSUFFICIENT_RECOVER_FUNDS)
        })
      })
    })
  })

  context('when the sender is not the governor', () => {
    const from = someone

    it('reverts', async () => {
      await assertRevert(recoverable.recoverFunds(ZERO_ADDRESS, recipient, { from }), CONTROLLED_ERRORS.SENDER_NOT_FUNDS_GOVERNOR)
    })
  })
})
