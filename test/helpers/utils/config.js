const { assertBn } = require('../asserts/assertBn')
const { bn, bigExp } = require('../lib/numbers')

const PCT_BASE = bn(10000)

module.exports = artifacts => {
  const buildNewConfig = async (config, iteration = 1) => {
    return {
      feeToken: await artifacts.require('ERC20Mock').new('Court Fee Token', 'CFT', 18),
      jurorFee: config.jurorFee.add(bigExp(iteration * 10, 18)),
      draftFee: config.draftFee.add(bigExp(iteration * 10, 18)),
      settleFee: config.settleFee.add(bigExp(iteration * 10, 18)),
      commitTerms: config.commitTerms.add(bn(iteration)),
      revealTerms: config.revealTerms.add(bn(iteration)),
      appealTerms: config.appealTerms.add(bn(iteration)),
      appealConfirmTerms: config.appealConfirmTerms.add(bn(iteration)),
      penaltyPct: config.penaltyPct.add(bn(iteration * 100)),
      finalRoundReduction: config.finalRoundReduction.add(bn(iteration * 100)),
      firstRoundJurorsNumber: config.firstRoundJurorsNumber.add(bn(iteration)),
      appealStepFactor: config.appealStepFactor.add(bn(iteration)),
      maxRegularAppealRounds: config.maxRegularAppealRounds.add(bn(iteration)),
      finalRoundLockTerms: config.finalRoundLockTerms.add(bn(1)),
      appealCollateralFactor: config.appealCollateralFactor.add(bn(iteration * PCT_BASE)),
      appealConfirmCollateralFactor: config.appealConfirmCollateralFactor.add(bn(iteration * PCT_BASE)),
      minActiveBalance: config.minActiveBalance.add(bigExp(iteration * 100, 18))
    }
  }

  const assertConfig = async (actualConfig, expectedConfig) => {
    assert.equal(actualConfig.feeToken.address, expectedConfig.feeToken.address, 'fee token does not match')
    assertBn(actualConfig.jurorFee, expectedConfig.jurorFee, 'juror fee does not match')
    assertBn(actualConfig.draftFee, expectedConfig.draftFee, 'draft fee does not match')
    assertBn(actualConfig.settleFee, expectedConfig.settleFee, 'settle fee does not match')
    assertBn(actualConfig.commitTerms, expectedConfig.commitTerms, 'commit terms number does not match')
    assertBn(actualConfig.revealTerms, expectedConfig.revealTerms, 'reveal terms number does not match')
    assertBn(actualConfig.appealTerms, expectedConfig.appealTerms, 'appeal terms number does not match')
    assertBn(actualConfig.appealConfirmTerms, expectedConfig.appealConfirmTerms, 'appeal confirmation terms number does not match')
    assertBn(actualConfig.penaltyPct, expectedConfig.penaltyPct, 'penalty permyriad does not match')
    assertBn(actualConfig.finalRoundReduction, expectedConfig.finalRoundReduction, 'final round reduction does not match')
    assertBn(actualConfig.firstRoundJurorsNumber, expectedConfig.firstRoundJurorsNumber, 'first round jurors number does not match')
    assertBn(actualConfig.appealStepFactor, expectedConfig.appealStepFactor, 'appeal step factor does not match')
    assertBn(actualConfig.maxRegularAppealRounds, expectedConfig.maxRegularAppealRounds, 'number of max regular appeal rounds does not match')
    assertBn(actualConfig.finalRoundLockTerms, expectedConfig.finalRoundLockTerms, 'number of final round lock terms does not match')
    assertBn(actualConfig.appealCollateralFactor, expectedConfig.appealCollateralFactor, 'appeal collateral factor does not match')
    assertBn(actualConfig.appealConfirmCollateralFactor, expectedConfig.appealConfirmCollateralFactor, 'appeal confirmation collateral factor does not match')
    assertBn(actualConfig.minActiveBalance, expectedConfig.minActiveBalance, 'min active balance does not match')
  }

  return {
    buildNewConfig,
    assertConfig
  }
}
