const { buildHelper } = require('../helpers/wrappers/court')(web3, artifacts)
const { assertRevert } = require('../helpers/asserts/assertThrow')
const { CONTROLLED_ERRORS, SUBSCRIPTIONS_ERRORS } = require('../helpers/utils/errors')

const CourtSubscriptions = artifacts.require('CourtSubscriptions')
const ERC20 = artifacts.require('ERC20Mock')

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

contract('CourtSubscriptions', ([_, someone]) => {
  let controller, feeToken

  const PERIOD_DURATION = 24 * 30 // 30 days, assuming terms are 1h

  before('create base contracts', async () => {
    controller = await buildHelper().deploy()
    feeToken = await ERC20.new('Subscriptions Fee Token', 'SFT', 18)
  })

  describe('constructor', () => {
    context('when the initialization succeeds', () => {
      it('initializes subscriptions correctly', async () => {
        const subscriptions = await CourtSubscriptions.new(controller.address, PERIOD_DURATION, feeToken.address)

        assert.equal(await subscriptions.getController(), controller.address, 'subscriptions controller does not match')
        assert.equal(await subscriptions.periodDuration(), PERIOD_DURATION, 'subscriptions duration does not match')
        assert.equal(await subscriptions.currentFeeToken(), feeToken.address, 'fee token does not match')
      })
    })

    context('initialization fails', () => {
      context('when the given controller is the zero address', () => {
        const controllerAddress = ZERO_ADDRESS

        it('reverts', async () => {
          await assertRevert(CourtSubscriptions.new(controllerAddress, PERIOD_DURATION, feeToken.address), CONTROLLED_ERRORS.CONTROLLER_NOT_CONTRACT)
        })
      })

      context('when the given controller is not a contract address', () => {
        const controllerAddress = someone

        it('reverts', async () => {
          await assertRevert(CourtSubscriptions.new(controllerAddress, PERIOD_DURATION, feeToken.address), CONTROLLED_ERRORS.CONTROLLER_NOT_CONTRACT)
        })
      })

      context('when the given period duration is zero', () => {
        const periodDuration = 0

        it('reverts', async () => {
          await assertRevert(CourtSubscriptions.new(controller.address, periodDuration, feeToken.address), SUBSCRIPTIONS_ERRORS.PERIOD_DURATION_ZERO)
        })
      })

      context('when the given fee token address is the zero address', () => {
        const feeTokenAddress = ZERO_ADDRESS

        it('reverts', async () => {
          await assertRevert(CourtSubscriptions.new(controller.address, PERIOD_DURATION, feeTokenAddress), SUBSCRIPTIONS_ERRORS.FEE_TOKEN_NOT_CONTRACT)
        })
      })

      context('when the given fee token address is not a contract address', () => {
        const feeTokenAddress = someone

        it('reverts', async () => {
          await assertRevert(CourtSubscriptions.new(controller.address, PERIOD_DURATION, feeTokenAddress), SUBSCRIPTIONS_ERRORS.FEE_TOKEN_NOT_CONTRACT)
        })
      })
    })
  })
})
