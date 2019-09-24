const { bn, bigExp, assertBn } = require('../helpers/numbers')
const { buildHelper } = require('../helpers/court')(web3, artifacts)

contract('Court config', () => {
  let court
  let feeToken
  let jurorFee, heartbeatFee, draftFee, settleFee
  let commitTerms, revealTerms, appealTerms, appealConfirmTerms
  let penaltyPct, finalRoundReduction
  let firstRoundJurorsNumber, appealStepFactor, maxRegularAppealRounds
  let appealCollateralFactor, appealConfirmCollateralFactor

  beforeEach('deploy court', async () => {
    feeToken = await artifacts.require('ERC20Mock').new('Court Fee Token', 'CFT', 18)

    jurorFee = bigExp(10, 18)
    heartbeatFee = bigExp(20, 18)
    draftFee = bigExp(30, 18)
    settleFee = bigExp(40, 18)

    commitTerms = bn(1)
    revealTerms = bn(2)
    appealTerms = bn(3)
    appealConfirmTerms = bn(4)

    penaltyPct = bn(100)
    finalRoundReduction = bn(3300)

    firstRoundJurorsNumber = bn(5)
    appealStepFactor = bn(3)
    maxRegularAppealRounds = bn(2)

    appealCollateralFactor = bn(4)
    appealConfirmCollateralFactor = bn(6)

    const courtHelper = buildHelper()
    court = await courtHelper.deploy({
      feeToken,
      jurorFee, heartbeatFee, draftFee, settleFee,
      commitTerms, revealTerms, appealTerms, appealConfirmTerms,
      penaltyPct, finalRoundReduction,
      firstRoundJurorsNumber, appealStepFactor, maxRegularAppealRounds,
      appealCollateralFactor, appealConfirmCollateralFactor
    })
  })

  context('initialization', () => {
    it('config is properly set', async () => {
      const {
        feeToken: token,
        fees,
        roundStateDurations,
        pcts,
        roundParams,
        appealCollateralParams
      } = await court.getCourtConfig(1)

      assert.equal(token, feeToken.address, 'Fee token does not match')
      assertBn(fees[0], jurorFee, 'Juror fee does not match')
      assertBn(fees[1], heartbeatFee, 'Heartbeat fee does not match')
      assertBn(fees[2], draftFee, 'Draft fee does not match')
      assertBn(fees[3], settleFee, 'Settle fee does not match')
      assertBn(roundStateDurations[0], commitTerms, 'Commit terms number does not match')
      assertBn(roundStateDurations[1], revealTerms, 'Reveal terms number does not match')
      assertBn(roundStateDurations[2], appealTerms, 'Appeal terms number does not match')
      assertBn(roundStateDurations[3], appealConfirmTerms, 'Appeal confirmation terms number does not match')
      assertBn(pcts[0], penaltyPct, 'Penalty permyriad does not match')
      assertBn(pcts[1], finalRoundReduction, 'Final round reduction does not match')
      assertBn(roundParams[0], firstRoundJurorsNumber, 'First round jurors number does not match')
      assertBn(roundParams[1], appealStepFactor, 'Appeal step factor does not match')
      assertBn(roundParams[2], maxRegularAppealRounds, 'Number af max regular appeal rounds does not match')
      assertBn(appealCollateralParams[0], appealCollateralFactor, 'Appeal collateral factor does not match')
      assertBn(appealCollateralParams[1], appealConfirmCollateralFactor, 'Appeal confirmation collateral factor does not match')
    })
  })
})
