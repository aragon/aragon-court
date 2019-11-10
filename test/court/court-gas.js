const { assertBn } = require('../helpers/asserts/assertBn')
const { bn, bigExp } = require('../helpers/lib/numbers')
const { printTable } = require('../helpers/lib/logging')
const { buildHelper } = require('../helpers/wrappers/court')(web3, artifacts)
const { getVoteId, encryptVote, oppositeOutcome, SALT, OUTCOMES } = require('../helpers/utils/crvoting')

const Arbitrable = artifacts.require('ArbitrableMock')

contract('Court', ([_, sender, drafter, appealMaker, appealTaker, juror500, juror1000, juror1500, juror2000, juror2500, juror3000]) => {
  let courtHelper, court, voting, controller, costs = {}

  const jurors = [
    { address: juror500,  initialActiveBalance: bigExp(500,  18) },
    { address: juror1000, initialActiveBalance: bigExp(1000, 18) },
    { address: juror1500, initialActiveBalance: bigExp(1500, 18) },
    { address: juror2000, initialActiveBalance: bigExp(2000, 18) },
    { address: juror2500, initialActiveBalance: bigExp(2500, 18) },
    { address: juror3000, initialActiveBalance: bigExp(3000, 18) }
  ]

  beforeEach('create court and activate jurors', async () => {
    courtHelper = buildHelper()
    court = await courtHelper.deploy()

    voting = courtHelper.voting
    controller = courtHelper.controller
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
        await courtHelper.setTerm(1)
        arbitrable = await Arbitrable.new(controller.address)
        await courtHelper.subscriptions.mockUpToDate(true)
        const { disputeFees } = await courtHelper.getDisputeFees()
        await courtHelper.mintFeeTokens(arbitrable.address, disputeFees)
      })

      context('when the current term is up-to-date', () => {
        beforeEach('assert needed transitions', async () => {
          const neededTransitions = await controller.getNeededTermTransitions()
          assertBn(neededTransitions, 0, 'needed transitions does not match')
        })

        itCostsAtMost('createDispute', 239e3, () => arbitrable.createDispute(2, '0x', { from: sender }))
      })

      context('when the current term is outdated by one term', () => {
        beforeEach('assert needed transitions', async () => {
          await courtHelper.increaseTimeInTerms(1)
          const neededTransitions = await controller.getNeededTermTransitions()
          assertBn(neededTransitions, 1, 'needed transitions does not match')
        })

        itCostsAtMost('createDispute', 295e3, () => arbitrable.createDispute(2, '0x', { from: sender }))
      })
    })

    describe('draft', () => {
      let disputeId

      beforeEach('create dispute and advance to the draft term', async () => {
        const draftTermId = 2
        disputeId = await courtHelper.dispute({ draftTermId })

        const lastEnsuredTermId = await controller.getLastEnsuredTermId()
        await courtHelper.passRealTerms(draftTermId - lastEnsuredTermId)

        // Mock term randomness to make sure we always have the same output for the draft, otherwise this test won't be deterministic
        await controller.mockSetTermRandomness('0x0000000000000000000000000000000000000000000000000000000000000001')
      })

      itCostsAtMost('draft', 325e3, () => court.draft(disputeId))
    })

    describe('commit', () => {
      let voteId, draftedJurors

      const vote = encryptVote(OUTCOMES.LOW)

      beforeEach('create dispute and draft', async () => {
        const draftTermId = 2, roundId = 0
        const disputeId = await courtHelper.dispute({ draftTermId })
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

        itCostsAtMost('commit', 78e3, () => voting.commit(voteId, vote, { from: draftedJurors[0].address }))
      })

      context('when the current term is outdated by one term', () => {
        beforeEach('assert needed transitions', async () => {
          await courtHelper.increaseTimeInTerms(1)
          const neededTransitions = await controller.getNeededTermTransitions()
          assertBn(neededTransitions, 1, 'needed transitions does not match')
        })

        itCostsAtMost('commit', 135e3, () => voting.commit(voteId, vote, { from: draftedJurors[0].address }))
      })
    })

    describe('reveal', () => {
      let voteId, draftedJurors

      const outcome = OUTCOMES.LOW

      beforeEach('create dispute, draft and vote', async () => {
        const draftTermId = 2, roundId = 0
        const disputeId = await courtHelper.dispute({ draftTermId })
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

        itCostsAtMost('reveal', 104e3, () => voting.reveal(voteId, outcome, SALT, { from: draftedJurors[0].address }))
      })

      context('when the current term is outdated by one term', () => {
        beforeEach('assert needed transitions', async () => {
          await courtHelper.increaseTimeInTerms(1)
          const neededTransitions = await controller.getNeededTermTransitions()
          assertBn(neededTransitions, 1, 'needed transitions does not match')
        })

        itCostsAtMost('reveal', 160e3, () => voting.reveal(voteId, outcome, SALT, { from: draftedJurors[0].address }))
      })
    })

    describe('createAppeal', () => {
      let disputeId, roundId = 0, appealMakerRuling

      beforeEach('create dispute, draft and vote', async () => {
        const draftTermId = 2
        disputeId = await courtHelper.dispute({ draftTermId })
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

        itCostsAtMost('createAppeal', 74e3, () => court.createAppeal(disputeId, roundId, appealMakerRuling, { from: appealMaker }))
      })

      context('when the current term is outdated by one term', () => {
        beforeEach('assert needed transitions', async () => {
          await courtHelper.increaseTimeInTerms(1)
          const neededTransitions = await controller.getNeededTermTransitions()
          assertBn(neededTransitions, 1, 'needed transitions does not match')
        })

        itCostsAtMost('createAppeal', 130e3, () => court.createAppeal(disputeId, roundId, appealMakerRuling, { from: appealMaker }))
      })
    })

    describe('confirmAppeal', () => {
      let disputeId, roundId = 0, appealTakerRuling

      beforeEach('create dispute, draft, vote and appeal', async () => {
        const draftTermId = 2
        disputeId = await courtHelper.dispute({ draftTermId })

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

        itCostsAtMost('confirmAppeal', 159e3, () => court.confirmAppeal(disputeId, roundId, appealTakerRuling, { from: appealTaker }))
      })

      context('when the current term is outdated by one term', () => {
        beforeEach('assert needed transitions', async () => {
          await courtHelper.increaseTimeInTerms(1)
          const neededTransitions = await controller.getNeededTermTransitions()
          assertBn(neededTransitions, 1, 'needed transitions does not match')
        })

        itCostsAtMost('confirmAppeal', 215e3, () => court.confirmAppeal(disputeId, roundId, appealTakerRuling, { from: appealTaker }))
      })
    })

    describe('executeRuling', () => {
      let disputeId

      beforeEach('create dispute, draft and vote', async () => {
        const draftTermId = 2, roundId = 0
        disputeId = await courtHelper.dispute({ draftTermId })

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

        itCostsAtMost('executeRuling', 70e3, () => controller.executeRuling(disputeId))
      })

      context('when the current term is outdated by one term', () => {
        beforeEach('assert needed transitions', async () => {
          await courtHelper.increaseTimeInTerms(1)
          const neededTransitions = await controller.getNeededTermTransitions()
          assertBn(neededTransitions, 1, 'needed transitions does not match')
        })

        itCostsAtMost('executeRuling', 126e3, () => controller.executeRuling(disputeId))
      })
    })

    describe('settlePenalties', () => {
      let disputeId, roundId = 0

      beforeEach('create dispute, draft and vote', async () => {
        const draftTermId = 2
        disputeId = await courtHelper.dispute({ draftTermId })

        // Mock term randomness to make sure we always have the same output for the draft, otherwise this test won't be deterministic
        await controller.mockSetTermRandomness('0x0000000000000000000000000000000000000000000000000000000000000001')

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

        itCostsAtMost('settlePenalties', 197e3, () => court.settlePenalties(disputeId, roundId, 0))
      })

      context('when the current term is outdated by one term', () => {
        beforeEach('assert needed transitions', async () => {
          await courtHelper.increaseTimeInTerms(1)
          const neededTransitions = await controller.getNeededTermTransitions()
          assertBn(neededTransitions, 1, 'needed transitions does not match')
        })

        itCostsAtMost('settlePenalties', 254e3, () => court.settlePenalties(disputeId, roundId, 0))
      })
    })

    describe('settleReward', () => {
      let disputeId, roundId = 0, draftedJurors

      beforeEach('create dispute, draft and vote', async () => {
        const draftTermId = 2
        disputeId = await courtHelper.dispute({ draftTermId })

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

        itCostsAtMost('settleReward', 88e3, () => court.settleReward(disputeId, roundId, draftedJurors[0].address))
      })

      context('when the current term is outdated by one term', () => {
        beforeEach('assert needed transitions', async () => {
          await courtHelper.increaseTimeInTerms(1)
          const neededTransitions = await controller.getNeededTermTransitions()
          assertBn(neededTransitions, 1, 'needed transitions does not match')
        })

        itCostsAtMost('settleReward', 88e3, () => court.settleReward(disputeId, roundId, draftedJurors[0].address))
      })
    })

    describe('settleAppealDeposit', () => {
      let disputeId, roundId = 0

      beforeEach('create dispute, draft and vote', async () => {
        const draftTermId = 2
        disputeId = await courtHelper.dispute({ draftTermId })

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

        itCostsAtMost('settleAppealDeposit', 82e3, () => court.settleAppealDeposit(disputeId, roundId))
      })

      context('when the current term is outdated by one term', () => {
        beforeEach('assert needed transitions', async () => {
          await courtHelper.increaseTimeInTerms(1)
          const neededTransitions = await controller.getNeededTermTransitions()
          assertBn(neededTransitions, 1, 'needed transitions does not match')
        })

        itCostsAtMost('settleAppealDeposit', 82e3, () => court.settleAppealDeposit(disputeId, roundId))
      })
    })
  })

  after('print gas costs', () => {
    const parsedCosts = Object.keys(costs).map(method => [method].concat(costs[method]))
    printTable('Court gas costs', [['Function', 'Without heartbeat', 'With heartbeat'], ...parsedCosts])
  })
})
