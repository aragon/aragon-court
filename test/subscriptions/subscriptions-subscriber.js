const { bn } = require('@aragon/contract-helpers-test')
const { buildHelper } = require('../helpers/wrappers/court')

const CourtSubscriptions = artifacts.require('CourtSubscriptions')
const ERC20 = artifacts.require('ERC20Mock')

contract('CourtSubscriptions', ([_, governor, subscriber]) => {
  let controller, subscriptions

  const PERIOD_DURATION = 24 * 30           // 30 days, assuming terms are 1h
  const GOVERNOR_SHARE_PCT = bn(100)        // 100‱ = 1%

  describe('isUpToDate', () => {
    const itIsUpToDate = () => {
      it('is up to date', async () => {
        assert.isTrue(await subscriptions.isUpToDate(subscriber), 'subscriber is not up to date')
      })
    }

    context('when the given token address is an ERC20', async () => {
      let feeToken

      before('create controller', async () => {
        controller = await buildHelper().deploy({ configGovernor: governor })
      })

      before('deploy new fee token', async () => {
        feeToken = await ERC20.new('New Fee Token', 'NFT', 18)
      })

      beforeEach('create subscriptions module', async () => {
        subscriptions = await CourtSubscriptions.new(controller.address, PERIOD_DURATION, feeToken.address, GOVERNOR_SHARE_PCT)
        await controller.setSubscriptions(subscriptions.address)
      })

      context('when the court has not started yet', () => {
        itIsUpToDate()
      })

      context('when the court has already started', () => {
        beforeEach('move terms to reach period #0', async () => {
          await controller.mockSetTerm(PERIOD_DURATION)
        })

        itIsUpToDate()
      })
    })
  })
})
