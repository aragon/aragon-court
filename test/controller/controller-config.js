const { assertBn } = require('../helpers/asserts/assertBn')
const { bn, bigExp } = require('../helpers/lib/numbers')
const { buildHelper } = require('../helpers/wrappers/court')(web3, artifacts)
const { assertRevert } = require('../helpers/asserts/assertThrow')
const { NOW, ONE_DAY } = require('../helpers/lib/time')
const { assertConfig, buildNewConfig } = require('../helpers/utils/config')(artifacts)
const { assertEvent, assertAmountOfEvents } = require('../helpers/assertEvent')
const { CLOCK_ERRORS, CONFIG_ERRORS, CONTROLLER_ERRORS } = require('../helpers/utils/errors')

contract('Controller', ([_, configGovernor, someone, disputer, drafter, appealMaker, appealTaker, juror500, juror1000, juror3000]) => {
  let courtHelper, controllerHelper

  let initialConfig, feeToken
  const jurorFee = bigExp(10, 18)
  const draftFee = bigExp(30, 18)
  const settleFee = bigExp(40, 18)
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

  const checkConfig = async (termId, expectedConfig) => assertConfig(await controllerHelper.getConfig(termId), expectedConfig)

  before('set initial config', async () => {
    feeToken = await artifacts.require('ERC20Mock').new('Court Fee Token', 'CFT', 18)
    initialConfig = {
      feeToken,
      jurorFee,
      draftFee,
      settleFee,
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
      minActiveBalance
    }
  })

  beforeEach('create helper', () => {
    courtHelper = buildHelper()
    controllerHelper = courtHelper.controllerHelper
  })

  describe('constructor', () => {
    context('when the initialization succeeds', () => {
      beforeEach('deploy controller', async () => {
        await courtHelper.deploy(initialConfig)
      })

      it('sets configuration properly', async () => {
        await checkConfig(0, initialConfig)
      })
    })

    context('when the initialization fails', () => {
      it('cannot use a term duration greater than the first term start time', async () => {
        await assertRevert(courtHelper.deploy({ mockedTimestamp: NOW, firstTermStartTime: ONE_DAY, termDuration: ONE_DAY + 1 }), CLOCK_ERRORS.BAD_FIRST_TERM_START_TIME)
      })

      it('cannot use a first term start time in the past', async () => {
        await assertRevert(courtHelper.deploy({ mockedTimestamp: NOW, firstTermStartTime: NOW - 1, termDuration: ONE_DAY }), CLOCK_ERRORS.BAD_FIRST_TERM_START_TIME)
      })

      it('cannot use a penalty pct above 100%', async () => {
        await assertRevert(controllerHelper.deploy({ penaltyPct: bn(10001) }), CONFIG_ERRORS.INVALID_PENALTY_PCT)
      })

      it('cannot use a final round reduction above 100%', async () => {
        await assertRevert(controllerHelper.deploy({ finalRoundReduction: bn(10001) }), CONFIG_ERRORS.INVALID_FINAL_ROUND_RED_PCT)
      })

      it('cannot use an appeal collateral factor zero', async () => {
        await assertRevert(controllerHelper.deploy({ appealCollateralFactor: bn(0) }), CONFIG_ERRORS.ZERO_COLLATERAL_FACTOR)
      })

      it('cannot use an appeal confirmation collateral factor zero', async () => {
        await assertRevert(controllerHelper.deploy({ appealConfirmCollateralFactor: bn(0) }), CONFIG_ERRORS.ZERO_COLLATERAL_FACTOR)
      })

      it('cannot use an initial jurors number zero', async () => {
        await assertRevert(controllerHelper.deploy({ firstRoundJurorsNumber: bn(0) }), CONFIG_ERRORS.BAD_INITIAL_JURORS_NUMBER)
      })

      it('cannot use an appeal step factor zero', async () => {
        await assertRevert(controllerHelper.deploy({ appealStepFactor: bn(0) }), CONFIG_ERRORS.BAD_APPEAL_STEP_FACTOR)
      })

      it('cannot use a max appeal rounds zero', async () => {
        await assertRevert(controllerHelper.deploy({ maxRegularAppealRounds: bn(0) }), CONFIG_ERRORS.INVALID_MAX_APPEAL_ROUNDS)
      })

      it('cannot use a max appeal rounds above 10', async () => {
        await assertRevert(controllerHelper.deploy({ maxRegularAppealRounds: bn(11) }), CONFIG_ERRORS.INVALID_MAX_APPEAL_ROUNDS)
      })

      it('cannot use a adjudication round durations zero', async () => {
        await assertRevert(controllerHelper.deploy({ commitTerms: bn(0) }), CONFIG_ERRORS.LARGE_ROUND_PHASE_DURATION)
        await assertRevert(controllerHelper.deploy({ revealTerms: bn(0) }), CONFIG_ERRORS.LARGE_ROUND_PHASE_DURATION)
        await assertRevert(controllerHelper.deploy({ appealTerms: bn(0) }), CONFIG_ERRORS.LARGE_ROUND_PHASE_DURATION)
        await assertRevert(controllerHelper.deploy({ appealConfirmTerms: bn(0) }), CONFIG_ERRORS.LARGE_ROUND_PHASE_DURATION)
      })

      it('cannot use a adjudication round durations bigger than 8670 terms', async () => {
        await assertRevert(controllerHelper.deploy({ commitTerms: bn(8760) }), CONFIG_ERRORS.LARGE_ROUND_PHASE_DURATION)
        await assertRevert(controllerHelper.deploy({ revealTerms: bn(8760) }), CONFIG_ERRORS.LARGE_ROUND_PHASE_DURATION)
        await assertRevert(controllerHelper.deploy({ appealTerms: bn(8760) }), CONFIG_ERRORS.LARGE_ROUND_PHASE_DURATION)
        await assertRevert(controllerHelper.deploy({ appealConfirmTerms: bn(8760) }), CONFIG_ERRORS.LARGE_ROUND_PHASE_DURATION)
      })

      it('cannot use a min active balance 0', async () => {
        await assertRevert(controllerHelper.deploy({ minActiveBalance: bn(0) }), CONFIG_ERRORS.ZERO_MIN_ACTIVE_BALANCE)
      })
    })
  })

  describe('setConfig', () => {
    let newConfig

    beforeEach('deploy controller and build new config', async () => {
      await courtHelper.deploy({ ...initialConfig, configGovernor })
      newConfig = await buildNewConfig(initialConfig)
    })

    context('when the sender is the governor', () => {
      const from = configGovernor

      const itHandlesConfigChangesProperly = (configChangeTermId, handleDisputes) => {
        context('when there was no config change scheduled before', () => {
          context('when the new config is valid', () => {
            beforeEach('change court config', async () => {
              await controllerHelper.setConfig(configChangeTermId, newConfig, { from })
            })

            it('check it from the past', async () => {
              await checkConfig(configChangeTermId, newConfig)
            })

            it('schedules the new config properly', async () => {
              const scheduledTermId = await controllerHelper.controller.getConfigChangeTermId()

              assertBn(scheduledTermId, configChangeTermId, 'config change term id does not match')
            })

            it('check once the change term id has been reached', async () => {
              // move forward to the scheduled term
              await controllerHelper.setTerm(configChangeTermId)

              await checkConfig(configChangeTermId, newConfig)
            })

            if (handleDisputes) {
              it('does not affect a dispute during its lifetime', async () => {
                // activate jurors
                await courtHelper.activate([
                  { address: juror3000, initialActiveBalance: bigExp(3000, 18) },
                  { address: juror500,  initialActiveBalance: bigExp(500, 18) },
                  { address: juror1000, initialActiveBalance: bigExp(1000, 18) }
                ])

                // create dispute and move to dispute start term
                const draftTermId = configChangeTermId - 1
                const disputeId = await courtHelper.dispute({ draftTermId, disputer })
                await controllerHelper.setTerm(draftTermId)

                // check dispute config related info
                const { roundJurorsNumber, jurorFees } = await courtHelper.getRound(disputeId, 0)
                assertBn(roundJurorsNumber, firstRoundJurorsNumber, 'jurors Number does not match')
                assertBn(jurorFees, firstRoundJurorsNumber.mul(jurorFee), 'jurors Fees do not match')

                // draft
                await controllerHelper.advanceBlocks(1)
                const draftedJurors = await courtHelper.draft({ disputeId, drafter })

                // commit and reveal
                await courtHelper.commit({ disputeId, roundId: 0, voters: draftedJurors })
                await courtHelper.reveal({ disputeId, roundId: 0, voters: draftedJurors })

                // appeal and confirm
                await courtHelper.appeal({ disputeId, roundId: 0, appealMaker })
                await courtHelper.confirmAppeal({ disputeId, roundId: 0, appealTaker })

                // check dispute config related info
                const { roundJurorsNumber: appealJurorsNumber, jurorFees: appealJurorFees } = await courtHelper.getRound(disputeId, 1)
                assertBn(appealJurorsNumber, firstRoundJurorsNumber.mul(appealStepFactor), 'jurors Number does not match')
                assertBn(appealJurorFees, appealJurorsNumber.mul(jurorFee), 'jurors Fees do not match')
              })
            }
          })

          context('when the new config is not valid', () => {
            it('cannot use a penalty pct above 100%', async () => {
              newConfig.penaltyPct = bn(10001)
              await assertRevert(controllerHelper.setConfig(configChangeTermId, newConfig, { from }), CONFIG_ERRORS.INVALID_PENALTY_PCT)
            })

            it('cannot use a final round reduction above 100%', async () => {
              newConfig.finalRoundReduction = bn(10001)
              await assertRevert(controllerHelper.setConfig(configChangeTermId, newConfig, { from }), CONFIG_ERRORS.INVALID_FINAL_ROUND_RED_PCT)
            })

            it('cannot use an appeal collateral factor zero', async () => {
              newConfig.appealCollateralFactor = bn(0)
              await assertRevert(controllerHelper.setConfig(configChangeTermId, newConfig, { from }), CONFIG_ERRORS.ZERO_COLLATERAL_FACTOR)
            })

            it('cannot use an appeal confirmation collateral factor zero', async () => {
              newConfig.appealConfirmCollateralFactor = bn(0)
              await assertRevert(controllerHelper.setConfig(configChangeTermId, newConfig, { from }), CONFIG_ERRORS.ZERO_COLLATERAL_FACTOR)
            })

            it('cannot use an initial jurors number zero', async () => {
              newConfig.firstRoundJurorsNumber = bn(0)
              await assertRevert(controllerHelper.setConfig(configChangeTermId, newConfig, { from }), CONFIG_ERRORS.BAD_INITIAL_JURORS_NUMBER)
            })

            it('cannot use an appeal step factor zero', async () => {
              newConfig.appealStepFactor = bn(0)
              await assertRevert(controllerHelper.setConfig(configChangeTermId, newConfig, { from }), CONFIG_ERRORS.BAD_APPEAL_STEP_FACTOR)
            })

            it('cannot use a max appeal rounds zero', async () => {
              newConfig.maxRegularAppealRounds = bn(0)
              await assertRevert(controllerHelper.setConfig(configChangeTermId, newConfig, { from }), CONFIG_ERRORS.INVALID_MAX_APPEAL_ROUNDS)
            })

            it('cannot use a max appeal rounds above 10', async () => {
              newConfig.maxRegularAppealRounds = bn(11)
              await assertRevert(controllerHelper.setConfig(configChangeTermId, newConfig, { from }), CONFIG_ERRORS.INVALID_MAX_APPEAL_ROUNDS)
            })

            it('cannot use a adjudication round durations zero', async () => {
              newConfig.commitTerms = bn(0)
              await assertRevert(controllerHelper.setConfig(configChangeTermId, newConfig, { from }), CONFIG_ERRORS.LARGE_ROUND_PHASE_DURATION)

              newConfig.revealTerms = bn(0)
              await assertRevert(controllerHelper.setConfig(configChangeTermId, newConfig, { from }), CONFIG_ERRORS.LARGE_ROUND_PHASE_DURATION)

              newConfig.appealTerms = bn(0)
              await assertRevert(controllerHelper.setConfig(configChangeTermId, newConfig, { from }), CONFIG_ERRORS.LARGE_ROUND_PHASE_DURATION)

              newConfig.appealConfirmTerms = bn(0)
              await assertRevert(controllerHelper.setConfig(configChangeTermId, newConfig, { from }), CONFIG_ERRORS.LARGE_ROUND_PHASE_DURATION)
            })

            it('cannot use a adjudication round durations bigger than 8670 terms', async () => {
              newConfig.commitTerms = bn(8760)
              await assertRevert(controllerHelper.setConfig(configChangeTermId, newConfig, { from }), CONFIG_ERRORS.LARGE_ROUND_PHASE_DURATION)

              newConfig.revealTerms = bn(8760)
              await assertRevert(controllerHelper.setConfig(configChangeTermId, newConfig, { from }), CONFIG_ERRORS.LARGE_ROUND_PHASE_DURATION)

              newConfig.appealTerms = bn(8760)
              await assertRevert(controllerHelper.setConfig(configChangeTermId, newConfig, { from }), CONFIG_ERRORS.LARGE_ROUND_PHASE_DURATION)

              newConfig.appealConfirmTerms = bn(8760)
              await assertRevert(controllerHelper.setConfig(configChangeTermId, newConfig, { from }), CONFIG_ERRORS.LARGE_ROUND_PHASE_DURATION)
            })

            it('cannot use a min active balance 0', async () => {
              newConfig.minActiveBalance = bn(0)
              await assertRevert(controllerHelper.setConfig(configChangeTermId, newConfig, { from }), CONFIG_ERRORS.ZERO_MIN_ACTIVE_BALANCE)
            })
          })
        })

        context('when there was a config change already scheduled', () => {
          let previousScheduledConfig
          const previousConfigChangeTermId = configChangeTermId + 1

          beforeEach('schedule config and build new config change', async () => {
            previousScheduledConfig = newConfig
            newConfig = await buildNewConfig(previousScheduledConfig)
            await controllerHelper.setConfig(previousConfigChangeTermId, newConfig, { from })
          })

          context('when overwriting changes at a later term', () => {
            const newConfigChangeTermId = previousConfigChangeTermId + 1

            beforeEach('change court config', async () => {
              await controllerHelper.setConfig(newConfigChangeTermId, newConfig, { from })
            })

            it('check it from the past', async () => {
              await checkConfig(previousConfigChangeTermId, initialConfig)
              await checkConfig(newConfigChangeTermId, newConfig)
            })

            it('check once the change term id for the first change has been reached', async () => {
              // move forward to the previous scheduled term ID
              await controllerHelper.setTerm(previousConfigChangeTermId)

              await checkConfig(previousConfigChangeTermId, initialConfig)
              await checkConfig(newConfigChangeTermId, newConfig)
            })

            it('check once the change term id for the second change has been reached', async () => {
              // move forward to the new scheduled term ID
              await controllerHelper.setTerm(newConfigChangeTermId)

              await checkConfig(previousConfigChangeTermId, initialConfig)
              await checkConfig(newConfigChangeTermId, newConfig)
            })
          })

          context('when overwriting changes at a prior term', () => {
            const newConfigChangeTermId = previousConfigChangeTermId - 1

            beforeEach('change court config', async () => {
              await controllerHelper.setConfig(newConfigChangeTermId, newConfig, { from })
            })

            it('check it from the past', async () => {
              await checkConfig(previousConfigChangeTermId, newConfig)
              await checkConfig(newConfigChangeTermId, newConfig)
            })

            it('check once the change term id for the first change has been reached', async () => {
              // move forward to the previous scheduled term ID
              await controllerHelper.setTerm(previousConfigChangeTermId)

              await checkConfig(previousConfigChangeTermId, newConfig)
              await checkConfig(newConfigChangeTermId, newConfig)
            })

            it('check once the change term id for the second change has been reached', async () => {
              // move forward to the new scheduled term ID
              await controllerHelper.setTerm(newConfigChangeTermId)

              await checkConfig(previousConfigChangeTermId, newConfig)
              await checkConfig(newConfigChangeTermId, newConfig)
            })
          })
        })
      }

      context('when the court is at term #0', () => {
        const currentTerm = 0
        const handleDisputes = false

        context('when scheduling a config one term in the future', () => {
          const configChangeTermId = currentTerm + 1

          itHandlesConfigChangesProperly(configChangeTermId, handleDisputes)
        })

        context('when scheduling a config for the current term', () => {
          const configChangeTermId = currentTerm

          itHandlesConfigChangesProperly(configChangeTermId, handleDisputes)
        })
      })

      context('when the court is after term #1', () => {
        const currentTerm = 1

        beforeEach('move to term #1', async () => {
          await controllerHelper.setTerm(currentTerm)
        })

        context('when scheduling a config two terms in the future', () => {
          const handleDisputes = true
          const configChangeTermId = currentTerm + 2

          itHandlesConfigChangesProperly(configChangeTermId, handleDisputes)
        })

        context('when scheduling a config one term in the future', () => {
          const configChangeTermId = currentTerm + 1

          it('reverts', async () => {
            await assertRevert(controllerHelper.setConfig(configChangeTermId, newConfig, { from }), CONFIG_ERRORS.TOO_OLD_TERM)
          })
        })

        context('when scheduling a config for the current term', () => {
          const configChangeTermId = currentTerm

          it('reverts', async () => {
            await assertRevert(controllerHelper.setConfig(configChangeTermId, newConfig, { from }), CONFIG_ERRORS.TOO_OLD_TERM)
          })
        })

        context('when scheduling a config for the previous term', () => {
          const configChangeTermId = currentTerm - 1

          it('reverts', async () => {
            await assertRevert(controllerHelper.setConfig(configChangeTermId, newConfig, { from }), CONFIG_ERRORS.TOO_OLD_TERM)
          })
        })
      })
    })

    context('when the sender is not the governor', () => {
      const from = someone

      it('reverts', async () => {
        await assertRevert(controllerHelper.setConfig(0, newConfig, { from }), CONTROLLER_ERRORS.SENDER_NOT_GOVERNOR)
      })
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
