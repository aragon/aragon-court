const { assertBn } = require('../helpers/asserts/assertBn')
const { assertRevert } = require('../helpers/asserts/assertThrow')
const { DISPUTE_MANAGER_ERRORS } = require('../helpers/utils/errors')
const { buildHelper, DISPUTE_STATES } = require('../helpers/wrappers/court')(web3, artifacts)

contract('DisputeManager', () => {
  let courtHelper, disputeManager

  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

  const setup = skippedDisputes => {
    beforeEach('setup court', async () => {
      courtHelper = buildHelper()
      await courtHelper.deploy({ skippedDisputes })
      disputeManager = courtHelper.disputeManager
    })
  }

  const itSkipsTheNumberOfRequestedDisputes = skippedDisputes => {
    let disputeId

    beforeEach('create first dispute', async () => {
      disputeId = await courtHelper.dispute()
    })

    it('skips the number of requested rounds', async () => {
      assertBn(disputeId, skippedDisputes, 'dispute ID does not match')
    })

    it('ignores the previous disputes', async () => {
      const { subject, possibleRulings: rulings, state, finalRuling, createTermId } = await courtHelper.getDispute(0)

      assert.equal(subject, ZERO_ADDRESS, 'dispute subject does not match')
      assertBn(state, DISPUTE_STATES.PRE_DRAFT, 'dispute state does not match')
      assertBn(rulings, 0, 'dispute possible rulings do not match')
      assertBn(finalRuling, 0, 'dispute final ruling does not match')
      assertBn(createTermId, 0, 'dispute create term ID does not match')
    })

    it('does not create rounds for the skipped disputes', async () => {
      for (let id = 0; id < disputeId; id++) {
        await assertRevert(disputeManager.getRound(id, 0), DISPUTE_MANAGER_ERRORS.ROUND_DOES_NOT_EXIST)
      }
    })
  }

  context('when skipping one dispute', () => {
    const skippedDisputes = 1
    setup(skippedDisputes)
    itSkipsTheNumberOfRequestedDisputes(skippedDisputes)
  })

  context('when skipping many disputes', () => {
    const skippedDisputes = 10
    setup(skippedDisputes)
    itSkipsTheNumberOfRequestedDisputes(skippedDisputes)
  })
})
