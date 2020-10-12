const { ZERO_ADDRESS, bn } = require('@aragon/contract-helpers-test')
const { assertRevert, assertBn } = require('@aragon/contract-helpers-test/src/asserts')

const { buildHelper } = require('../helpers/wrappers/court')
const { CONTROLLED_ERRORS, SUBSCRIPTIONS_ERRORS } = require('../helpers/utils/errors')

const CourtSubscriptions = artifacts.require('CourtSubscriptions')
const ERC20 = artifacts.require('ERC20Mock')

contract('CourtSubscriptions', ([_, someone]) => {
  let controller

  const PERIOD_DURATION = 24 * 30           // 30 days, assuming terms are 1h
  const GOVERNOR_SHARE_PCT = bn(100)        // 100‱ = 1%

  before('create controller', async () => {
    controller = await buildHelper().deploy()
  })

  describe('constructor', () => {
    context('when the initialization succeeds', () => {
      context('when the given fee token address is a contract', () => {
        let feeToken

        before('create fee token', async () => {
          feeToken = await ERC20.new('Subscriptions Fee Token', 'SFT', 18)
        })

        it('initializes subscriptions correctly', async () => {
          const subscriptions = await CourtSubscriptions.new(controller.address, PERIOD_DURATION, feeToken.address, GOVERNOR_SHARE_PCT)

          assert.equal(await subscriptions.getController(), controller.address, 'subscriptions controller does not match')
          assert.equal(await subscriptions.periodDuration(), PERIOD_DURATION, 'subscriptions duration does not match')
          assert.equal(await subscriptions.currentFeeToken(), feeToken.address, 'fee token does not match')
          assertBn((await subscriptions.governorSharePct()), GOVERNOR_SHARE_PCT, 'governor share pct does not match')
        })
      })
    })

    context('initialization fails', () => {
      context('when the given fee token address is the zero address', () => {
        const feeToken = ZERO_ADDRESS

        it('reverts', async () => {
          await assertRevert(CourtSubscriptions.new(controller.address, PERIOD_DURATION, feeToken, GOVERNOR_SHARE_PCT), SUBSCRIPTIONS_ERRORS.FEE_TOKEN_NOT_CONTRACT)
        })
      })

      context('when the given fee token address is a token', () => {
        let feeToken

        before('create fee token', async () => {
          feeToken = await ERC20.new('Subscriptions Fee Token', 'SFT', 18)
        })

        context('when the given controller is the zero address', () => {
          const controllerAddress = ZERO_ADDRESS

          it('reverts', async () => {
            await assertRevert(CourtSubscriptions.new(controllerAddress, PERIOD_DURATION, feeToken.address, GOVERNOR_SHARE_PCT), CONTROLLED_ERRORS.CONTROLLER_NOT_CONTRACT)
          })
        })

        context('when the given controller is not a contract address', () => {
          const controllerAddress = someone

          it('reverts', async () => {
            await assertRevert(CourtSubscriptions.new(controllerAddress, PERIOD_DURATION, feeToken.address, GOVERNOR_SHARE_PCT), CONTROLLED_ERRORS.CONTROLLER_NOT_CONTRACT)
          })
        })

        context('when the given period duration is zero', () => {
          const periodDuration = 0

          it('reverts', async () => {
            await assertRevert(CourtSubscriptions.new(controller.address, periodDuration, feeToken.address, GOVERNOR_SHARE_PCT), SUBSCRIPTIONS_ERRORS.PERIOD_DURATION_ZERO)
          })
        })

        context('when the given fee token address is not a contract address', () => {
          const feeTokenAddress = someone

          it('reverts', async () => {
            await assertRevert(CourtSubscriptions.new(controller.address, PERIOD_DURATION, feeTokenAddress, GOVERNOR_SHARE_PCT), SUBSCRIPTIONS_ERRORS.FEE_TOKEN_NOT_CONTRACT)
          })
        })

        context('when the given governor share is above 100%', () => {
          const governorSharePct = bn(10001)

          it('reverts', async () => {
            await assertRevert(CourtSubscriptions.new(controller.address, PERIOD_DURATION, feeToken.address, governorSharePct), SUBSCRIPTIONS_ERRORS.OVERRATED_GOVERNOR_SHARE_PCT)
          })
        })
      })
    })
  })
})