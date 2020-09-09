const { EMPTY_BYTES, bn, bigExp } = require('@aragon/contract-helpers-test')
const { assertRevert, assertBn, assertAmountOfEvents, assertEvent } = require('@aragon/contract-helpers-test/src/asserts')

const { buildHelper } = require('../helpers/wrappers/court')
const { SUBSCRIPTIONS_EVENTS } = require('../helpers/utils/events')
const { SUBSCRIPTIONS_ERRORS, CONTROLLED_ERRORS } = require('../helpers/utils/errors')

const AragonAppFeesCashier = artifacts.require('SubscriptionsMock')
const ERC20 = artifacts.require('ERC20Mock')

const VOTING_APP_ID = '0x9fa3927f639745e587912d4b0fea7ef9013bf93fb907d29faeab57417ba6e1d4'
const TOKEN_MANAGER_APP_ID = '0x6b20a3010614eeebf2138ccec99f028a61c811b3b1a3343b6ff635985c75c91f'

contract('Aragon App Fees Cashier', ([_, governor, subscriber]) => {
  let controller, aragonAppFeesCashier, feeToken

  const PERIOD_DURATION = 24 * 30           // 30 days, assuming terms are 1h
  const GOVERNOR_SHARE_PCT = bn(100)        // 100‱ = 1%

  beforeEach('create base contracts and subscriptions module', async () => {
    controller = await buildHelper().deploy({ configGovernor: governor })
    feeToken = await ERC20.new('Subscriptions Fee Token', 'SFT', 18)
    aragonAppFeesCashier = await AragonAppFeesCashier.new(controller.address, PERIOD_DURATION, feeToken.address, GOVERNOR_SHARE_PCT)
  })

  describe('set and get fees', () => {
    const appIds = [VOTING_APP_ID, TOKEN_MANAGER_APP_ID]
    const amounts = [bigExp(15, 18), bigExp(16, 18)]

    const getAppFees = async (appIds, token, amounts) => {
      for (let i = 0; i < appIds.length; i++) {
        const { feeAmount, feeToken } = await aragonAppFeesCashier.getAppFee(appIds[i])
        assert.equal(feeToken, token, 'token does not match')
        assertBn(feeAmount, amounts[i], 'amount does not match')
      }
    }

    const setAndGetAppFees = () => {
      it('fails to set fee if not governor', async () => {
        await assertRevert(aragonAppFeesCashier.setAppFee(VOTING_APP_ID, feeToken.address, 1, { from: subscriber }), CONTROLLED_ERRORS.SENDER_NOT_CONFIG_GOVERNOR)
      })

      it('fails to set fee if token is wrong (but the same as currentFeeToke)', async () => {
        // make sure period token gets fixed
        const amount = bn(1)
        await feeToken.generateTokens(subscriber, amount)
        await feeToken.approve(aragonAppFeesCashier.address, amount, { from: subscriber })
        await aragonAppFeesCashier.donate(amount, { from: subscriber })

        // set current fee token
        const newFeeToken = await ERC20.new('Another Fee Token', 'AFT', 18)
        await aragonAppFeesCashier.setFeeToken(newFeeToken.address, { from: governor })

        await assertRevert(aragonAppFeesCashier.setAppFee(VOTING_APP_ID, newFeeToken.address, 1, { from: governor }), SUBSCRIPTIONS_ERRORS.WRONG_TOKEN)
      })

      it('fails to set fee if token is wrong (different currentFeeToken)', async () => {
        const newFeeToken = await ERC20.new('Another Fee Token', 'AFT', 18)
        await assertRevert(aragonAppFeesCashier.setAppFee(VOTING_APP_ID, newFeeToken.address, 1, { from: governor }), SUBSCRIPTIONS_ERRORS.WRONG_TOKEN)
      })

      it('fails to set multiple fees if not governor', async () => {
        await assertRevert(aragonAppFeesCashier.setAppFees([VOTING_APP_ID, TOKEN_MANAGER_APP_ID], [], [1, 1], { from: subscriber }), CONTROLLED_ERRORS.SENDER_NOT_CONFIG_GOVERNOR)
      })

      it('fails to set multiple fees if tokens length is not zero', async () => {
        await assertRevert(aragonAppFeesCashier.setAppFees(appIds, [feeToken.address], amounts, { from: governor }), SUBSCRIPTIONS_ERRORS.WRONG_TOKENS_LENGTH)
      })

      it('fails to set multiple fees if amounts length does not match', async () => {
        await assertRevert(aragonAppFeesCashier.setAppFees(appIds, [], [1], { from: governor }), SUBSCRIPTIONS_ERRORS.WRONG_AMOUNTS_LENGTH)
      })

      it('sets and gets fee', async () => {
        const appId = VOTING_APP_ID
        const amount = bigExp(15, 18)

        await aragonAppFeesCashier.setAppFee(appId, feeToken.address, amount, { from: governor })
        const fee = await aragonAppFeesCashier.getAppFee(appId)

        assert.equal(fee.feeToken, feeToken.address, 'token does not match')
        assertBn(fee.feeAmount, amount, 'amount does not match')
      })

      it('sets and gets multiple fee', async () => {
        // set fee
        await aragonAppFeesCashier.setAppFees(appIds, [], amounts, { from: governor })

        // get fees
        await getAppFees(appIds, feeToken.address, amounts)
      })
    }

    context('when the court has not started', () => {
      it('reverts', async () => {
        await assertRevert(aragonAppFeesCashier.setAppFee(appIds[0], feeToken.address, amounts[0], { from: governor }), SUBSCRIPTIONS_ERRORS.COURT_HAS_NOT_STARTED)
      })
    })

    context('when the court has started', () => {
      beforeEach('move terms to reach period #0', async () => {
        await controller.mockSetTerm(PERIOD_DURATION)
      })

      context('when the app fee has not been set', () => {
        it('returns a zeroed fee amount', async () => {
          const { feeAmount } = await aragonAppFeesCashier.getAppFee(VOTING_APP_ID)
          assertBn(feeAmount, 0, 'fee amount does not match')
        })

        it('fails to unset fee', async () => {
          await assertRevert(aragonAppFeesCashier.unsetAppFee(VOTING_APP_ID, { from: governor }), SUBSCRIPTIONS_ERRORS.APP_FEE_NOT_SET)
        })

        it('fails to unset multiple fees', async () => {
          await assertRevert(aragonAppFeesCashier.unsetAppFees([VOTING_APP_ID, TOKEN_MANAGER_APP_ID], { from: governor }), SUBSCRIPTIONS_ERRORS.APP_FEE_NOT_SET)
        })

        setAndGetAppFees()
      })

      context('when the app fee has been set', () => {
        beforeEach('set app fee', async () => {
          await aragonAppFeesCashier.setAppFees(appIds, [], amounts, { from: governor })
        })

        it('gets fee', async () => {
          await getAppFees(appIds, feeToken.address, amounts)
        })

        it('fails to unset fee if not governor', async () => {
          await assertRevert(aragonAppFeesCashier.unsetAppFee(VOTING_APP_ID, { from: subscriber }), CONTROLLED_ERRORS.SENDER_NOT_CONFIG_GOVERNOR)
        })

        it('fails to unset multiple fees if not governor', async () => {
          await assertRevert(aragonAppFeesCashier.unsetAppFees([VOTING_APP_ID, TOKEN_MANAGER_APP_ID], { from: subscriber }), CONTROLLED_ERRORS.SENDER_NOT_CONFIG_GOVERNOR)
        })

        it('unsets the fee', async () => {
          await aragonAppFeesCashier.unsetAppFee(appIds[0], { from: governor })

          const { feeAmount } = await aragonAppFeesCashier.getAppFee(appIds[0])
          assertBn(feeAmount, 0, 'fee amount does not match')
        })

        it('unsets multiple fees', async () => {
          await aragonAppFeesCashier.unsetAppFees(appIds, { from: governor })

          for (const appId of appIds) {
            const { feeAmount } = await aragonAppFeesCashier.getAppFee(appId)
            assertBn(feeAmount, 0, 'fee amount does not match')
          }
        })

        setAndGetAppFees()
      })
    })
  })

  describe('pay app fees', () => {
    const appId = VOTING_APP_ID
    const amount = bigExp(15, 18)

    context('when the court has not started', () => {
      it('reverts', async () => {
        await assertRevert(aragonAppFeesCashier.setAppFee(appId, feeToken.address, amount, { from: governor }), SUBSCRIPTIONS_ERRORS.COURT_HAS_NOT_STARTED)
        await assertRevert(aragonAppFeesCashier.payAppFees(appId, EMPTY_BYTES, { from: subscriber }), SUBSCRIPTIONS_ERRORS.COURT_HAS_NOT_STARTED)
      })
    })

    context('when the court has started', () => {
      beforeEach('move terms to reach period #0', async () => {
        await controller.mockSetTerm(PERIOD_DURATION)
      })

      context('when the app fee has not been set', () => {
        it('ignores the payment', async () => {
          const initialBalance = await feeToken.balanceOf(aragonAppFeesCashier.address)

          const receipt = await aragonAppFeesCashier.payAppFees(appId, EMPTY_BYTES, { from: subscriber })

          const finalBalance = await feeToken.balanceOf(aragonAppFeesCashier.address)
          assertBn(finalBalance, initialBalance, 'subscription balance does not match')

          assertAmountOfEvents(receipt, SUBSCRIPTIONS_EVENTS.APP_FEE_PAID)
          assertEvent(receipt, SUBSCRIPTIONS_EVENTS.APP_FEE_PAID, { expectedArgs: { by: subscriber, appId, data: EMPTY_BYTES } })
        })
      })

      context('when the app has been set', () => {
        beforeEach('set token and app fee', async () => {
          await aragonAppFeesCashier.setAppFee(appId, feeToken.address, amount, { from: governor })
        })

        it('pays fee', async () => {
          const initialBalance = await feeToken.balanceOf(aragonAppFeesCashier.address)

          await feeToken.generateTokens(subscriber, amount)
          await feeToken.approve(aragonAppFeesCashier.address, amount, { from: subscriber })
          const receipt = await aragonAppFeesCashier.payAppFees(appId, EMPTY_BYTES, { from: subscriber })

          const finalBalance = await feeToken.balanceOf(aragonAppFeesCashier.address)
          assertBn(finalBalance, initialBalance.add(amount), 'subscription balance does not match')

          assertAmountOfEvents(receipt, SUBSCRIPTIONS_EVENTS.APP_FEE_PAID)
          assertEvent(receipt, SUBSCRIPTIONS_EVENTS.APP_FEE_PAID, { expectedArgs: { by: subscriber, appId, data: EMPTY_BYTES } })
        })

        it('reverts when sending some ETH', async () => {
          await assertRevert(aragonAppFeesCashier.payAppFees(appId, EMPTY_BYTES, { from: subscriber, value: 1e18 }), SUBSCRIPTIONS_ERRORS.ETH_APP_FEES_NOT_SUPPORTED)
        })
      })
    })
  })
})
