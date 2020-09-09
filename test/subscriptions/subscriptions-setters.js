const { bn } = require('@aragon/contract-helpers-test')
const { assertRevert, assertBn, assertAmountOfEvents, assertEvent } = require('@aragon/contract-helpers-test/src/asserts')

const { buildHelper } = require('../helpers/wrappers/court')
const { SUBSCRIPTIONS_EVENTS } = require('../helpers/utils/events')
const { CONTROLLED_ERRORS, SUBSCRIPTIONS_ERRORS } = require('../helpers/utils/errors')

const CourtSubscriptions = artifacts.require('CourtSubscriptions')
const ERC20 = artifacts.require('ERC20Mock')

contract('CourtSubscriptions', ([_, governor, someone, something]) => {
  let controller, subscriptions, feeToken

  const PERIOD_DURATION = 24 * 30           // 30 days, assuming terms are 1h
  const GOVERNOR_SHARE_PCT = bn(100)        // 100‱ = 1%

  before('create base contracts', async () => {
    controller = await buildHelper().deploy({ configGovernor: governor })
    feeToken = await ERC20.new('Subscriptions Fee Token', 'SFT', 18)
  })

  beforeEach('create subscriptions module', async () => {
    subscriptions = await CourtSubscriptions.new(controller.address, PERIOD_DURATION, feeToken.address, GOVERNOR_SHARE_PCT)
    await controller.setSubscriptions(subscriptions.address)
  })

  describe('setFeeToken', () => {
    context('when the sender is the governor', async () => {
      const from = governor

      context('when the given token address is an ERC20', async () => {
        let newFeeToken

        beforeEach('deploy new fee token', async () => {
          newFeeToken = await ERC20.new('New Fee Token', 'NFT', 18)
        })

        it('updates the current fee token address and amount', async () => {
          await subscriptions.setFeeToken(newFeeToken.address, { from })

          assert.equal(await subscriptions.currentFeeToken(), newFeeToken.address, 'fee token does not match')
        })

        it('emits an event', async () => {
          const previousFeeToken = await subscriptions.currentFeeToken()

          const receipt = await subscriptions.setFeeToken(newFeeToken.address, { from })

          assertAmountOfEvents(receipt, SUBSCRIPTIONS_EVENTS.FEE_TOKEN_CHANGED)
          assertEvent(receipt, SUBSCRIPTIONS_EVENTS.FEE_TOKEN_CHANGED, { expectedArgs: { previousFeeToken, currentFeeToken: newFeeToken.address } })
        })
      })

      context('when the given token address is not a contract', async () => {
        const newFeeTokenAddress = something

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

  describe('setGovernorSharePct', () => {
    context('when the sender is the governor', async () => {
      const from = governor

      const itUpdatesTheGovernorSharePct = newGovernorSharePct => {
        it('updates the governor share pct', async () => {
          await subscriptions.setGovernorSharePct(newGovernorSharePct, { from })

          assertBn((await subscriptions.governorSharePct()), newGovernorSharePct, 'governor share pct does not match')
        })

        it('emits an event', async () => {
          const previousGovernorSharePct = await subscriptions.governorSharePct()

          const receipt = await subscriptions.setGovernorSharePct(newGovernorSharePct, { from })

          assertAmountOfEvents(receipt, SUBSCRIPTIONS_EVENTS.GOVERNOR_SHARE_PCT_CHANGED)
          assertEvent(receipt, SUBSCRIPTIONS_EVENTS.GOVERNOR_SHARE_PCT_CHANGED, { expectedArgs: { previousGovernorSharePct, currentGovernorSharePct: newGovernorSharePct } })
        })
      }

      context('when the given value is zero', async () => {
        const newGovernorSharePct = bn(0)

        itUpdatesTheGovernorSharePct(newGovernorSharePct)
      })

      context('when the given value is not greater than 10,000', async () => {
        const newGovernorSharePct = bn(500)

        itUpdatesTheGovernorSharePct(newGovernorSharePct)
      })

      context('when the given value is greater than 10,000', async () => {
        const newGovernorSharePct = bn(10001)

        it('reverts', async () => {
          await assertRevert(subscriptions.setGovernorSharePct(newGovernorSharePct, { from }), SUBSCRIPTIONS_ERRORS.OVERRATED_GOVERNOR_SHARE_PCT)
        })
      })
    })

    context('when the sender is not the governor', async () => {
      const from = someone

      it('reverts', async () => {
        await assertRevert(subscriptions.setGovernorSharePct(GOVERNOR_SHARE_PCT, { from }), CONTROLLED_ERRORS.SENDER_NOT_CONFIG_GOVERNOR)
      })
    })
  })
})
