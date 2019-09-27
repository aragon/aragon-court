const { bn, bigExp, assertBn } = require('../helpers/numbers')
const { buildHelper } = require('../helpers/court')(web3, artifacts)

contract('Court config', () => {
  let courtHelper, court
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

    courtHelper = buildHelper()
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
        feeToken: _feeToken,
        jurorFee: _jurorFee,
        heartbeatFee: _heartbeatFee,
        draftFee: _draftFee,
        settleFee: _settleFee,
        commitTerms: _commitTerms,
        revealTerms: _revealTerms,
        appealTerms: _appealTerms,
        appealConfirmTerms: _appealConfirmTerms,
        penaltyPct: _penaltyPct,
        finalRoundReduction: _finalRoundReduction,
        firstRoundJurorsNumber: _firstRoundJurorsNumber,
        appealStepFactor: _appealStepFactor,
        maxRegularAppealRounds: _maxRegularAppealRounds,
        appealCollateralFactor: _appealCollateralFactor,
        appealConfirmCollateralFactor: _appealConfirmCollateralFactor,
      } = await courtHelper.getCourtConfig(1)

      assert.equal(_feeToken, feeToken.address, 'Fee token does not match')
      assertBn(_jurorFee, jurorFee, 'Juror fee does not match')
      assertBn(_heartbeatFee, heartbeatFee, 'Heartbeat fee does not match')
      assertBn(_draftFee, draftFee, 'Draft fee does not match')
      assertBn(_settleFee, settleFee, 'Settle fee does not match')
      assertBn(_commitTerms, commitTerms, 'Commit terms number does not match')
      assertBn(_revealTerms, revealTerms, 'Reveal terms number does not match')
      assertBn(_appealTerms, appealTerms, 'Appeal terms number does not match')
      assertBn(_appealConfirmTerms, appealConfirmTerms, 'Appeal confirmation terms number does not match')
      assertBn(_penaltyPct, penaltyPct, 'Penalty permyriad does not match')
      assertBn(_finalRoundReduction, finalRoundReduction, 'Final round reduction does not match')
      assertBn(_firstRoundJurorsNumber, firstRoundJurorsNumber, 'First round jurors number does not match')
      assertBn(_appealStepFactor, appealStepFactor, 'Appeal step factor does not match')
      assertBn(_maxRegularAppealRounds, maxRegularAppealRounds, 'Number af max regular appeal rounds does not match')
      assertBn(_appealCollateralFactor, appealCollateralFactor, 'Appeal collateral factor does not match')
      assertBn(_appealConfirmCollateralFactor, appealConfirmCollateralFactor, 'Appeal confirmation collateral factor does not match')
    })
  })
})
