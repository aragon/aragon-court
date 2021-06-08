const { buildHelper } = require('../helpers/wrappers/court')(web3, artifacts)
const { assertRevert } = require('../helpers/asserts/assertThrow')
const { assertBn } = require('../helpers/asserts/assertBn')
const { bn, bigExp } = require('../helpers/lib/numbers')

const DonatedFeesDrip = artifacts.require('DonatedFeesDrip')

const DEFAULT_PERCENT_YIELD = bigExp(2084, 13) // 2.084% (~25% apy)
const ONE_HUNDRED_PERCENT = bigExp(1, 18)

contract('DonatedFeesDrip', ([_, juror]) => {
  let courtDeployment, controller, donatedFeesDrip

  beforeEach(async () => {
    courtDeployment = buildHelper()
    controller = await courtDeployment.deploy()
    donatedFeesDrip = await DonatedFeesDrip.new(controller.address, DEFAULT_PERCENT_YIELD)
  })

  describe.only('dripFees', () => {
    it('deposits correct amount for first period', async () => {
      const totalStaked = bigExp(100, 18)
      await courtDeployment.activate([{ address: juror,  initialActiveBalance: totalStaked }])
      await courtDeployment.passTerms(11)
      await courtDeployment.mintFeeTokens(donatedFeesDrip.address, bigExp(50, 18))

      await donatedFeesDrip.dripFees()

      const expectedBalance = totalStaked.mul(DEFAULT_PERCENT_YIELD).div(ONE_HUNDRED_PERCENT)
      const actualBalance = await courtDeployment.feeToken.balanceOf(courtDeployment.subscriptions.address)
      assertBn(actualBalance, expectedBalance, "Incorrect balance")
    })

    it('deposits correct amount for second period', async () => {
      const totalStaked = bigExp(100, 18)
      await courtDeployment.activate([{ address: juror,  initialActiveBalance: totalStaked }])
      await courtDeployment.passTerms(11)
      await courtDeployment.mintFeeTokens(donatedFeesDrip.address, bigExp(50, 18))

      await donatedFeesDrip.dripFees()
      await courtDeployment.passTerms(10)
      await donatedFeesDrip.dripFees()

      const expectedBalance = totalStaked.mul(DEFAULT_PERCENT_YIELD).div(ONE_HUNDRED_PERCENT).mul(bn(2))
      const actualBalance = await courtDeployment.feeToken.balanceOf(courtDeployment.subscriptions.address)
      assertBn(actualBalance, expectedBalance, "Incorrect balance")
    })

    it('reverts when not enough funds', async () => {
      await courtDeployment.activate([{ address: juror,  initialActiveBalance: bigExp(100,  18) }])
      await courtDeployment.passTerms(11)

      await assertRevert(donatedFeesDrip.dripFees(), "ERROR: Not enough funds")
    })
  })
})
