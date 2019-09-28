const { bn } = require('../helpers/numbers')
const { buildHelper } = require('../helpers/court')(web3, artifacts)
const { NOW, ONE_DAY } = require('../helpers/time')
const { assertRevert } = require('../helpers/assertThrow')

contract('Court (initialization)', () => {
  let courtHelper

  beforeEach('create court helper', async () => {
    courtHelper = buildHelper()
  })

  it('cannot use a term duration greater than the first term start time', async () => {
    await assertRevert(courtHelper.deploy({ mockedTimestamp: NOW, firstTermStartTime: ONE_DAY, termDuration: ONE_DAY + 1 }), 'CT_BAD_FIRST_TERM_START_TIME')
  })

  it('cannot use a first term start time in the past', async () => {
    await assertRevert(courtHelper.deploy({ mockedTimestamp: NOW, firstTermStartTime: NOW - 1, termDuration: ONE_DAY }), 'CT_BAD_FIRST_TERM_START_TIME')
  })

  context('penalty pct (1/10,000)', () => {
    it('cannot be above 100%', async () => {
      await assertRevert(courtHelper.deploy({ penaltyPct: bn(10001) }), 'CT_INVALID_PENALTY_PCT')
    })

    it('can be 0%', async () => {
      const court = await courtHelper.deploy({ penaltyPct: bn(0) })
      const termId = await court.getLastEnsuredTermId()
      const { penaltyPct } = await courtHelper.getCourtConfig(termId)
      assert.equal(penaltyPct.toString(), 0, 'penalty pct does not match')
    })

    it('can be 100%', async () => {
      const court = await courtHelper.deploy({ penaltyPct: bn(10000) })
      const termId = await court.getLastEnsuredTermId()
      const { penaltyPct } = await courtHelper.getCourtConfig(termId)
      assert.equal(penaltyPct.toString(), 10000, 'penalty pct does not match')
    })
  })
})
