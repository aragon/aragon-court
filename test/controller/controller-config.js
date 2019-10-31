const { outcomeFor } = require('../helpers/crvoting')
const { buildHelper } = require('../helpers/court')(web3, artifacts)
const { assertRevert } = require('../helpers/assertThrow')
const { bn, bigExp, assertBn } = require('../helpers/numbers')
const { assertEvent, assertAmountOfEvents } = require('../helpers/assertEvent')

contract('Controller', ([_, sender, disputer, drafter, appealMaker, appealTaker, juror500, juror1000, juror3000]) => {
  let courtHelper, controllerHelper
  let originalConfig, initialConfig
  let feeToken
  let jurorFee, draftFee, settleFee
  let commitTerms, revealTerms, appealTerms, appealConfirmTerms
  let penaltyPct, finalRoundReduction
  let firstRoundJurorsNumber, appealStepFactor, maxRegularAppealRounds, finalRoundLockTerms
  let appealCollateralFactor, appealConfirmCollateralFactor
  let minActiveBalance

  const ERROR_SENDER_NOT_CONFIG_GOVERNOR = 'CTR_SENDER_NOT_GOVERNOR'
  const ERROR_TOO_OLD_TERM = 'CONF_TOO_OLD_TERM'

  const checkConfig = async (termId, newConfig) => {
    const {
      newFeeTokenAddress,
      newJurorFee, newDraftFee, newSettleFee,
      newCommitTerms, newRevealTerms, newAppealTerms, newAppealConfirmTerms,
      newPenaltyPct, newFinalRoundReduction,
      newFirstRoundJurorsNumber, newAppealStepFactor, newMaxRegularAppealRounds, newFinalRoundLockTerms,
      newAppealCollateralFactor, newAppealConfirmCollateralFactor,
      newMinActiveBalance
    } = newConfig
    const {
      feeToken,
      jurorFee, draftFee, settleFee,
      commitTerms, revealTerms, appealTerms, appealConfirmTerms,
      penaltyPct, finalRoundReduction,
      firstRoundJurorsNumber, appealStepFactor, maxRegularAppealRounds, finalRoundLockTerms,
      appealCollateralFactor, appealConfirmCollateralFactor,
      minActiveBalance,
    } = await controllerHelper.getConfig(termId)

    assert.equal(feeToken, newFeeTokenAddress, 'Fee token does not match')
    assertBn(jurorFee, newJurorFee, 'Juror fee does not match')
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
    assertBn(maxRegularAppealRounds, newMaxRegularAppealRounds, 'Number of max regular appeal rounds does not match')
    assertBn(finalRoundLockTerms, newFinalRoundLockTerms, 'Number of final round lock terms does not match')
    assertBn(appealCollateralFactor, newAppealCollateralFactor, 'Appeal collateral factor does not match')
    assertBn(appealConfirmCollateralFactor, newAppealConfirmCollateralFactor, 'Appeal confirmation collateral factor does not match')
    assertBn(minActiveBalance, newMinActiveBalance, 'Min active balance does not match')
  }

  beforeEach('deploy court', async () => {
    feeToken = await artifacts.require('ERC20Mock').new('Court Fee Token', 'CFT', 18)

    jurorFee = bigExp(10, 18)
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
    finalRoundLockTerms = bn(2)

    appealCollateralFactor = bn(4)
    appealConfirmCollateralFactor = bn(6)

    minActiveBalance = bigExp(200, 18)

    originalConfig = {
      feeToken,
      jurorFee, draftFee, settleFee,
      commitTerms, revealTerms, appealTerms, appealConfirmTerms,
      penaltyPct, finalRoundReduction,
      firstRoundJurorsNumber, appealStepFactor, maxRegularAppealRounds, finalRoundLockTerms,
      appealCollateralFactor, appealConfirmCollateralFactor,
      minActiveBalance
    }

    initialConfig = {
      newFeeTokenAddress: feeToken.address,
      newJurorFee: jurorFee,
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
      newFinalRoundLockTerms: finalRoundLockTerms,
      newAppealCollateralFactor: appealCollateralFactor,
      newAppealConfirmCollateralFactor: appealConfirmCollateralFactor,
      newMinActiveBalance: minActiveBalance
    }

    courtHelper = buildHelper()
    controllerHelper = courtHelper.controllerHelper

    await courtHelper.deploy({
      feeToken,
      jurorFee,  draftFee, settleFee,
      commitTerms, revealTerms, appealTerms, appealConfirmTerms,
      penaltyPct, finalRoundReduction,
      firstRoundJurorsNumber, appealStepFactor, maxRegularAppealRounds, finalRoundLockTerms,
      appealCollateralFactor, appealConfirmCollateralFactor,
      minActiveBalance
    })
  })

  context('initialization', () => {
    it('config is properly set', async () => {
      await checkConfig(0, initialConfig)
    })
  })

  context('changes after init', () => {
    beforeEach('move forward', async () => {
      // move away from term zero
      await controllerHelper.setTerm(1)
    })

    context('when the config change fails', () => {
      it('fails setting config if no governor', async () => {
        const from = sender
        const configChangeTermId = 3

        // make sure account used is not governor
        assert.notEqual(controllerHelper.governor, from, 'it is actually governor!')

        const { promise } = await controllerHelper.changeConfigPromise(originalConfig, configChangeTermId, sender)
        await assertRevert(promise, ERROR_SENDER_NOT_CONFIG_GOVERNOR)
      })

      it('fails setting config in the past', async () => {
        const configChangeTermId = 3
        // move forward
        await controllerHelper.setTerm(configChangeTermId + 1)

        const { promise } = await controllerHelper.changeConfigPromise(originalConfig, configChangeTermId, controllerHelper.configGovernor)
        await assertRevert(promise, ERROR_TOO_OLD_TERM)
      })

      it('fails setting config with only one term in advance', async () => {
        const configChangeTermId = 3
        // move forward
        await controllerHelper.setTerm(configChangeTermId - 1)

        const { promise } = await controllerHelper.changeConfigPromise(originalConfig, configChangeTermId, controllerHelper.configGovernor)
        await assertRevert(promise, ERROR_TOO_OLD_TERM)
      })
    })

    context('when the config change succeeds', () => {
      const configChangeTermId = 3
      let newConfig

      beforeEach('schedule court config', async () => {
        newConfig = await controllerHelper.changeConfig(originalConfig, configChangeTermId)
      })

      it('check it from the past', async () => {
        await checkConfig(configChangeTermId, newConfig)
      })

      it('schedules the new config properly', async () => {
        const scheduledTermId = await controllerHelper.controller.getConfigChangeTermId()
        assertBn(scheduledTermId, configChangeTermId, 'config change term id does not match')
      })

      it('check once the change term id has been reached', async () => {
        // move forward
        await controllerHelper.setTerm(configChangeTermId)

        await checkConfig(configChangeTermId, newConfig)
      })
    })

    context('overwriting changes at a later term', () => {
      const configChangeTermId1 = 3, configChangeTermId2 = 4
      let newConfig1, newConfig2

      beforeEach('ask for the changes', async () => {
        newConfig1 = await controllerHelper.changeConfig(originalConfig, configChangeTermId1)
        newConfig2 = await controllerHelper.changeConfig(originalConfig, configChangeTermId2, 2)
      })

      it('check it from the past', async () => {
        await checkConfig(configChangeTermId1, initialConfig)
        await checkConfig(configChangeTermId2, newConfig2)
      })

      it('check once the change term id for the first change has been reached', async () => {
        // move forward
        await controllerHelper.setTerm(configChangeTermId1)

        await checkConfig(configChangeTermId1, initialConfig)
        await checkConfig(configChangeTermId2, newConfig2)
      })

      it('check once the change term id for the second change has been reached', async () => {
        // move forward
        await controllerHelper.setTerm(configChangeTermId2)

        await checkConfig(configChangeTermId1, initialConfig)
        await checkConfig(configChangeTermId2, newConfig2)
      })
    })

    context('overwriting changes at a prior term', () => {
      const configChangeTermId1 = 4, configChangeTermId2 = 3
      let newConfig1, newConfig2

      beforeEach('ask for the changes', async () => {
        newConfig1 = await controllerHelper.changeConfig(originalConfig, configChangeTermId1)
        newConfig2 = await controllerHelper.changeConfig(originalConfig, configChangeTermId2, 2)
      })

      it('check it from the past', async () => {
        await checkConfig(configChangeTermId1, newConfig2)
        await checkConfig(configChangeTermId2, newConfig2)
      })

      it('check once the change term id for the first change has been reached', async () => {
        // move forward
        await controllerHelper.setTerm(configChangeTermId1)

        await checkConfig(configChangeTermId1, newConfig2)
        await checkConfig(configChangeTermId2, newConfig2)
      })

      it('check once the change term id for the second change has been reached', async () => {
        // move forward
        await controllerHelper.setTerm(configChangeTermId2)

        await checkConfig(configChangeTermId1, newConfig2)
        await checkConfig(configChangeTermId2, newConfig2)
      })
    })
  })

  context('changes during dispute', () => {
    let disputeId
    const draftTermId = 2
    const configChangeTermId = draftTermId + 1

    const jurors = [
      { address: juror3000, initialActiveBalance: bigExp(3000, 18) },
      { address: juror500,  initialActiveBalance: bigExp( 500, 18) },
      { address: juror1000, initialActiveBalance: bigExp(1000, 18) },
    ]

    beforeEach('activate jurors', async () => {
      await courtHelper.activate(jurors)
    })

    it('does not affect a dispute during its lifetime', async () => {
      // create dispute
      disputeId = await courtHelper.dispute({ draftTermId, disputer })

      // change config
      await controllerHelper.changeConfig(originalConfig, configChangeTermId)

      // move forward to dispute start
      await controllerHelper.setTerm(draftTermId)

      // check dispute config related info
      const { roundJurorsNumber, jurorFees } = await courtHelper.getRound(disputeId, 0)
      assertBn(roundJurorsNumber, firstRoundJurorsNumber, 'Jurors Number doesn\'t match')
      assertBn(jurorFees, firstRoundJurorsNumber.mul(jurorFee), 'Jurors Fees don\'t match')

      // draft
      await controllerHelper.advanceBlocks(1)
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

  describe('setAutomaticWithdrawals', () => {
    let controller

    beforeEach('load controller', async () => {
      controller = courtHelper.controller
    })

    it('are disallowed initially', async () => {
      assert.isFalse(await controller.areWithdrawalsAllowedFor(sender), 'withdrawals are allowed')
    })

    context('when the automatic withdrawals were disallowed', () => {
      it('allows the automatic withdrawals', async () => {
        await controller.setAutomaticWithdrawals(true, { from: sender })

        assert.isTrue(await controller.areWithdrawalsAllowedFor(sender), 'withdrawals are disallowed')
      })

      it('emits an event', async () => {
        const receipt = await controller.setAutomaticWithdrawals(true, { from: sender })

        assertAmountOfEvents(receipt, 'AutomaticWithdrawalsAllowedChanged')
        assertEvent(receipt, 'AutomaticWithdrawalsAllowedChanged', { holder: sender, allowed: true })
      })
    })

    context('when the automatic withdrawals were allowed', () => {
      beforeEach('allow automatic withdrawals', async () => {
        await controller.setAutomaticWithdrawals(true, { from: sender })
      })

      it('disallows the automatic withdrawals', async () => {
        await controller.setAutomaticWithdrawals(false, { from: sender })

        assert.isFalse(await controller.areWithdrawalsAllowedFor(sender), 'withdrawals are allowed')
      })

      it('emits an event', async () => {
        const receipt = await controller.setAutomaticWithdrawals(false, { from: sender })

        assertAmountOfEvents(receipt, 'AutomaticWithdrawalsAllowedChanged')
        assertEvent(receipt, 'AutomaticWithdrawalsAllowedChanged', { holder: sender, allowed: false })
      })
    })
  })
})
