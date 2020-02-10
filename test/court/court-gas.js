const { bigExp } = require('../helpers/lib/numbers')
const { assertBn } = require('../helpers/asserts/assertBn')
const { printTable } = require('../helpers/lib/logging')
const { buildHelper } = require('../helpers/wrappers/court')(web3, artifacts)
const { getVoteId, hashVote, oppositeOutcome, SALT, OUTCOMES } = require('../helpers/utils/crvoting')

const Arbitrable = artifacts.require('ArbitrableMock')

contract('AragonCourt', ([_, sender, drafter, appealMaker, appealTaker, juror500, juror1000, juror1500, juror2000, juror2500, juror3000]) => {
  let courtHelper, disputeManager, voting, court, costs = {}

  const jurors = [
    { address: juror500,  initialActiveBalance: bigExp(500,  18) },
    { address: juror1000, initialActiveBalance: bigExp(1000, 18) },
    { address: juror1500, initialActiveBalance: bigExp(1500, 18) },
    { address: juror2000, initialActiveBalance: bigExp(2000, 18) },
    { address: juror2500, initialActiveBalance: bigExp(2500, 18) },
    { address: juror3000, initialActiveBalance: bigExp(3000, 18) }
  ]

  before('create court and activate jurors', async () => {
    courtHelper = buildHelper()
    court = await courtHelper.deploy()
    voting = courtHelper.voting
    disputeManager = courtHelper.disputeManager
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
        arbitrable = await Arbitrable.new(court.address)
        await courtHelper.subscriptions.mockUpToDate(true)
        const { disputeFees } = await courtHelper.getDisputeFees()
        await courtHelper.mintFeeTokens(arbitrable.address, disputeFees)
      })

      context('when the current term is up-to-date', () => {
        beforeEach('assert needed transitions', async () => {
          const neededTransitions = await court.getNeededTermTransitions()
          assertBn(neededTransitions, 0, 'needed transitions does not match')
        })

        itCostsAtMost('createDispute', 297e3, () => arbitrable.createDispute(2, '0x', { from: sender }))
      })

      context('when the current term is outdated by one term', () => {
        beforeEach('assert needed transitions', async () => {
          await courtHelper.increaseTimeInTerms(1)
          const neededTransitions = await court.getNeededTermTransitions()
          assertBn(neededTransitions, 1, 'needed transitions does not match')
        })

        itCostsAtMost('createDispute', 329e3, () => arbitrable.createDispute(2, '0x', { from: sender }))
      })
    })

    describe('draft', () => {
      let disputeId

      beforeEach('create dispute and advance to the draft term', async () => {
        disputeId = await courtHelper.dispute()

        // Mock term randomness to make sure we always have the same output for the draft, otherwise this test won't be deterministic
        await courtHelper.passRealTerms(1)
        await court.mockSetTermRandomness('0x0000000000000000000000000000000000000000000000000000000000000001')
      })

      itCostsAtMost('draft', 391e3, () => disputeManager.draft(disputeId))
    })

    describe('commit', () => {
      let voteId, draftedJurors

      const vote = hashVote(OUTCOMES.LOW)

      beforeEach('create dispute and draft', async () => {
        const roundId = 0
        const disputeId = await courtHelper.dispute()
        voteId = getVoteId(disputeId, roundId)
        draftedJurors = await courtHelper.draft({ disputeId, drafter })
      })

      context('when the current term is up-to-date', () => {
        beforeEach('assert needed transitions', async () => {
          const neededTransitions = await court.getNeededTermTransitions()
          assertBn(neededTransitions, 0, 'needed transitions does not match')
        })

        itCostsAtMost('commit', 108e3, () => voting.commit(voteId, vote, { from: draftedJurors[0].address }))
      })

      context('when the current term is outdated by one term', () => {
        beforeEach('assert needed transitions', async () => {
          await courtHelper.increaseTimeInTerms(1)
          const neededTransitions = await court.getNeededTermTransitions()
          assertBn(neededTransitions, 1, 'needed transitions does not match')
        })

        itCostsAtMost('commit', 169e3, () => voting.commit(voteId, vote, { from: draftedJurors[0].address }))
      })
    })

    describe('reveal', () => {
      let voteId, draftedJurors

      const outcome = OUTCOMES.LOW

      beforeEach('create dispute, draft and vote', async () => {
        const roundId = 0
        const disputeId = await courtHelper.dispute()
        voteId = getVoteId(disputeId, roundId)

        // draft and commit
        draftedJurors = await courtHelper.draft({ disputeId, drafter })
        await courtHelper.commit({ disputeId, roundId, voters: draftedJurors })
      })

      context('when the current term is up-to-date', () => {
        beforeEach('assert needed transitions', async () => {
          const neededTransitions = await court.getNeededTermTransitions()
          assertBn(neededTransitions, 0, 'needed transitions does not match')
        })

        itCostsAtMost('reveal', 138e3, () => voting.reveal(voteId, draftedJurors[0].address, outcome, SALT))
      })

      context('when the current term is outdated by one term', () => {
        beforeEach('assert needed transitions', async () => {
          await courtHelper.increaseTimeInTerms(1)
          const neededTransitions = await court.getNeededTermTransitions()
          assertBn(neededTransitions, 1, 'needed transitions does not match')
        })

        itCostsAtMost('reveal', 198e3, () => voting.reveal(voteId, draftedJurors[0].address, outcome, SALT))
      })
    })

    describe('createAppeal', () => {
      let disputeId, roundId = 0, appealMakerRuling

      beforeEach('create dispute, draft and vote', async () => {
        disputeId = await courtHelper.dispute()
        const voteId = getVoteId(disputeId, roundId)

        // draft, commit, and reveal votes
        const draftedJurors = await courtHelper.draft({ disputeId, drafter })
        await courtHelper.commit({ disputeId, roundId, voters: draftedJurors })
        await courtHelper.reveal({ disputeId, roundId, voters: draftedJurors })

        // compute appeal ruling
        const winningRuling = await voting.getWinningOutcome(voteId)
        appealMakerRuling = oppositeOutcome(winningRuling)

        // mint appeal fees
        const { appealDeposit } = await courtHelper.getAppealFees(disputeId, roundId)
        await courtHelper.mintAndApproveFeeTokens(appealMaker, disputeManager.address, appealDeposit)
      })

      context('when the current term is up-to-date', () => {
        beforeEach('assert needed transitions', async () => {
          const neededTransitions = await court.getNeededTermTransitions()
          assertBn(neededTransitions, 0, 'needed transitions does not match')
        })

        itCostsAtMost('createAppeal', 114e3, () => disputeManager.createAppeal(disputeId, roundId, appealMakerRuling, { from: appealMaker }))
      })

      context('when the current term is outdated by one term', () => {
        beforeEach('assert needed transitions', async () => {
          await courtHelper.increaseTimeInTerms(1)
          const neededTransitions = await court.getNeededTermTransitions()
          assertBn(neededTransitions, 1, 'needed transitions does not match')
        })

        itCostsAtMost('createAppeal', 174e3, () => disputeManager.createAppeal(disputeId, roundId, appealMakerRuling, { from: appealMaker }))
      })
    })

    describe('confirmAppeal', () => {
      let disputeId, roundId = 0, appealTakerRuling

      beforeEach('create dispute, draft, vote and appeal', async () => {
        disputeId = await courtHelper.dispute()

        // draft, vote and appeal
        const draftedJurors = await courtHelper.draft({ disputeId, drafter })
        await courtHelper.commit({ disputeId, roundId, voters: draftedJurors })
        await courtHelper.reveal({ disputeId, roundId, voters: draftedJurors })
        await courtHelper.appeal({ disputeId, roundId, appealMaker })

        // compute appeal confirmation ruling
        const { appealedRuling } = await courtHelper.getAppeal(disputeId, roundId)
        appealTakerRuling = oppositeOutcome(appealedRuling)

        // mint appeal confirmation fees
        const { confirmAppealDeposit } = await courtHelper.getAppealFees(disputeId, roundId)
        await courtHelper.mintAndApproveFeeTokens(appealTaker, disputeManager.address, confirmAppealDeposit)
      })

      context('when the current term is up-to-date', () => {
        beforeEach('assert needed transitions', async () => {
          const neededTransitions = await court.getNeededTermTransitions()
          assertBn(neededTransitions, 0, 'needed transitions does not match')
        })

        itCostsAtMost('confirmAppeal', 202e3, () => disputeManager.confirmAppeal(disputeId, roundId, appealTakerRuling, { from: appealTaker }))
      })

      context('when the current term is outdated by one term', () => {
        beforeEach('assert needed transitions', async () => {
          await courtHelper.increaseTimeInTerms(1)
          const neededTransitions = await court.getNeededTermTransitions()
          assertBn(neededTransitions, 1, 'needed transitions does not match')
        })

        itCostsAtMost('confirmAppeal', 263e3, () => disputeManager.confirmAppeal(disputeId, roundId, appealTakerRuling, { from: appealTaker }))
      })
    })

    describe('executeRuling', () => {
      let disputeId

      beforeEach('create dispute, draft and vote', async () => {
        const roundId = 0
        disputeId = await courtHelper.dispute()

        // draft, commit, and reveal votes
        const draftedJurors = await courtHelper.draft({ disputeId, drafter })
        await courtHelper.commit({ disputeId, roundId, voters: draftedJurors })
        await courtHelper.reveal({ disputeId, roundId, voters: draftedJurors })
        await courtHelper.passTerms(courtHelper.appealTerms)
      })

      context('when the current term is up-to-date', () => {
        beforeEach('assert needed transitions', async () => {
          const neededTransitions = await court.getNeededTermTransitions()
          assertBn(neededTransitions, 0, 'needed transitions does not match')
        })

        itCostsAtMost('executeRuling', 100e3, () => court.executeRuling(disputeId))
      })

      context('when the current term is outdated by one term', () => {
        beforeEach('assert needed transitions', async () => {
          await courtHelper.increaseTimeInTerms(1)
          const neededTransitions = await court.getNeededTermTransitions()
          assertBn(neededTransitions, 1, 'needed transitions does not match')
        })

        itCostsAtMost('executeRuling', 160e3, () => court.executeRuling(disputeId))
      })
    })

    describe('settlePenalties', () => {
      let disputeId, roundId = 0

      beforeEach('create dispute, draft and vote', async () => {
        disputeId = await courtHelper.dispute()

        // Mock term randomness to make sure we always have the same output for the draft, otherwise this test won't be deterministic
        await court.mockSetTermRandomness('0x0000000000000000000000000000000000000000000000000000000000000001')

        // draft, commit and reveal votes
        const draftedJurors = await courtHelper.draft({ disputeId, drafter })
        await courtHelper.commit({ disputeId, roundId, voters: draftedJurors })
        await courtHelper.reveal({ disputeId, roundId, voters: draftedJurors })
        await courtHelper.passTerms(courtHelper.appealTerms)
      })

      context('when the current term is up-to-date', () => {
        beforeEach('assert needed transitions', async () => {
          const neededTransitions = await court.getNeededTermTransitions()
          assertBn(neededTransitions, 0, 'needed transitions does not match')
        })

        itCostsAtMost('settlePenalties', 299e3, () => disputeManager.settlePenalties(disputeId, roundId, 0))
      })

      context('when the current term is outdated by one term', () => {
        beforeEach('assert needed transitions', async () => {
          await courtHelper.increaseTimeInTerms(1)
          const neededTransitions = await court.getNeededTermTransitions()
          assertBn(neededTransitions, 1, 'needed transitions does not match')
        })

        itCostsAtMost('settlePenalties', 346e3, () => disputeManager.settlePenalties(disputeId, roundId, 0))
      })
    })

    describe('settleReward', () => {
      let disputeId, roundId = 0, draftedJurors

      beforeEach('create dispute, draft and vote', async () => {
        disputeId = await courtHelper.dispute()

        // draft, vote and settle penalties
        draftedJurors = await courtHelper.draft({ disputeId, drafter })
        draftedJurors = draftedJurors.map(juror => ({ ...juror, outcome: OUTCOMES.LOW }))
        await courtHelper.commit({ disputeId, roundId, voters: draftedJurors })
        await courtHelper.reveal({ disputeId, roundId, voters: draftedJurors })
        await courtHelper.passTerms(courtHelper.appealTerms)
        await disputeManager.settlePenalties(disputeId, roundId, 0)
      })

      context('when the current term is up-to-date', () => {
        beforeEach('assert needed transitions', async () => {
          const neededTransitions = await court.getNeededTermTransitions()
          assertBn(neededTransitions, 0, 'needed transitions does not match')
        })

        itCostsAtMost('settleReward', 116e3, () => disputeManager.settleReward(disputeId, roundId, draftedJurors[0].address))
      })

      context('when the current term is outdated by one term', () => {
        beforeEach('assert needed transitions', async () => {
          await courtHelper.increaseTimeInTerms(1)
          const neededTransitions = await court.getNeededTermTransitions()
          assertBn(neededTransitions, 1, 'needed transitions does not match')
        })

        itCostsAtMost('settleReward', 116e3, () => disputeManager.settleReward(disputeId, roundId, draftedJurors[0].address))
      })
    })

    describe('settleAppealDeposit', () => {
      let disputeId, roundId = 0

      beforeEach('create dispute, draft and vote', async () => {
        disputeId = await courtHelper.dispute()

        // draft, vote and appeal first round
        const draftedJurors = await courtHelper.draft({ disputeId, drafter })
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
        await disputeManager.settlePenalties(disputeId, roundId, 0)
      })

      context('when the current term is up-to-date', () => {
        beforeEach('assert needed transitions', async () => {
          const neededTransitions = await court.getNeededTermTransitions()
          assertBn(neededTransitions, 0, 'needed transitions does not match')
        })

        itCostsAtMost('settleAppealDeposit', 109e3, () => disputeManager.settleAppealDeposit(disputeId, roundId))
      })

      context('when the current term is outdated by one term', () => {
        beforeEach('assert needed transitions', async () => {
          await courtHelper.increaseTimeInTerms(1)
          const neededTransitions = await court.getNeededTermTransitions()
          assertBn(neededTransitions, 1, 'needed transitions does not match')
        })

        itCostsAtMost('settleAppealDeposit', 109e3, () => disputeManager.settleAppealDeposit(disputeId, roundId))
      })
    })
  })

  after('print gas costs', () => {
    const parsedCosts = Object.keys(costs).map(method => [method].concat(costs[method]))
    printTable('Court gas costs', [['Function', 'Without heartbeat', 'With heartbeat'], ...parsedCosts])
  })
})
