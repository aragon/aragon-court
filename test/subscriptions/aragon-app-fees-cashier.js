const { assertRevert } = require('../helpers/asserts/assertThrow')
const { assertAmountOfEvents, assertEvent } = require('../helpers/asserts/assertEvent')
const { buildHelper } = require('../helpers/wrappers/court')(web3, artifacts)
const { assertBn } = require('../helpers/asserts/assertBn')
const { bn, bigExp } = require('../helpers/lib/numbers')
const { getWeiBalance } = require('../helpers/lib/web3-utils')(web3)
const { SUBSCRIPTIONS_ERRORS, CONTROLLED_ERRORS } = require('../helpers/utils/errors')
const { SUBSCRIPTIONS_EVENTS } = require('../helpers/utils/events')

const AragonAppFeesCashier = artifacts.require('SubscriptionsMock')
const ERC20 = artifacts.require('ERC20Mock')

const VOTING_APP_ID = '0x9fa3927f639745e587912d4b0fea7ef9013bf93fb907d29faeab57417ba6e1d4'
const TOKEN_MANAGER_APP_ID = '0x6b20a3010614eeebf2138ccec99f028a61c811b3b1a3343b6ff635985c75c91f'
const EMPTY_DATA = '0x00'

contract('Aragon App Fees Cashier', ([_, governor, subscriber]) => {
  let controller, aragonAppFeesCashier, feeToken, ETH

  const FEE_AMOUNT = bigExp(10, 18)
  const PERIOD_DURATION = 24 * 30           // 30 days, assuming terms are 1h
  const GOVERNOR_SHARE_PCT = bn(100)        // 100‱ = 1%

  beforeEach('create base contracts and subscriptions module', async () => {
    controller = await buildHelper().deploy({ configGovernor: governor })
    feeToken = await ERC20.new('Subscriptions Fee Token', 'SFT', 18)

    aragonAppFeesCashier = await AragonAppFeesCashier.new(controller.address, PERIOD_DURATION, feeToken.address, FEE_AMOUNT, GOVERNOR_SHARE_PCT)
    ETH = await aragonAppFeesCashier.getEthTokenConstant()
  })

  describe('set and get fees', () => {
    const appIds = [VOTING_APP_ID, TOKEN_MANAGER_APP_ID]
    const amounts = [bigExp(15, 18), bigExp(16, 18)]

    const getAppFees = async (appIds, token, amounts) => {
      for (let i = 0; i < appIds.length; i++) {
        const fee = await aragonAppFeesCashier.getAppFee(appIds[i])
        assert.equal(fee.token, token, 'token doesn’t match')
        assertBn(fee.amount, amounts[i], 'amount doesn’t match')
      }
    }

    const setAndGetAppFees = (isEth) => {
      let token

      beforeEach('set token', async () => {
        token = isEth ? ETH : feeToken.address
      })

      it('fails to set fee if not governor', async () => {
        await assertRevert(aragonAppFeesCashier.setAppFee(VOTING_APP_ID, token, 1, { from: subscriber }), CONTROLLED_ERRORS.SENDER_NOT_CONFIG_GOVERNOR)
      })

      it('fails to set fee if token is wrong (but the same as currentFeeToke)', async () => {
        const newFeeToken = await ERC20.new('Another Fee Token', 'AFT', 18)
        // make sure period token gets fixed
        const amount = bn(1)
        if (isEth) {
          await aragonAppFeesCashier.donate(amount, { from: subscriber, value: amount })
        } else {
          await feeToken.generateTokens(subscriber, amount)
          await feeToken.approve(aragonAppFeesCashier.address, amount, { from: subscriber })
          await aragonAppFeesCashier.donate(amount, { from: subscriber })
        }
        // set currentFeeToken
        await aragonAppFeesCashier.setFeeToken(newFeeToken.address, 1, { from: governor })

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
        await assertRevert(aragonAppFeesCashier.setAppFees(appIds, [token], amounts, { from: governor }), SUBSCRIPTIONS_ERRORS.WRONG_TOKENS_LENGTH)
      })

      it('fails to set multiple fees if amounts length doesn’t match', async () => {
        await assertRevert(aragonAppFeesCashier.setAppFees(appIds, [], [1], { from: governor }), SUBSCRIPTIONS_ERRORS.WRONG_AMOUNTS_LENGTH)
      })

      it('sets and gets fee', async () => {
        const appId = VOTING_APP_ID
        const amount = bigExp(15, 18)

        // set fee
        await aragonAppFeesCashier.setAppFee(appId, token, amount, { from: governor })

        // get fee
        const fee = await aragonAppFeesCashier.getAppFee(appId)
        assert.equal(fee.token, token, 'token doesn’t match')
        assertBn(fee.amount, amount, 'amount doesn’t match')
      })

      it('sets and gets multiple fee', async () => {
        // set fee
        await aragonAppFeesCashier.setAppFees(appIds, [], amounts, { from: governor })

        // get fees
        await getAppFees(appIds, token, amounts)
      })
    }

    context('when the court hasn’t started', () => {
      it('setAppFee reverts', async () => {
        await assertRevert(aragonAppFeesCashier.setAppFee(appIds[0], feeToken.address, amounts[0], { from: governor }), SUBSCRIPTIONS_ERRORS.COURT_HAS_NOT_STARTED)
      })
    })

    context('when the court has started', () => {
      beforeEach('move terms to reach period #0', async () => {
        await controller.mockSetTerm(PERIOD_DURATION)
      })

      context('when the app fee hasn’t been set', () => {
        const processAppFees = (isEth) => {
          it('fails to get fee', async () => {
            await assertRevert(aragonAppFeesCashier.getAppFee(VOTING_APP_ID), SUBSCRIPTIONS_ERRORS.APP_FEE_NOT_SET)
          })

          it('fails to unset fee', async () => {
            await assertRevert(aragonAppFeesCashier.unsetAppFee(VOTING_APP_ID, { from: governor }), SUBSCRIPTIONS_ERRORS.APP_FEE_NOT_SET)
          })

          it('fails to unset multiple fees', async () => {
            await assertRevert(aragonAppFeesCashier.unsetAppFees([VOTING_APP_ID, TOKEN_MANAGER_APP_ID], { from: governor }), SUBSCRIPTIONS_ERRORS.APP_FEE_NOT_SET)
          })

          setAndGetAppFees(isEth)
        }

        context('when the token is ETH', () => {
          beforeEach('set token to ETH', async () => {
            await aragonAppFeesCashier.setFeeToken(ETH, FEE_AMOUNT, { from: governor })
          })

          processAppFees(true)
        })

        context('when the token is not ETH', () => {
          processAppFees(false)
        })
      })

      context('when the app fee has been set', () => {
        const processAppFees = async (isEth) => {
          let token

          beforeEach('set token and app fee', async () => {
            token = isEth ? ETH : feeToken.address
            await aragonAppFeesCashier.setAppFees(appIds, [], amounts, { from: governor })
          })

          it('gets fee', async () => {
            await getAppFees(appIds, token, amounts)
          })

          it('fails to unset fee if not governor', async () => {
            await assertRevert(aragonAppFeesCashier.unsetAppFee(VOTING_APP_ID, { from: subscriber }), CONTROLLED_ERRORS.SENDER_NOT_CONFIG_GOVERNOR)
          })

          it('fails to unset multiple fees if not governor', async () => {
            await assertRevert(aragonAppFeesCashier.unsetAppFees([VOTING_APP_ID, TOKEN_MANAGER_APP_ID], { from: subscriber }), CONTROLLED_ERRORS.SENDER_NOT_CONFIG_GOVERNOR)
          })

          it('unsets the fee', async () => {
            // unset fee
            await aragonAppFeesCashier.unsetAppFee(appIds[0], { from: governor })

            // try to get fee
            await assertRevert(aragonAppFeesCashier.getAppFee(appIds[0]), SUBSCRIPTIONS_ERRORS.APP_FEE_NOT_SET)
          })

          it('unsets multiple fees', async () => {
            // unset fee
            await aragonAppFeesCashier.unsetAppFees(appIds, { from: governor })

            // try to get fee
            await Promise.all(appIds.map(async (appId) => {
              await assertRevert(aragonAppFeesCashier.getAppFee(appId), SUBSCRIPTIONS_ERRORS.APP_FEE_NOT_SET)
            }))
          })

          setAndGetAppFees(isEth)
        }

        context('when the token is ETH', () => {
          beforeEach('set token to ETH', async () => {
            await aragonAppFeesCashier.setFeeToken(ETH, FEE_AMOUNT, { from: governor })
          })

          processAppFees(true)
        })

        context('when the token is not ETH', () => {
          processAppFees(false)
        })
      })
    })
  })

  describe('pay app fees', () => {
    const appId = VOTING_APP_ID
    const amount = bigExp(15, 18)

    const getBalance = async (isEth) => {
      let balance

      if (isEth) {
        balance = await getWeiBalance(aragonAppFeesCashier.address)
      } else {
        balance = await feeToken.balanceOf(aragonAppFeesCashier.address)
      }

      return balance
    }

    const payAppFees = (isEth) => {
      beforeEach('set token and app fee', async () => {
        const tokenAddress = isEth ? ETH : feeToken.address
        await aragonAppFeesCashier.setAppFee(appId, tokenAddress, amount, { from: governor })
      })

      it('pays fee', async () => {
        const initialBalance = await getBalance(isEth)

        let receipt
        if (isEth) {
          receipt = await aragonAppFeesCashier.payAppFees(appId, EMPTY_DATA, { from: subscriber, value: amount })
        } else {
          await feeToken.generateTokens(subscriber, amount)
          await feeToken.approve(aragonAppFeesCashier.address, amount, { from: subscriber })
          receipt = await aragonAppFeesCashier.payAppFees(appId, EMPTY_DATA, { from: subscriber })
        }

        const finalBalance = await getBalance(isEth)

        assertBn(finalBalance, initialBalance.add(amount), 'amount doesn’t match')

        assertAmountOfEvents(receipt, SUBSCRIPTIONS_EVENTS.APP_FEE_PAID)
        assertEvent(receipt, SUBSCRIPTIONS_EVENTS.APP_FEE_PAID, { by: subscriber, appId, data: EMPTY_DATA })
      })
    }

    context('when the court hasn’t started', () => {
      it('reverts', async () => {
        await assertRevert(aragonAppFeesCashier.setAppFee(appId, ETH, amount, { from: governor }), SUBSCRIPTIONS_ERRORS.COURT_HAS_NOT_STARTED)
        await assertRevert(aragonAppFeesCashier.payAppFees(appId, EMPTY_DATA, { from: subscriber }), SUBSCRIPTIONS_ERRORS.APP_FEE_NOT_SET)
      })
    })

    context('when the court has started', () => {
      beforeEach('move terms to reach period #0', async () => {
        await controller.mockSetTerm(PERIOD_DURATION)
      })

      context('when the app fee hasn’t been set', () => {
        it('reverts', async () => {
          await assertRevert(aragonAppFeesCashier.payAppFees(appId, EMPTY_DATA, { from: subscriber }), SUBSCRIPTIONS_ERRORS.APP_FEE_NOT_SET)
        })
      })

      context('when the app has been set', () => {
        context('when the token is ETH', () => {
          beforeEach('set token to ETH', async () => {
            await aragonAppFeesCashier.setFeeToken(ETH, FEE_AMOUNT, { from: governor })
          })

          payAppFees(true)
        })

        context('when the token is not ETH', () => {
          payAppFees(false)
        })
      })
    })
  })
})
