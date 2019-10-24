const { bn } = require('../helpers/numbers')
const { buildHelper } = require('../helpers/controller')(web3, artifacts)
const { NOW, ONE_DAY } = require('../helpers/time')
const { assertRevert } = require('../helpers/assertThrow')

contract('Court', () => {
  let controllerHelper

  beforeEach('create controller helper', async () => {
    controllerHelper = buildHelper()
  })

  describe('initialization', () => {
    it('cannot use a term duration greater than the first term start time', async () => {
      await assertRevert(controllerHelper.deploy({ mockedTimestamp: NOW, firstTermStartTime: ONE_DAY, termDuration: ONE_DAY + 1 }), 'CLK_BAD_FIRST_TERM_START_TIME')
    })

    it('cannot use a first term start time in the past', async () => {
      await assertRevert(controllerHelper.deploy({ mockedTimestamp: NOW, firstTermStartTime: NOW - 1, termDuration: ONE_DAY }), 'CLK_BAD_FIRST_TERM_START_TIME')
    })

    context('penalty pct (1/10,000)', () => {
      it('cannot be above 100%', async () => {
        await assertRevert(controllerHelper.deploy({ penaltyPct: bn(10001) }), 'CONF_INVALID_PENALTY_PCT')
      })

      it('can be 0%', async () => {
        await controllerHelper.deploy({ penaltyPct: bn(0) })
        const termId = await controllerHelper.controller.getLastEnsuredTermId()
        const { penaltyPct } = await controllerHelper.getConfig(termId)
        assert.equal(penaltyPct.toString(), 0, 'penalty pct does not match')
      })

      it('can be 100%', async () => {
        await controllerHelper.deploy({ penaltyPct: bn(10000) })
        const termId = await controllerHelper.controller.getLastEnsuredTermId()
        const { penaltyPct } = await controllerHelper.getConfig(termId)
        assert.equal(penaltyPct.toString(), 10000, 'penalty pct does not match')
      })
    })
  })
})
