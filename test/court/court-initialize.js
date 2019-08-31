const { buildHelper } = require('../helpers/court')(web3, artifacts)
const { NOW, ONE_DAY } = require('../helpers/time')
const { assertRevert } = require('@aragon/os/test/helpers/assertThrow')

contract('Court', () => {
  let courtHelper

  beforeEach('create court helper', async () => {
    courtHelper = buildHelper()
  })

  describe('initialization', () => {
    it('cannot use a term duration greater than the first term start time', async () => {
      await assertRevert(courtHelper.deploy({ mockedTimestamp: NOW, firstTermStartTime: ONE_DAY, termDuration: ONE_DAY + 1 }), 'CT_BAD_FIRST_TERM_START_TIME')
    })

    it('cannot use a first term start time in the past', async () => {
      await assertRevert(courtHelper.deploy({ mockedTimestamp: NOW, firstTermStartTime: NOW - 1, termDuration: ONE_DAY }), 'CT_BAD_FIRST_TERM_START_TIME')
    })

    it('cannot use a penalty pct lower than 1% (1/10,000) ', async () => {
      await assertRevert(courtHelper.deploy({ penaltyPct: 99, jurorsMinActiveBalance: 100 }), 'CT_INVALID_PENALTY_PCT')

      const court = await courtHelper.deploy({ penaltyPct: 100, jurorsMinActiveBalance: 100 })
      const penaltyPct = (await court.courtConfigs(1))[9] // config ID 0 is used for undefined
      assert.equal(penaltyPct.toString(), 100, 'penalty pct does not match')
    })
  })
})
