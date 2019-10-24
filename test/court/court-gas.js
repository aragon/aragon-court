const { assertBn } = require('../helpers/numbers')
const { bn, bigExp } = require('../helpers/numbers')
const { printTable } = require('../helpers/logging')
const { buildHelper } = require('../helpers/court')(web3, artifacts)
const { getVoteId, encryptVote, oppositeOutcome, SALT, OUTCOMES } = require('../helpers/crvoting')

const Arbitrable = artifacts.require('ArbitrableMock')

contract('Court', ([_, sender, disputer, drafter, appealMaker, appealTaker, juror500, juror1000, juror1500, juror2000, juror2500, juror3000]) => {
  let courtHelper, controllerHelper, court, voting, controller, costs = {}

  const jurors = [
    { address: juror500,  initialActiveBalance: bigExp(500,  18) },
    { address: juror1000, initialActiveBalance: bigExp(1000, 18) },
    { address: juror1500, initialActiveBalance: bigExp(1500, 18) },
    { address: juror2000, initialActiveBalance: bigExp(2000, 18) },
    { address: juror2500, initialActiveBalance: bigExp(2500, 18) },
    { address: juror3000, initialActiveBalance: bigExp(3000, 18) },
  ]

  beforeEach('create court and activate jurors', async () => {
    courtHelper = buildHelper()
    court = await courtHelper.deploy()

    voting = courtHelper.voting
    controller = courtHelper.controller
    controllerHelper = courtHelper.controllerHelper

    await courtHelper.activate(jurors)
  })

  describe('gas costs', () => {
    const itCostsAtMost = (method, expectedCost, call) => {
      it(`should cost up to ${expectedCost.toLocaleString()} gas`, async () => {
        const { receipt: { gasUsed } } = await call()
        console.log(`gas costs: ${gasUsed.toLocaleString()}`)
        costs[method] = (costs[method] || []).concat(gasUsed.toLocaleString())
        assert.isAtMost(gasUsed, expectedCost)
      })
    }

    describe('createDispute', () => {
      let arbitrable

      beforeEach('create arbitrable and approve fee amount', async () => {
        arbitrable = await Arbitrable.new()
        await courtHelper.subscriptions.setUpToDate(true)
        const { disputeFees } = await courtHelper.getDisputeFees(1)
        await courtHelper.mintAndApproveFeeTokens(sender, court.address, disputeFees)
      })

      context('when the current term is up-to-date', () => {
        beforeEach('assert needed transitions', async () => {
          const neededTransitions = await controller.getNeededTermTransitions()
          assertBn(neededTransitions, 0, 'needed transitions does not match')
        })

        itCostsAtMost('createDispute', 216e3, () => court.createDispute(arbitrable.address, 2, { from: sender }))
      })

      context('when the current term is outdated by one term', () => {
        beforeEach('assert needed transitions', async () => {
          await courtHelper.increaseTimeInTerms(1)
          const neededTransitions = await controller.getNeededTermTransitions()
          assertBn(neededTransitions, 1, 'needed transitions does not match')
        })

        itCostsAtMost('createDispute', 253e3, () => court.createDispute(arbitrable.address, 2, { from: sender }))
      })
    })

    describe('draft', () => {
      let disputeId

      beforeEach('create dispute and advance to the draft term', async () => {
        const draftTermId = 2
        disputeId = await courtHelper.dispute({ draftTermId, disputer })

        const lastEnsuredTermId = await controller.getLastEnsuredTermId()
        await courtHelper.passRealTerms(draftTermId - lastEnsuredTermId)
      })

      itCostsAtMost('draft', 395e3, () => court.draft(disputeId, 100))
    })

    describe('commit', () => {
      let voteId, draftedJurors

      const vote = encryptVote(OUTCOMES.LOW)

      beforeEach('create dispute and draft', async () => {
        const draftTermId = 2, roundId = 0
        const disputeId = await courtHelper.dispute({ draftTermId, disputer })
        voteId = getVoteId(disputeId, roundId)

        // draft, court is already at term previous to dispute start
        await courtHelper.passTerms(bn(1))
        draftedJurors = await courtHelper.draft({ disputeId, drafter })
      })

      context('when the current term is up-to-date', () => {
        beforeEach('assert needed transitions', async () => {
          const neededTransitions = await controller.getNeededTermTransitions()
          assertBn(neededTransitions, 0, 'needed transitions does not match')
        })

        itCostsAtMost('commit', 90e3, () => voting.commit(voteId, vote, { from: draftedJurors[0].address }))
      })

      context('when the current term is outdated by one term', () => {
        beforeEach('assert needed transitions', async () => {
          await courtHelper.increaseTimeInTerms(1)
          const neededTransitions = await controller.getNeededTermTransitions()
          assertBn(neededTransitions, 1, 'needed transitions does not match')
        })

        itCostsAtMost('commit', 126e3, () => voting.commit(voteId, vote, { from: draftedJurors[0].address }))
      })
    })

    describe('reveal', () => {
      let voteId, draftedJurors

      const outcome = OUTCOMES.LOW

      beforeEach('create dispute, draft and vote', async () => {
        const draftTermId = 2, roundId = 0
        const disputeId = await courtHelper.dispute({ draftTermId, disputer })
        voteId = getVoteId(disputeId, roundId)

        // draft, court is already at term previous to dispute start
        await courtHelper.passTerms(bn(1))
        draftedJurors = await courtHelper.draft({ disputeId, drafter })

        await courtHelper.commit({ disputeId, roundId, voters: draftedJurors })
      })

      context('when the current term is up-to-date', () => {
        beforeEach('assert needed transitions', async () => {
          const neededTransitions = await controller.getNeededTermTransitions()
          assertBn(neededTransitions, 0, 'needed transitions does not match')
        })

        itCostsAtMost('reveal', 105e3, () => voting.reveal(voteId, outcome, SALT, { from: draftedJurors[0].address }))
      })

      context('when the current term is outdated by one term', () => {
        beforeEach('assert needed transitions', async () => {
          await courtHelper.increaseTimeInTerms(1)
          const neededTransitions = await controller.getNeededTermTransitions()
          assertBn(neededTransitions, 1, 'needed transitions does not match')
        })

        itCostsAtMost('reveal', 141e3, () => voting.reveal(voteId, outcome, SALT, { from: draftedJurors[0].address }))
      })
    })

    describe('createAppeal', () => {
      let disputeId, roundId = 0, appealMakerRuling

      beforeEach('create dispute, draft and vote', async () => {
        const draftTermId = 2
        disputeId = await courtHelper.dispute({ draftTermId, disputer })
        const voteId = getVoteId(disputeId, roundId)

        // draft, court is already at term previous to dispute start
        await courtHelper.passTerms(bn(1))
        const draftedJurors = await courtHelper.draft({ disputeId, drafter })

        // commit and reveal votes
        await courtHelper.commit({ disputeId, roundId, voters: draftedJurors })
        await courtHelper.reveal({ disputeId, roundId, voters: draftedJurors })

        // compute appeal ruling
        const winningRuling = await voting.getWinningOutcome(voteId)
        appealMakerRuling = oppositeOutcome(winningRuling)

        // mint appeal fees
        const { appealDeposit } = await courtHelper.getAppealFees(disputeId, roundId)
        await courtHelper.mintAndApproveFeeTokens(appealMaker, court.address, appealDeposit)
      })

      context('when the current term is up-to-date', () => {
        beforeEach('assert needed transitions', async () => {
          const neededTransitions = await controller.getNeededTermTransitions()
          assertBn(neededTransitions, 0, 'needed transitions does not match')
        })

        itCostsAtMost('createAppeal', 85e3, () => court.createAppeal(disputeId, roundId, appealMakerRuling, { from: appealMaker }))
      })

      context('when the current term is outdated by one term', () => {
        beforeEach('assert needed transitions', async () => {
          await courtHelper.increaseTimeInTerms(1)
          const neededTransitions = await controller.getNeededTermTransitions()
          assertBn(neededTransitions, 1, 'needed transitions does not match')
        })

        itCostsAtMost('createAppeal', 121e3, () => court.createAppeal(disputeId, roundId, appealMakerRuling, { from: appealMaker }))
      })
    })

    describe('confirmAppeal', () => {
      let disputeId, roundId = 0, appealTakerRuling

      beforeEach('create dispute, draft, vote and appeal', async () => {
        const draftTermId = 2
        disputeId = await courtHelper.dispute({ draftTermId, disputer })

        // draft, court is already at term previous to dispute start
        await courtHelper.passTerms(bn(1))
        const draftedJurors = await courtHelper.draft({ disputeId, drafter })

        // vote and appeal
        await courtHelper.commit({ disputeId, roundId, voters: draftedJurors })
        await courtHelper.reveal({ disputeId, roundId, voters: draftedJurors })
        await courtHelper.appeal({ disputeId, roundId, appealMaker })

        // compute appeal confirmation ruling
        const { appealedRuling } = await courtHelper.getAppeal(disputeId, roundId)
        appealTakerRuling = oppositeOutcome(appealedRuling)

        // mint appeal confirmation fees
        const { confirmAppealDeposit } = await courtHelper.getAppealFees(disputeId, roundId)
        await courtHelper.mintAndApproveFeeTokens(appealTaker, court.address, confirmAppealDeposit)
      })

      context('when the current term is up-to-date', () => {
        beforeEach('assert needed transitions', async () => {
          const neededTransitions = await controller.getNeededTermTransitions()
          assertBn(neededTransitions, 0, 'needed transitions does not match')
        })

        itCostsAtMost('confirmAppeal', 191e3, () => court.confirmAppeal(disputeId, roundId, appealTakerRuling, { from: appealTaker }))
      })

      context('when the current term is outdated by one term', () => {
        beforeEach('assert needed transitions', async () => {
          await courtHelper.increaseTimeInTerms(1)
          const neededTransitions = await controller.getNeededTermTransitions()
          assertBn(neededTransitions, 1, 'needed transitions does not match')
        })

        itCostsAtMost('confirmAppeal', 227e3, () => court.confirmAppeal(disputeId, roundId, appealTakerRuling, { from: appealTaker }))
      })
    })

    describe('executeRuling', () => {
      let disputeId

      beforeEach('create dispute, draft and vote', async () => {
        const draftTermId = 2, roundId = 0
        disputeId = await courtHelper.dispute({ draftTermId, disputer })

        // draft, court is already at term previous to dispute start
        await courtHelper.passTerms(bn(1))
        const draftedJurors = await courtHelper.draft({ disputeId, drafter })

        // commit and reveal votes
        await courtHelper.commit({ disputeId, roundId, voters: draftedJurors })
        await courtHelper.reveal({ disputeId, roundId, voters: draftedJurors })
        await courtHelper.passTerms(courtHelper.appealTerms)
      })

      context('when the current term is up-to-date', () => {
        beforeEach('assert needed transitions', async () => {
          const neededTransitions = await controller.getNeededTermTransitions()
          assertBn(neededTransitions, 0, 'needed transitions does not match')
        })

        itCostsAtMost('executeRuling', 66e3, () => court.executeRuling(disputeId))
      })

      context('when the current term is outdated by one term', () => {
        beforeEach('assert needed transitions', async () => {
          await courtHelper.increaseTimeInTerms(1)
          const neededTransitions = await controller.getNeededTermTransitions()
          assertBn(neededTransitions, 1, 'needed transitions does not match')
        })

        itCostsAtMost('executeRuling', 102e3, () => court.executeRuling(disputeId))
      })
    })

    describe('settlePenalties', () => {
      let disputeId, roundId = 0

      beforeEach('create dispute, draft and vote', async () => {
        const draftTermId = 2
        disputeId = await courtHelper.dispute({ draftTermId, disputer })

        // draft, court is already at term previous to dispute start
        await courtHelper.passTerms(bn(1))
        const draftedJurors = await courtHelper.draft({ disputeId, drafter })

        // commit and reveal votes
        await courtHelper.commit({ disputeId, roundId, voters: draftedJurors })
        await courtHelper.reveal({ disputeId, roundId, voters: draftedJurors })
        await courtHelper.passTerms(courtHelper.appealTerms)
      })

      context('when the current term is up-to-date', () => {
        beforeEach('assert needed transitions', async () => {
          const neededTransitions = await controller.getNeededTermTransitions()
          assertBn(neededTransitions, 0, 'needed transitions does not match')
        })

        itCostsAtMost('settlePenalties', 213e3, () => court.settlePenalties(disputeId, roundId, 0))
      })

      context('when the current term is outdated by one term', () => {
        beforeEach('assert needed transitions', async () => {
          await courtHelper.increaseTimeInTerms(1)
          const neededTransitions = await controller.getNeededTermTransitions()
          assertBn(neededTransitions, 1, 'needed transitions does not match')
        })

        itCostsAtMost('settlePenalties', 243e3, () => court.settlePenalties(disputeId, roundId, 0))
      })
    })

    describe('settleReward', () => {
      let disputeId, roundId = 0, draftedJurors

      beforeEach('create dispute, draft and vote', async () => {
        const draftTermId = 2
        disputeId = await courtHelper.dispute({ draftTermId, disputer })

        // draft, court is already at term previous to dispute start
        await courtHelper.passTerms(bn(1))
        draftedJurors = await courtHelper.draft({ disputeId, drafter })

        // vote and settle penalties
        draftedJurors = draftedJurors.map(juror => ({ ...juror, outcome: OUTCOMES.LOW }))
        await courtHelper.commit({ disputeId, roundId, voters: draftedJurors })
        await courtHelper.reveal({ disputeId, roundId, voters: draftedJurors })
        await courtHelper.passTerms(courtHelper.appealTerms)
        await court.settlePenalties(disputeId, roundId, 0)
      })

      context('when the current term is up-to-date', () => {
        beforeEach('assert needed transitions', async () => {
          const neededTransitions = await controller.getNeededTermTransitions()
          assertBn(neededTransitions, 0, 'needed transitions does not match')
        })

        itCostsAtMost('settleReward', 84e3, () => court.settleReward(disputeId, roundId, draftedJurors[0].address))
      })

      context('when the current term is outdated by one term', () => {
        beforeEach('assert needed transitions', async () => {
          await courtHelper.increaseTimeInTerms(1)
          const neededTransitions = await controller.getNeededTermTransitions()
          assertBn(neededTransitions, 1, 'needed transitions does not match')
        })

        itCostsAtMost('settleReward', 84e3, () => court.settleReward(disputeId, roundId, draftedJurors[0].address))
      })
    })

    describe('settleAppealDeposit', () => {
      let disputeId, roundId = 0

      beforeEach('create dispute, draft and vote', async () => {
        const draftTermId = 2
        disputeId = await courtHelper.dispute({ draftTermId, disputer })

        // draft, court is already at term previous to dispute start
        await courtHelper.passTerms(bn(1))
        const draftedJurors = await courtHelper.draft({ disputeId, drafter })

        // vote and appeal first round
        await courtHelper.commit({ disputeId, roundId, voters: draftedJurors })
        await courtHelper.reveal({ disputeId, roundId, voters: draftedJurors })
        await courtHelper.appeal({ disputeId, roundId, appealMaker })
        await courtHelper.confirmAppeal({ disputeId, roundId, appealTaker })

        // vote on second round
        const newRoundId = roundId + 1
        const newDraftedJurors = await courtHelper.draft({ disputeId, drafter })
        await courtHelper.commit({ disputeId, roundId: newRoundId, voters: newDraftedJurors })
        await courtHelper.reveal({ disputeId, roundId: newRoundId, voters: newDraftedJurors })
        await courtHelper.passTerms(courtHelper.appealTerms.add(courtHelper.appealConfirmTerms))

        // settle first round penalties
        await court.settlePenalties(disputeId, roundId, 0)
      })

      context('when the current term is up-to-date', () => {
        beforeEach('assert needed transitions', async () => {
          const neededTransitions = await controller.getNeededTermTransitions()
          assertBn(neededTransitions, 0, 'needed transitions does not match')
        })

        itCostsAtMost('settleAppealDeposit', 80e3, () => court.settleAppealDeposit(disputeId, roundId))
      })

      context('when the current term is outdated by one term', () => {
        beforeEach('assert needed transitions', async () => {
          await courtHelper.increaseTimeInTerms(1)
          const neededTransitions = await controller.getNeededTermTransitions()
          assertBn(neededTransitions, 1, 'needed transitions does not match')
        })

        itCostsAtMost('settleAppealDeposit', 80e3, () => court.settleAppealDeposit(disputeId, roundId))
      })
    })
  })

  after('print gas costs', () => {
    const parsedCosts = Object.keys(costs).map(method => [method].concat(costs[method]))
    printTable('Court gas costs', [['Function', 'Without heartbeat', 'With heartbeat'], ...parsedCosts])
  })
})
