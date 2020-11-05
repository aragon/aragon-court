const FeesUpdater = artifacts.require('FeesUpdater')
const ERC20 = artifacts.require('ERC20Mock')
const PriceOracle = artifacts.require('MockPriceOracle')
const { bn, bigExp } = require('../helpers/lib/numbers')
const { buildHelper } = require('../helpers/wrappers/court')(web3, artifacts)
const { assertConfig, buildNewConfig } = require('../helpers/utils/config')(artifacts)
const { assertBn } = require('../helpers/asserts/assertBn')

const FEE_TOKEN_PRICE_IN_STABLE_TOKEN = bn(500);

contract("FeesUpdater", ([_]) => {
  let courtHelper, controller, feesUpdater, priceOracle, feeToken, stableToken, initialConfig

  const jurorFee = bigExp(10, 18)
  const draftFee = bigExp(30, 18)
  const settleFee = bigExp(40, 18)
  const evidenceTerms = bn(1)
  const commitTerms = bn(1)
  const revealTerms = bn(2)
  const appealTerms = bn(3)
  const appealConfirmTerms = bn(4)
  const penaltyPct = bn(100)
  const finalRoundReduction = bn(3300)
  const firstRoundJurorsNumber = bn(5)
  const appealStepFactor = bn(3)
  const maxRegularAppealRounds = bn(2)
  const finalRoundLockTerms = bn(2)
  const appealCollateralFactor = bn(4)
  const appealConfirmCollateralFactor = bn(6)
  const minActiveBalance = bigExp(200, 18)
  const minMaxPctTotalSupply = bigExp(2, 15) // 0.2%
  const maxMaxPctTotalSupply = bigExp(2, 16) // 2%

  const stableFees = [jurorFee, draftFee, settleFee]
  const feeTokenJurorFee = jurorFee.div(FEE_TOKEN_PRICE_IN_STABLE_TOKEN)
  const feeTokenDraftFee = draftFee.div(FEE_TOKEN_PRICE_IN_STABLE_TOKEN)
  const feeTokenSettleFee = settleFee.div(FEE_TOKEN_PRICE_IN_STABLE_TOKEN)

  const checkConfig = async (termId, expectedConfig) => assertConfig(await courtHelper.getConfig(termId), expectedConfig)

  const assertBnDeepEqual = (actualArray, expectedArray, errorMessage) => {
    for (let i = 0; i < actualArray.length; i++) {
        assertBn(actualArray[i], expectedArray[i], errorMessage)
    }
  }

  beforeEach('create helper', async () => {
    priceOracle = await PriceOracle.new(FEE_TOKEN_PRICE_IN_STABLE_TOKEN)
    feeToken = await ERC20.new('Court Fee Token', 'CFT', 18)
    stableToken = await ERC20.new('Court Stable Token', 'DAI', 18)
    initialConfig = {
      feeToken,
      jurorFee,
      draftFee,
      settleFee,
      evidenceTerms,
      commitTerms,
      revealTerms,
      appealTerms,
      appealConfirmTerms,
      penaltyPct,
      finalRoundReduction,
      firstRoundJurorsNumber,
      appealStepFactor,
      maxRegularAppealRounds,
      finalRoundLockTerms,
      appealCollateralFactor,
      appealConfirmCollateralFactor,
      minActiveBalance,
      minMaxPctTotalSupply,
      maxMaxPctTotalSupply
    }
    courtHelper = buildHelper()
    controller = await courtHelper.deploy({ ...initialConfig })

    feesUpdater = await FeesUpdater.new(priceOracle.address, controller.address, stableToken.address, stableFees)
    await controller.changeFeesUpdater(feesUpdater.address)
  })

  it('stores constructor params', async () => {
    assert.equal(await feesUpdater.priceOracle(), priceOracle.address, 'Incorrect price oracle')
    assert.equal(await feesUpdater.court(), controller.address, 'Incorrect court address')
    assert.equal(await feesUpdater.courtStableToken(), stableToken.address, 'Incorrect stable token')
    assertBnDeepEqual(await feesUpdater.getStableFees(), stableFees, 'Incorrect stable fees')
  })

  context('updateCourtFees()', () => {
    it('updates fees for next term leaving current params the same', async () => {
      await feesUpdater.updateCourtFees();

      const newConfig = { ...initialConfig,
        jurorFee: feeTokenJurorFee,
        draftFee: feeTokenDraftFee,
        settleFee: feeTokenSettleFee
      }
      await checkConfig(1, newConfig)
    })

    it('if config is due to change, it uses that config instead of the current config', async () => {
      const futureTermId = 100
      const newConfig = await buildNewConfig(initialConfig)
      await courtHelper.setConfig(futureTermId, newConfig)
      await checkConfig(99, initialConfig)
      await checkConfig(100, newConfig)

      await feesUpdater.updateCourtFees();

      const configAfterUpdate = { ...newConfig,
        jurorFee: feeTokenJurorFee,
        draftFee: feeTokenDraftFee,
        settleFee: feeTokenSettleFee
      }
      await checkConfig(1, configAfterUpdate)
    })

    it('if config is due to change and updateCourtFees is called twice in same term, it should still use the externally specified future config', async () => {
      const futureTermId = 100
      const newConfig = await buildNewConfig(initialConfig)
      await courtHelper.setConfig(futureTermId, newConfig)

      await feesUpdater.updateCourtFees();
      await feesUpdater.updateCourtFees();

      const configAfterUpdate = { ...newConfig,
        jurorFee: feeTokenJurorFee,
        draftFee: feeTokenDraftFee,
        settleFee: feeTokenSettleFee
      }
      await checkConfig(1, configAfterUpdate)
    })

    it('if config is due to change at multiple terms in the future, it uses the latest config', async () => {
      const configTerm50 = await buildNewConfig(initialConfig)
      const configTerm100 = await buildNewConfig(configTerm50)
      await courtHelper.setConfig(50, configTerm50)
      await courtHelper.setConfig(100, configTerm100)

      await feesUpdater.updateCourtFees();

      const configAfterUpdate = { ...configTerm100,
        jurorFee: feeTokenJurorFee,
        draftFee: feeTokenDraftFee,
        settleFee: feeTokenSettleFee
      }
      await checkConfig(1, configAfterUpdate)
    })
  })
})
