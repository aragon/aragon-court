const { bn, bigExp, assertBn } = require('../helpers/numbers')
const { buildHelper } = require('../helpers/court')(web3, artifacts)
const { assertRevert } = require('../helpers/assertThrow')
const { assertAmountOfEvents } = require('../helpers/assertEvent')
const { outcomeFor } = require('../helpers/crvoting')

contract('Court config', ([_, sender, disputer, drafter, appealMaker, appealTaker, juror500, juror1000, juror3000]) => {
  let courtHelper, court
  let initialConfig
  let feeToken
  let jurorFee, heartbeatFee, draftFee, settleFee
  let commitTerms, revealTerms, appealTerms, appealConfirmTerms
  let penaltyPct, finalRoundReduction
  let firstRoundJurorsNumber, appealStepFactor, maxRegularAppealRounds
  let appealCollateralFactor, appealConfirmCollateralFactor

  const ERROR_BAD_SENDER = 'CT_BAD_SENDER'
  const ERROR_PAST_TERM = 'CT_PAST_TERM'

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

    initialConfig = {
      newFeeTokenAddress: feeToken.address,
      newJurorFee: jurorFee,
      newHeartbeatFee: heartbeatFee,
      newDraftFee: draftFee,
      newSettleFee: settleFee,
      newCommitTerms: commitTerms,
      newRevealTerms: revealTerms,
      newAppealTerms: appealTerms,
      newAppealConfirmTerms: appealConfirmTerms,
      newPenaltyPct: penaltyPct,
      newFinalRoundReduction: finalRoundReduction,
      newFirstRoundJurorsNumber: firstRoundJurorsNumber,
      newAppealStepFactor: appealStepFactor,
      newMaxRegularAppealRounds: maxRegularAppealRounds,
      newAppealCollateralFactor: appealCollateralFactor,
      newAppealConfirmCollateralFactor: appealConfirmCollateralFactor
    }

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

  const checkConfig = async (termId, {
    newFeeTokenAddress,
    newJurorFee, newHeartbeatFee, newDraftFee, newSettleFee,
    newCommitTerms, newRevealTerms, newAppealTerms, newAppealConfirmTerms,
    newPenaltyPct, newFinalRoundReduction,
    newFirstRoundJurorsNumber, newAppealStepFactor, newMaxRegularAppealRounds,
    newAppealCollateralFactor, newAppealConfirmCollateralFactor
  }) => {
    const {
      feeToken,
      jurorFee, heartbeatFee, draftFee, settleFee,
      commitTerms, revealTerms, appealTerms, appealConfirmTerms,
      penaltyPct, finalRoundReduction,
      firstRoundJurorsNumber, appealStepFactor, maxRegularAppealRounds,
      appealCollateralFactor, appealConfirmCollateralFactor,
    } = await courtHelper.getCourtConfig(termId)

    assert.equal(feeToken, newFeeTokenAddress, 'Fee token does not match')
    assertBn(jurorFee, newJurorFee, 'Juror fee does not match')
    assertBn(heartbeatFee, newHeartbeatFee, 'Heartbeat fee does not match')
    assertBn(draftFee, newDraftFee, 'Draft fee does not match')
    assertBn(settleFee, newSettleFee, 'Settle fee does not match')
    assertBn(commitTerms, newCommitTerms, 'Commit terms number does not match')
    assertBn(revealTerms, newRevealTerms, 'Reveal terms number does not match')
    assertBn(appealTerms, newAppealTerms, 'Appeal terms number does not match')
    assertBn(appealConfirmTerms, newAppealConfirmTerms, 'Appeal confirmation terms number does not match')
    assertBn(penaltyPct, newPenaltyPct, 'Penalty permyriad does not match')
    assertBn(finalRoundReduction, newFinalRoundReduction, 'Final round reduction does not match')
    assertBn(firstRoundJurorsNumber, newFirstRoundJurorsNumber, 'First round jurors number does not match')
    assertBn(appealStepFactor, newAppealStepFactor, 'Appeal step factor does not match')
    assertBn(maxRegularAppealRounds, newMaxRegularAppealRounds, 'Number af max regular appeal rounds does not match')
    assertBn(appealCollateralFactor, newAppealCollateralFactor, 'Appeal collateral factor does not match')
    assertBn(appealConfirmCollateralFactor, newAppealConfirmCollateralFactor, 'Appeal confirmation collateral factor does not match')
  }

  const buildNewConfig = async (iteration = 1) => {
    const newFeeToken = await artifacts.require('ERC20Mock').new('Court Fee Token', 'CFT', 18)
    const newFeeTokenAddress = newFeeToken.address
    const newJurorFee = jurorFee.add(bigExp(iteration * 10, 18))
    const newHeartbeatFee = heartbeatFee.add(bigExp(iteration * 10, 18))
    const newDraftFee = draftFee.add(bigExp(iteration * 10, 18))
    const newSettleFee = settleFee.add(bigExp(iteration * 10, 18))
    const newCommitTerms = commitTerms.add(bn(iteration))
    const newRevealTerms = revealTerms.add(bn(iteration))
    const newAppealTerms = appealTerms.add(bn(iteration))
    const newAppealConfirmTerms = appealConfirmTerms.add(bn(iteration))
    const newPenaltyPct = penaltyPct.add(bn(iteration * 100))
    const newFinalRoundReduction = finalRoundReduction.add(bn(iteration * 100))
    const newFirstRoundJurorsNumber = firstRoundJurorsNumber.add(bn(iteration))
    const newAppealStepFactor = appealStepFactor.add(bn(iteration))
    const newMaxRegularAppealRounds = maxRegularAppealRounds.add(bn(iteration))
    const newAppealCollateralFactor = appealCollateralFactor.add(bn(iteration))
    const newAppealConfirmCollateralFactor = appealConfirmCollateralFactor.add(bn(iteration))

    return {
      newFeeTokenAddress,
      newJurorFee, newHeartbeatFee, newDraftFee, newSettleFee,
      newCommitTerms, newRevealTerms, newAppealTerms, newAppealConfirmTerms,
      newPenaltyPct, newFinalRoundReduction,
      newFirstRoundJurorsNumber, newAppealStepFactor, newMaxRegularAppealRounds,
      newAppealCollateralFactor,
      newAppealConfirmCollateralFactor,
    }
  }

  const changeConfigPromise = async (termId, from, iteration = 1) => {
    const newConfig = await buildNewConfig()
    const {
      newFeeTokenAddress,
      newJurorFee, newHeartbeatFee, newDraftFee, newSettleFee,
      newCommitTerms, newRevealTerms, newAppealTerms, newAppealConfirmTerms,
      newPenaltyPct, newFinalRoundReduction,
      newFirstRoundJurorsNumber, newAppealStepFactor, newMaxRegularAppealRounds,
      newAppealCollateralFactor,
      newAppealConfirmCollateralFactor,
    } = newConfig

    const promise = court.setCourtConfig(
      termId,
      newFeeTokenAddress,
      [ newJurorFee, newHeartbeatFee, newDraftFee, newSettleFee ],
      [ newCommitTerms, newRevealTerms, newAppealTerms, newAppealConfirmTerms ],
      [ newPenaltyPct, newFinalRoundReduction ],
      [ newFirstRoundJurorsNumber, newAppealStepFactor, newMaxRegularAppealRounds ],
      [ newAppealCollateralFactor, newAppealConfirmCollateralFactor ],
      { from }
    )

    return { promise, newConfig }
  }

  const changeConfig = async (termId, iteration = 1) => {
    const { promise, newConfig } = await changeConfigPromise(termId, courtHelper.governor)
    await promise

    return newConfig
  }

  context('initialization', () => {
    it('config is properly set', async () => {
      await checkConfig(0, initialConfig)
    })
  })

  context('changes after init', () => {
    it('fails setting config if no governor', async () => {
      const from = sender

      // make sure account used is not governor
      assert.notEqual(courtHelper.governor, from, 'it is actually governor!')

      const { promise } = await changeConfigPromise(1, sender)
      await assertRevert(promise, ERROR_BAD_SENDER)
    })

    it('fails setting config in the past', async () => {
      const configChangeTermId = 1
      // move forward
      await courtHelper.setTerm(configChangeTermId + 1)

      const { promise } = await changeConfigPromise(configChangeTermId, courtHelper.governor)
      await assertRevert(promise, ERROR_PAST_TERM)
    })

    context('governor can change config', () => {
      const configChangeTermId = 1
      let newConfig

      beforeEach('ask for the change', async () => {
        newConfig = await changeConfig(configChangeTermId)
      })

      it('check it from the past', async () => {
        await checkConfig(configChangeTermId, newConfig)
      })

      it('check once the change term id has been reached', async () => {
        // move forward
        await courtHelper.setTerm(configChangeTermId)

        await checkConfig(configChangeTermId, newConfig)
      })
    })

    context('overwriting changes', () => {
      const configChangeTermId1 = 1, configChangeTermId2 = 2
      let newConfig1, newConfig2

      beforeEach('ask for the changes', async () => {
        newConfig1 = await changeConfig(configChangeTermId1)
        newConfig2 = await changeConfig(configChangeTermId2, 2)
      })

      it('check it from the past', async () => {
        await checkConfig(configChangeTermId1, initialConfig)
        await checkConfig(configChangeTermId2, newConfig2)
      })

      it('check once the change term id for the first change has been reached', async () => {
        // move forward
        await courtHelper.setTerm(configChangeTermId1)

        await checkConfig(configChangeTermId1, initialConfig)
        await checkConfig(configChangeTermId2, newConfig2)
      })

      it('check once the change term id for the second change has been reached', async () => {
        // move forward
        await courtHelper.setTerm(configChangeTermId2)

        await checkConfig(configChangeTermId1, initialConfig)
        await checkConfig(configChangeTermId2, newConfig2)
      })
    })
  })

  context('changes during dispute', () => {
    let disputeId
    const draftTermId = 2
    const configChangeTermId = draftTermId + 1
    const possibleRulings = 2

    const jurors = [
      { address: juror3000, initialActiveBalance: bigExp(3000, 18) },
      { address: juror500,  initialActiveBalance: bigExp( 500, 18) },
      { address: juror1000, initialActiveBalance: bigExp(1000, 18) },
    ]

    beforeEach('activate jurors', async () => {
      await courtHelper.activate(jurors)
    })

    it('dispute is not affected by config settings during its lifetime', async () => {
      // create dispute
      disputeId = await courtHelper.dispute({ draftTermId, disputer })

      // change config
      await changeConfig(configChangeTermId)

      // move forward to dispute start
      await courtHelper.setTerm(draftTermId)

      // check dispute config related info
      const { roundJurorsNumber, jurorFees } = await courtHelper.getRound(disputeId, 0)
      assertBn(roundJurorsNumber, firstRoundJurorsNumber, 'Jurors Number doesn\'t match')
      assertBn(jurorFees, firstRoundJurorsNumber.mul(jurorFee), 'Jurors Fees don\'t match')

      // draft
      await courtHelper.advanceBlocks(1)
      const draftedJurors = await courtHelper.draft({ disputeId, drafter })
      // commit and reveal
      const voters = draftedJurors.slice(0, 3)
      voters.forEach((voter, i) => voter.outcome = outcomeFor(i))
      await courtHelper.commit({ disputeId, roundId: 0, voters })
      await courtHelper.reveal({ disputeId, roundId: 0, voters })
      // appeal
      await courtHelper.appeal({ disputeId, roundId: 0, appealMaker })
      // confirm appeal
      await courtHelper.confirmAppeal({ disputeId, roundId: 0, appealTaker })

      // check dispute config related info
      const { roundJurorsNumber: appealJurorsNumber, jurorFees: appealJurorFees } = await courtHelper.getRound(disputeId, 1)
      assertBn(appealJurorsNumber, firstRoundJurorsNumber.mul(appealStepFactor), 'Jurors Number doesn\'t match')
      assertBn(appealJurorFees, appealJurorsNumber.mul(jurorFee), 'Jurors Fees don\'t match')
    })
  })
})
