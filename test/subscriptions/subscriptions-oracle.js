const { assertRevert } = require('../helpers/asserts/assertThrow')
const { buildHelper } = require('../helpers/wrappers/court')(web3, artifacts)
const { assertBn } = require('../helpers/asserts/assertBn')
const { bn, bigExp } = require('../helpers/lib/numbers')
const { SUBSCRIPTIONS_ORACLE_ERRORS, CONTROLLED_ERRORS } = require('../helpers/utils/errors')
const { ONE_DAY } = require('../helpers/lib/time')

const SubscriptionFeesOracle = artifacts.require('SubscriptionFeesOracleMock')
const ERC20 = artifacts.require('ERC20Mock')

const VOTING_APP_ID = '0x9fa3927f639745e587912d4b0fea7ef9013bf93fb907d29faeab57417ba6e1d4'

contract('Subscriptions Fees Oracle', ([_, governor, subscriber, fakeToken]) => {
  let controller, subscriptionsOracle, feeToken, ETH
  const TERM_DURATION = bn(ONE_DAY)

  beforeEach('create base contracts and subscriptions module', async () => {
    controller = await buildHelper().deploy({ configGovernor: governor })
    feeToken = await ERC20.new('Subscriptions Fee Token', 'SFT', 18)

    subscriptionsOracle = await SubscriptionFeesOracle.new(controller.address)
    ETH = await subscriptionsOracle.getEthTokenConstant()
  })

  describe('set and get fees', () => {
    context('when the court has already started', () => {
      beforeEach('move terms to reach period #0', async () => {
        await controller.mockSetTerm(TERM_DURATION)
      })

      context('when the app id is zero', () => {
        it('fails setting fee', async () => {
          await assertRevert(subscriptionsOracle.setFee('0x', feeToken.address, 1, { from: governor }), SUBSCRIPTIONS_ORACLE_ERRORS.ERROR_APP_ID_ZERO)
        })

        it('fails getting fee', async () => {
          await assertRevert(subscriptionsOracle.getFee('0x', { from: subscriber }), SUBSCRIPTIONS_ORACLE_ERRORS.ERROR_APP_ID_ZERO)
        })
      })

      const setAndGetFee = async (isEth) => {
        let token

        beforeEach('set token', async () => {
          token = isEth ? ETH : feeToken.address
        })

        it('sets and gets fee', async () => {
          const appId = VOTING_APP_ID
          const amount = bigExp(15, 18)

          // set fee
          await subscriptionsOracle.setFee(appId, token, amount, { from: governor })

          // get fee
          const fee = await subscriptionsOracle.getFee(appId)
          assert.equal(fee.token, token, 'token doesn’t match')
          assertBn(fee.amount, amount, 'amount doesn’t match')
          assert.equal(fee.beneficiary, await controller.getSubscriptions(), 'beneficiary doesn’t match')
        })

        it('fails to set fee if not governor', async () => {
          await assertRevert(subscriptionsOracle.setFee(VOTING_APP_ID, token, 1), CONTROLLED_ERRORS.SENDER_NOT_CONFIG_GOVERNOR)
        })
      }

      context('when the app id is not zero', () => {
        context('when the token is ETH', () => {
          setAndGetFee(true)
        })

        context('when the token is not ETH', () => {
          it('fails if token is not contract', async () => {
            await assertRevert(subscriptionsOracle.setFee(VOTING_APP_ID, fakeToken, 1, { from: governor }), SUBSCRIPTIONS_ORACLE_ERRORS.ERROR_WRONG_TOKEN)
          })

          setAndGetFee(false)
        })
      })
    })

    context('when the court hasn’t started yet', () => {
      it('fails getting fee', async () => {
        await assertRevert(subscriptionsOracle.getFee(VOTING_APP_ID, { from: subscriber }), SUBSCRIPTIONS_ORACLE_ERRORS.ERROR_COURT_HAS_NOT_STARTED)
      })
    })
  })
})
