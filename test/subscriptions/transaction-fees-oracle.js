const { assertRevert } = require('../helpers/asserts/assertThrow')
const { buildHelper } = require('../helpers/wrappers/court')(web3, artifacts)
const { assertBn } = require('../helpers/asserts/assertBn')
const { bigExp } = require('../helpers/lib/numbers')
const { TRANSACTIONS_FEES_ORACLE_ERRORS, CONTROLLED_ERRORS } = require('../helpers/utils/errors')

const TransactionFeesOracle = artifacts.require('TransactionFeesOracleMock')
const ERC20 = artifacts.require('ERC20Mock')

const VOTING_APP_ID = '0x9fa3927f639745e587912d4b0fea7ef9013bf93fb907d29faeab57417ba6e1d4'
const TOKEN_MANAGER_APP_ID = '0x6b20a3010614eeebf2138ccec99f028a61c811b3b1a3343b6ff635985c75c91f'

contract('Transaction Fees Oracle', ([_, governor, subscriber, fakeToken]) => {
  let controller, subscriptionsOracle, feeToken, ETH

  beforeEach('create base contracts and subscriptions module', async () => {
    controller = await buildHelper().deploy({ configGovernor: governor })
    feeToken = await ERC20.new('Subscriptions Fee Token', 'SFT', 18)

    subscriptionsOracle = await TransactionFeesOracle.new(controller.address)
    ETH = await subscriptionsOracle.getEthTokenConstant()
  })

  describe('set and get fees', () => {
    const appIds = [VOTING_APP_ID, TOKEN_MANAGER_APP_ID]
    const amounts = [bigExp(15, 18), bigExp(16, 18)]

    const getTransactionFees = async (appIds, tokens, amounts) => {
      const beneficiary = await controller.getSubscriptions()
      for (let i = 0; i < appIds.length; i++) {
        const fee = await subscriptionsOracle.getTransactionFee(appIds[i])
        assert.equal(fee.token, tokens[i], 'token doesn’t match')
        assertBn(fee.amount, amounts[i], 'amount doesn’t match')
        assert.equal(fee.beneficiary, beneficiary, 'beneficiary doesn’t match')
      }
    }

    const setAndGetTransactionFees = (isEth) => {
      let token

      beforeEach('set token', async () => {
        token = isEth ? ETH : feeToken.address
      })

      it('fails to set fee if not governor', async () => {
        await assertRevert(subscriptionsOracle.setTransactionFee(VOTING_APP_ID, token, 1, { from: subscriber }), CONTROLLED_ERRORS.SENDER_NOT_CONFIG_GOVERNOR)
      })

      it('fails to set multiple fees if not governor', async () => {
        await assertRevert(subscriptionsOracle.setTransactionFees([VOTING_APP_ID, TOKEN_MANAGER_APP_ID], [token, token], [1, 1], { from: subscriber }), CONTROLLED_ERRORS.SENDER_NOT_CONFIG_GOVERNOR)
      })

      it('fails to set multiple fees if tokens length doesn’t match', async () => {
        await assertRevert(subscriptionsOracle.setTransactionFees(appIds, [token], amounts, { from: governor }), TRANSACTIONS_FEES_ORACLE_ERRORS.ERROR_WRONG_TOKENS_LENGTH)
      })

      it('fails to set multiple fees if amounts length doesn’t match', async () => {
        await assertRevert(subscriptionsOracle.setTransactionFees(appIds, [token, token], [1], { from: governor }), TRANSACTIONS_FEES_ORACLE_ERRORS.ERROR_WRONG_AMOUNTS_LENGTH)
      })

      it('sets and gets fee', async () => {
        const appId = VOTING_APP_ID
        const amount = bigExp(15, 18)

        // set fee
        await subscriptionsOracle.setTransactionFee(appId, token, amount, { from: governor })

        // get fee
        const fee = await subscriptionsOracle.getTransactionFee(appId)
        assert.equal(fee.token, token, 'token doesn’t match')
        assertBn(fee.amount, amount, 'amount doesn’t match')
        assert.equal(fee.beneficiary, await controller.getSubscriptions(), 'beneficiary doesn’t match')
      })

      it('sets and gets multiple fee', async () => {
        // set fee
        await subscriptionsOracle.setTransactionFees(appIds, [token, token], amounts, { from: governor })

        // get fees
        await getTransactionFees(appIds, [token, token], amounts)
      })
    }

    context('when the app hasn’t been set', () => {
      const processAppFees = (isEth) => {
        it('fails to get fee', async () => {
          await assertRevert(subscriptionsOracle.getTransactionFee(VOTING_APP_ID), TRANSACTIONS_FEES_ORACLE_ERRORS.ERROR_APP_NOT_SET)
        })

        it('fails to unset fee', async () => {
          await assertRevert(subscriptionsOracle.unsetTransactionFee(VOTING_APP_ID, { from: governor }), TRANSACTIONS_FEES_ORACLE_ERRORS.ERROR_APP_NOT_SET)
        })

        it('fails to unset multiple fees', async () => {
          await assertRevert(subscriptionsOracle.unsetTransactionFees([VOTING_APP_ID, TOKEN_MANAGER_APP_ID], { from: governor }), TRANSACTIONS_FEES_ORACLE_ERRORS.ERROR_APP_NOT_SET)
        })

        setAndGetTransactionFees(isEth)
      }

      context('when the token is ETH', () => {
        processAppFees(true)
      })

      context('when the token is not ETH', () => {
        it('fails to set fee if token is not contract', async () => {
          await assertRevert(subscriptionsOracle.setTransactionFee(VOTING_APP_ID, fakeToken, 1, { from: governor }), TRANSACTIONS_FEES_ORACLE_ERRORS.ERROR_WRONG_TOKEN)
        })

        it('fails to set multiple fees if token is not contract', async () => {
          await assertRevert(subscriptionsOracle.setTransactionFees([VOTING_APP_ID, TOKEN_MANAGER_APP_ID], [fakeToken, feeToken.address], [1, 1], { from: governor }), TRANSACTIONS_FEES_ORACLE_ERRORS.ERROR_WRONG_TOKEN)
          await assertRevert(subscriptionsOracle.setTransactionFees([VOTING_APP_ID, TOKEN_MANAGER_APP_ID], [feeToken.address, fakeToken], [1, 1], { from: governor }), TRANSACTIONS_FEES_ORACLE_ERRORS.ERROR_WRONG_TOKEN)
        })

        processAppFees(false)
      })
    })

    context('when the app has been set', () => {
      const processAppFees = async (isEth) => {
        let token

        beforeEach('set token and app fee', async () => {
          token = isEth ? ETH : feeToken.address
          await subscriptionsOracle.setTransactionFees(appIds, [token, token], amounts, { from: governor })
        })

        it('gets fee', async () => {
          await getTransactionFees(appIds, [token, token], amounts)
        })

        it('fails to unset fee if not governor', async () => {
          await assertRevert(subscriptionsOracle.unsetTransactionFee(VOTING_APP_ID, { from: subscriber }), CONTROLLED_ERRORS.SENDER_NOT_CONFIG_GOVERNOR)
        })

        it('fails to unset multiple fees if not governor', async () => {
          await assertRevert(subscriptionsOracle.unsetTransactionFees([VOTING_APP_ID, TOKEN_MANAGER_APP_ID], { from: subscriber }), CONTROLLED_ERRORS.SENDER_NOT_CONFIG_GOVERNOR)
        })

        it('unsets the fee', async () => {
          // unset fee
          await subscriptionsOracle.unsetTransactionFee(appIds[0], { from: governor })

          // try to get fee
          await assertRevert(subscriptionsOracle.getTransactionFee(appIds[0]), TRANSACTIONS_FEES_ORACLE_ERRORS.ERROR_APP_NOT_SET)
        })

        it('unsets multiple fees', async () => {
          // unset fee
          await subscriptionsOracle.unsetTransactionFees(appIds, { from: governor })

          // try to get fee
          await Promise.all(appIds.map(async (appId) => {
            await assertRevert(subscriptionsOracle.getTransactionFee(appId), TRANSACTIONS_FEES_ORACLE_ERRORS.ERROR_APP_NOT_SET)
          }))
        })

        setAndGetTransactionFees(token)
      }

      context('when the token is ETH', () => {
        processAppFees(true)
      })

      context('when the token is not ETH', () => {
        it('fails if token is not contract', async () => {
          await assertRevert(subscriptionsOracle.setTransactionFee(VOTING_APP_ID, fakeToken, 1, { from: governor }), TRANSACTIONS_FEES_ORACLE_ERRORS.ERROR_WRONG_TOKEN)
        })

        it('fails to set multiple fees if token is not contract', async () => {
          await assertRevert(subscriptionsOracle.setTransactionFees([VOTING_APP_ID, TOKEN_MANAGER_APP_ID], [fakeToken, feeToken.address], [1, 1], { from: governor }), TRANSACTIONS_FEES_ORACLE_ERRORS.ERROR_WRONG_TOKEN)
          await assertRevert(subscriptionsOracle.setTransactionFees([VOTING_APP_ID, TOKEN_MANAGER_APP_ID], [feeToken.address, fakeToken], [1, 1], { from: governor }), TRANSACTIONS_FEES_ORACLE_ERRORS.ERROR_WRONG_TOKEN)
        })

        processAppFees(false)
      })
    })
  })
})
