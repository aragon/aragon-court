const { buildHelper } = require('../helpers/wrappers/court')(web3, artifacts)
const { assertRevert } = require('../helpers/asserts/assertThrow')
const { SUBSCRIPTIONS_EVENTS } = require('../helpers/utils/events')
const { assertEvent, assertAmountOfEvents } = require('../helpers/asserts/assertEvent')
const { CONTROLLED_ERRORS, SUBSCRIPTIONS_ERRORS } = require('../helpers/utils/errors')

const CourtSubscriptions = artifacts.require('CourtSubscriptions')
const ERC20 = artifacts.require('ERC20Mock')

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

contract('CourtSubscriptions', ([_, governor, someone, something]) => {
  let controller, subscriptions, feeToken

  const PERIOD_DURATION = 24 * 30 // 30 days, assuming terms are 1h

  before('create base contracts', async () => {
    controller = await buildHelper().deploy({ configGovernor: governor })
    feeToken = await ERC20.new('Subscriptions Fee Token', 'SFT', 18)
  })

  beforeEach('create subscriptions module', async () => {
    subscriptions = await CourtSubscriptions.new(controller.address, PERIOD_DURATION, feeToken.address)
    await controller.setSubscriptions(subscriptions.address)
  })

  describe('setFeeToken', () => {
    context('when the sender is the governor', async () => {
      const from = governor

      context('when the given token address is a contract', async () => {
        let newFeeToken

        beforeEach('deploy new fee token', async () => {
          newFeeToken = await ERC20.new('New Fee Token', 'NFT', 18)
        })

        context('when the given fee amount is greater than zero', async () => {
          it('updates the current fee token address', async () => {
            await subscriptions.setFeeToken(newFeeToken.address, { from })

            assert.equal(await subscriptions.currentFeeToken(), newFeeToken.address, 'fee token does not match')
          })

          it('emits an event', async () => {
            const previousFeeToken = await subscriptions.currentFeeToken()

            const receipt = await subscriptions.setFeeToken(newFeeToken.address, { from })

            assertAmountOfEvents(receipt, SUBSCRIPTIONS_EVENTS.FEE_TOKEN_CHANGED)
            assertEvent(receipt, SUBSCRIPTIONS_EVENTS.FEE_TOKEN_CHANGED, {
              previousFeeToken,
              currentFeeToken: newFeeToken.address
            })
          })
        })
      })

      context('when the given token address is not a contract', async () => {
        const newFeeTokenAddress = something

        it('reverts', async () => {
          await assertRevert(subscriptions.setFeeToken(newFeeTokenAddress, { from }), SUBSCRIPTIONS_ERRORS.FEE_TOKEN_NOT_CONTRACT)
        })
      })

      context('when the given token address is the zero address', async () => {
        const newFeeTokenAddress = ZERO_ADDRESS

        it('reverts', async () => {
          await assertRevert(subscriptions.setFeeToken(newFeeTokenAddress, { from }), SUBSCRIPTIONS_ERRORS.FEE_TOKEN_NOT_CONTRACT)
        })
      })
    })

    context('when the sender is not the governor', async () => {
      const from = someone

      it('reverts', async () => {
        await assertRevert(subscriptions.setFeeToken(feeToken.address, { from }), CONTROLLED_ERRORS.SENDER_NOT_CONFIG_GOVERNOR)
      })
    })
  })
})
