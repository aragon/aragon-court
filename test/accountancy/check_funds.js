const { toChecksumAddress } = require('web3-utils')
const { bn, bigExp, assertBn } = require('../helpers/numbers')
const { buildHelper, PCT_BASE, DEFAULTS } = require('../helpers/court')(web3, artifacts)
const { NEXT_WEEK, ONE_DAY } = require('../helpers/time')
const {
  // utils
  buildOriginalFundsState,
  // checks
  checkEmptyBalances,
  checkJurorTokenBalances,
  checkAllFeeTokensBalances,
  // funds state actions
  fundsActions,
} = require('../helpers/accounting.js')

const ERC20 = artifacts.require('ERC20Mock')
const Arbitrable = artifacts.require('ArbitrableMock')
const Controller = artifacts.require('ControllerMock')
const Accounting = artifacts.require('CourtAccounting')
const JurorsRegistry = artifacts.require('JurorsRegistryMock')

contract('Court global accountancy', (
  [owner, user1, user2, juror1, juror2, juror3, juror4, juror5, juror6, juror7]
) => {
  const users = [ user1, user2 ]
  const jurors = [ juror1, juror2, juror3, juror4, juror5, juror6, juror7 ]
  let courtHelper, court, accounting, jurorsRegistry, jurorToken, feeToken

  const termDuration = bn(ONE_DAY)
  const firstTermStartTime = bn(NEXT_WEEK)
  const firstRoundJurorsNumber = 3

  const jurorFee = bigExp(10, 18)
  const heartbeatFee = bigExp(20, 18)
  const draftFee = bigExp(30, 18)
  const settleFee = bigExp(40, 18)

  const MIN_ACTIVE_AMOUNT = bigExp(1, 18)
  const TOTAL_ACTIVE_BALANCE_LIMIT = bigExp(100e6, 18)

  const checkFundsState = async (fundsState) => {
    // Court balances should be empty
    await checkEmptyBalances(court.address, fundsState.feeTokens.concat([ fundsState.jurorToken ]), 'Court', web3, ERC20)

    // Check juror's token global balances
    await checkJurorTokenBalances(fundsState, jurorsRegistry, ERC20)

    // Check fee tokens global balances
    await checkAllFeeTokensBalances(fundsState, accounting, ERC20)
  }

  const runAndCheck = async (receiptPromise, fundsAction, originalFundsState) => {
    const actionReturnValue = await receiptPromise

    const newFundsState = fundsAction.fn(originalFundsState, fundsAction.params, actionReturnValue)
    await checkFundsState(newFundsState)

    return { newFundsState, actionReturnValue }
  }

  beforeEach('create court', async () => {
    courtHelper = buildHelper()

    // tokens
    feeToken = await ERC20.new('Court Fee Token', 'CFT', 18)
    jurorToken = await ERC20.new('Aragon Network Juror Token', 'ANJ', 18)

    // controller
    const controller = await Controller.new()

    // accounting
    accounting = await Accounting.new(controller.address)

    // registry
    jurorsRegistry =  await JurorsRegistry.new(controller.address, jurorToken.address, MIN_ACTIVE_AMOUNT, TOTAL_ACTIVE_BALANCE_LIMIT)

    court = await courtHelper.deploy({
      controller,
      firstTermStartTime,
      termDuration,
      feeToken,
      jurorFee,
      heartbeatFee,
      draftFee,
      settleFee,
      firstRoundJurorsNumber,
      accounting,
      jurorsRegistry,
      jurorToken
    })
  })

  const activate = async (fundsState) => {
    const jurorsWithBalances = jurors.map(juror => {
      return { address: juror, initialActiveBalance: bigExp(10, 21) }
    })

    const { newFundsState } = await runAndCheck(
      courtHelper.activate(jurorsWithBalances),
      {
        fn: fundsActions.activate,
        params: jurorsWithBalances
      },
      fundsState
    )

    return newFundsState
  }

  const dispute = async (fundsState, draftTermId, user) => {
    const disputeFeesInfo = await court.getDisputeFees(draftTermId)
    const { newFundsState, actionReturnValue } = await runAndCheck(
      courtHelper.dispute({
        draftTermId,
        disputer: user1
      }),
      {
        fn: fundsActions.dispute,
        params: disputeFeesInfo
      },
      fundsState
    )

    return { fundsState: newFundsState, disputeId: actionReturnValue, roundId: bn(0) }
  }

  const heartbeat = async (fundsState, currentTermId, desiredTermId, sender) => {
    await courtHelper.increaseTime(termDuration.mul(desiredTermId.sub(currentTermId)))
    const neededTransitions = await court.neededTermTransitions()
    let terms = []
    for (let termId = currentTermId.toNumber(); termId < desiredTermId.toNumber(); termId++) {
      const courtConfig = await court.getCourtConfig(termId)
      const term = await court.getTerm(termId + 1)
      terms.push({
        feeToken: courtConfig.feeToken,
        heartbeatFee: courtConfig.fees[1],
        dependingDrafts: term.dependingDrafts
      })
    }
    const { newFundsState, actionReturnValue } = await runAndCheck(
      court.heartbeat(neededTransitions, { from: sender }),
      {
        fn: fundsActions.heartbeat,
        params: {
          sender,
          terms
        }
      },
      fundsState
    )

    // advance 2 blocks to ensure we can compute term randomness
    await courtHelper.advanceBlocks(2)

    return newFundsState
  }

  const draft = async (fundsState, disputeId, draftTermId, sender) => {
    const courtConfig = await court.getCourtConfig(draftTermId)
    const { newFundsState, actionReturnValue } = await runAndCheck(
      courtHelper.draft({
        disputeId,
        drafter: sender
      }),
      {
        fn: fundsActions.draft,
        params: {
          sender,
          feeToken: courtConfig.feeToken,
          draftFee: courtConfig.fees[2]
        }
      },
      fundsState
    )

    // sort jurors by descending weight, so we make sure that winning outcome will always be LOW when using courtHelper methods for commit and reveal
    const draftedJurors = actionReturnValue.sort((a, b) => a.weight.lt(b.weight) ? 1 : -1 ).map(j => { j.address = toChecksumAddress(j.address); return j })

    return { fundsState: newFundsState, draftedJurors }
  }

  const appeal = async (fundsState, disputeId, roundId, appealMaker) => {
    const nextRoundInfo = await court.getNextRoundDetails(disputeId, roundId)

    const { newFundsState } = await runAndCheck(
      courtHelper.appeal({ disputeId, roundId, appealMaker }),
      {
        fn: fundsActions.appeal,
        params: {
          sender: appealMaker,
          feeToken: nextRoundInfo.feeToken,
          appealDeposit: nextRoundInfo.appealDeposit
        }
      },
      fundsState
    )

    return newFundsState
  }

  const confirmAppeal = async (fundsState, disputeId, roundId, appealTaker) => {
    const nextRoundInfo = await court.getNextRoundDetails(disputeId, roundId)

    const { newFundsState, actionReturnValue } = await runAndCheck(
      courtHelper.confirmAppeal({ disputeId, roundId, appealTaker }),
      {
        fn: fundsActions.confirmAppeal,
        params: {
          sender: appealTaker,
          feeToken: nextRoundInfo.feeToken,
          confirmAppealDeposit: nextRoundInfo.confirmAppealDeposit
        }
      },
      fundsState
    )

    return { fundsState: newFundsState, roundId: actionReturnValue }
  }

  const settleRegularRoundPenalties = async (fundsState, disputeId, roundId, jurorsToSettle, sender) => {
    const { draftTerm } = await court.getRound(disputeId, bn(0))
    const config = await court.getCourtConfig(draftTerm)

    const minActiveBalance = await jurorsRegistry.minJurorsActiveBalance()
    const penalty = minActiveBalance.mul(config.pcts[0]).div(PCT_BASE)
    const { newFundsState } = await runAndCheck(
      court.settlePenalties(disputeId, roundId, jurorsToSettle.length, { from: sender }),
      {
        fn: fundsActions.settleRegularRoundPenalties,
        params: {
          sender,
          feeToken: config.feeToken,
          settleFee: config.fees[3],
          jurorsToSettle: jurorsToSettle,
          penalty
        }
      },
      fundsState
    )

    return newFundsState
  }

  const settlePenalties = async (fundsState, disputeId, lastRoundId, roundDraftedJurors, sender) => {
    let newFundsState = fundsState

    for (let i = 0; i <= lastRoundId.toNumber(); i++) {
      fundsState = await settleRegularRoundPenalties(fundsState, disputeId, i, roundDraftedJurors[i], user1);
    }

    return newFundsState
  }

  const settleRoundJurorReward = async (fundsState, disputeId, roundId, juror, coherentJurors) => {
    const { draftTerm } = await court.getRound(disputeId, bn(0))
    const config = await court.getCourtConfig(draftTerm)

    const round = await court.getRound(disputeId, roundId)
    const { newFundsState } = await runAndCheck(
      court.settleReward(disputeId, roundId, juror.address),
      {
        fn: fundsActions.settleReward,
        params: {
          feeToken: config.feeToken,
          jurorFees: round.jurorFees,
          collectedTokens: round.collectedTokens,
          juror: juror,
          coherentJurors,
        }
      },
      fundsState
    )

    return newFundsState
  }

  const settleRewards = async (fundsState, disputeId, lastRoundId, roundDraftedJurors) => {
    let newFundsState = fundsState
    for (let i = 0; i <= bn(lastRoundId); i++) {
      // only jurors with even index are coherent with winning ruling
      const coherentJurors = roundDraftedJurors[i].reduce((acc, juror, j) => {
        if (j % 2 == 0) {
          acc = acc.add(juror.weight)
        }
        return acc
      }, bn(0))
      for (let j = 0; j < roundDraftedJurors[i].length; j++) {
        if (j % 2 == 0) {
          await settleRoundJurorReward(newFundsState, disputeId, bn(i), roundDraftedJurors[i][j], coherentJurors)
        }
      }
    }

    return newFundsState
  }

  const settleAppealDeposit = async (fundsState, disputeId, roundId, winner) => {
    const nextRoundInfo = await court.getNextRoundDetails(disputeId, roundId)

    const { newFundsState } = await runAndCheck(
      court.settleAppealDeposit(disputeId, roundId),
      {
        fn: fundsActions.settleAppealDeposit,
        params: {
          feeToken: nextRoundInfo.feeToken,
          totalFees: nextRoundInfo.totalFees,
          appealDeposit: nextRoundInfo.appealDeposit,
          confirmAppealDeposit: nextRoundInfo.confirmAppealDeposit,
          winner
        }
      },
      fundsState
    )

    return newFundsState
  }

  const settleAppeals = async (fundsState, disputeId, lastRoundId, winner) => {
    let newFundsState = fundsState

    for (let i = 0; i < lastRoundId.toNumber(); i++) {
      fundsState = await settleAppealDeposit(fundsState, disputeId, i, winner);
    }

    return newFundsState
  }

  context('Main sequence', () => {
    it('does stuff', async () => {
      let fundsState, result
      let currentTermId, draftTermId, disputeId, roundId, draftedJurors, roundDraftedJurors

      currentTermId = bn(0)
      roundDraftedJurors = []
      fundsState = buildOriginalFundsState(users, jurors, jurorToken, [ feeToken ])

      // activate
      fundsState = await activate(fundsState)

      // dispute
      draftTermId = bn(1);
      ({ fundsState, disputeId, roundId } = await dispute(fundsState, draftTermId, user1));

      // heartbeat
      fundsState = await heartbeat(fundsState, currentTermId, draftTermId, user1);

      // draft
      ({ fundsState, draftedJurors } = await draft(fundsState, disputeId, draftTermId, user1))
      roundDraftedJurors.push(draftedJurors)


      // commit
      await courtHelper.commit({
        disputeId,
        roundId,
        voters: draftedJurors
      })

      // reveal
      await courtHelper.reveal({
        disputeId,
        roundId,
        voters: draftedJurors
      })

      // appeal
      fundsState = await appeal(fundsState, disputeId, roundId, user2);

      // confirm appeal
      ({ fundsState, roundId } = await confirmAppeal(fundsState, disputeId, roundId, user1));

      // draft
      ({ fundsState, draftedJurors } = await draft(fundsState, disputeId, draftTermId, user1));
      roundDraftedJurors.push(draftedJurors)


      // commit
      await courtHelper.commit({
        disputeId,
        roundId,
        voters: draftedJurors
      })

      // reveal
      await courtHelper.reveal({
        disputeId,
        roundId,
        voters: draftedJurors
      })

      // pass appeal and confirm terms to make it final
      await courtHelper.passTerms(DEFAULTS.appealTerms)
      await courtHelper.passTerms(DEFAULTS.appealConfirmTerms)

      // settle penalties
      fundsState = await settlePenalties(fundsState, disputeId, roundId, roundDraftedJurors, user1);

      // settle rewards
      fundsState = await settleRewards(fundsState, disputeId, roundId, roundDraftedJurors);

      // settle appeal
      fundsState = await settleAppeals(fundsState, disputeId, roundId, user1);

    })
  })
  // TODO:
  // setConfig
  // reach final round
  // settle reward with no collected tokens
  // settle non-confirmed appeal
  // settle appeal oposed winning
  // settle appeal rejected ruling

})
