const { bigExp } = require('../helpers/numbers')(web3)
const { buildHelper } = require('../helpers/court')(web3, artifacts)
const { assertRevert } = require('@aragon/os/test/helpers/assertThrow')
const { assertAmountOfEvents, assertEvent } = require('@aragon/os/test/helpers/assertEvent')(web3)

const MiniMeToken = artifacts.require('MiniMeToken')

const ONE_DAY = 60 * 60 * 24
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const EMPTY_RANDOMNESS = '0x0000000000000000000000000000000000000000000000000000000000000000'

contract('Court', ([_, sender]) => {
  let courtHelper, court, feeToken

  const TERM_DURATION = ONE_DAY
  const FIRST_TERM_START_TIME = 1565724237 // random timestamp
  const HEARTBEAT_FEE = bigExp(50, 18)     // 50 fee tokens

  beforeEach('create court', async () => {
    courtHelper = buildHelper()
    feeToken = await MiniMeToken.new(ZERO_ADDRESS, ZERO_ADDRESS, 0, 'Court Fee Token', 18, 'CFT', true)
    court = await courtHelper.deploy({
      firstTermStartTime: FIRST_TERM_START_TIME,
      termDuration: ONE_DAY,
      feeToken: feeToken,
      heartbeatFee: HEARTBEAT_FEE,
    })
  })

  beforeEach('mock timestamp to first term start time', async () => {
    await courtHelper.setTimestamp(FIRST_TERM_START_TIME)
  })

  describe('first term', () => {
    it('the must have already started', async () => {
      const [startTime, dependingDrafts, courtConfigId, randomnessBN, randomness] = await court.getTerm(0)

      assert.equal(startTime.toString(), FIRST_TERM_START_TIME - TERM_DURATION, 'first term start time does not match')
      assert.equal(dependingDrafts.toString(), 0, 'first term should not have depending drafts initially')
      assert.equal(courtConfigId.toString(), 1, 'first term config should not be set')
      assert.equal(randomnessBN.toString(), 0, 'first term randomness block number should not be computed')
      assert.equal(randomness, EMPTY_RANDOMNESS, 'first term randomness should not be computed')
    })

    it('requires only one transition', async () => {
      assert.equal((await court.neededTermTransitions()).toString(), 1, 'needed term transitions does not match')
    })

    it.skip('cannot be set before current timestamp', async () => {
      // TODO: we cannot test this currently since timestamps cannot be mocked during initialization currently
    })
  })

  describe('heartbeat', () => {
    const itUpdatesTermsSuccessfully = (maxTransitionTerms, expectedTransitions) => {
      it('updates the term id', async () => {
        const lastEnsuredTermId = await court.getLastEnsuredTermId()

        const receipt = await court.heartbeat(maxTransitionTerms, { from: sender })

        assertAmountOfEvents(receipt, 'NewTerm', expectedTransitions)

        for (let transition = 1; transition <= expectedTransitions; transition++) {
          assertEvent(receipt, 'NewTerm', { termId: lastEnsuredTermId.plus(transition), heartbeatSender: sender }, transition - 1)
        }
      })

      it('initializes a new term', async () => {
        const lastEnsuredTermId = await court.getLastEnsuredTermId()
        const currentBlockNumber = await court.getBlockNumberExt()

        await court.heartbeat(maxTransitionTerms, { from: sender })

        for (let transition = 1; transition <= expectedTransitions; transition++) {
          const termId = lastEnsuredTermId.plus(transition)
          const [startTime, dependingDrafts, courtConfigId, randomnessBN, randomness] = await court.getTerm(termId)

          assert.equal(startTime.toString(), FIRST_TERM_START_TIME + (TERM_DURATION * (transition - 1)), `start time for term ${termId} does not match`)
          assert.equal(dependingDrafts.toString(), 0, `term ${termId} should not have depending drafts initially`)
          assert.equal(courtConfigId.toString(), 1, `term ${termId} should be using the previous config`)
          assert.equal(randomnessBN.toString(), currentBlockNumber.plus(1).toString(), `randomness block number for term ${termId} should be the next block number`)
          assert.equal(randomness, EMPTY_RANDOMNESS, `randomness for term ${termId} should not be computed`)
        }
      })
    }

    context('when no time has passed after creation', () => {
      it('requires only one transition', async () => {
        assert.equal((await court.neededTermTransitions()).toString(), 1, 'needed term transitions does not match')
      })

      context('when the max transition terms given is zero', () => {
        const maxTransitionTerms = 0

        it('reverts', async () => {
          await assertRevert(court.heartbeat(maxTransitionTerms, { from: sender }), 'CT_INVALID_TRANSITION_TERMS')
        })
      })

      context('when the max transition terms given is one', () => {
        const maxTransitionTerms = 1
        const expectedTransitions = 1

        itUpdatesTermsSuccessfully(maxTransitionTerms, expectedTransitions)
      })

      context('when the max transition terms given is two', () => {
        const maxTransitionTerms = 2
        const expectedTransitions = 1

        itUpdatesTermsSuccessfully(maxTransitionTerms, expectedTransitions)
      })
    })

    context('when it has passed one term after creation', () => {
      beforeEach('increase timestamp one term', async () => {
        await courtHelper.increaseTime(TERM_DURATION)
      })

      it('requires two transition', async () => {
        assert.equal((await court.neededTermTransitions()).toString(), 2, 'needed term transitions does not match')
      })

      context('when the max transition terms given is zero', () => {
        const maxTransitionTerms = 0

        it('reverts', async () => {
          await assertRevert(court.heartbeat(maxTransitionTerms, { from: sender }), 'CT_INVALID_TRANSITION_TERMS')
        })
      })

      context('when the max transition terms given is one', () => {
        const maxTransitionTerms = 1
        const expectedTransitions = 1

        itUpdatesTermsSuccessfully(maxTransitionTerms, expectedTransitions)
      })

      context('when the max transition terms given is two', () => {
        const maxTransitionTerms = 2
        const expectedTransitions = 2

        itUpdatesTermsSuccessfully(maxTransitionTerms, expectedTransitions)
      })

      context('when the max transition terms given is three', () => {
        const maxTransitionTerms = 3
        const expectedTransitions = 2

        itUpdatesTermsSuccessfully(maxTransitionTerms, expectedTransitions)
      })
    })

    context('when it has passed two terms after creation', () => {
      beforeEach('increase timestamp two terms', async () => {
        await courtHelper.increaseTime(TERM_DURATION * 2)
      })

      it('requires three transition', async () => {
        assert.equal((await court.neededTermTransitions()).toString(), 3, 'needed term transitions does not match')
      })

      context('when the max transition terms given is zero', () => {
        const maxTransitionTerms = 0

        it('reverts', async () => {
          await assertRevert(court.heartbeat(maxTransitionTerms, { from: sender }), 'CT_INVALID_TRANSITION_TERMS')
        })
      })

      context('when the max transition terms given is one', () => {
        const maxTransitionTerms = 1
        const expectedTransitions = 1

        itUpdatesTermsSuccessfully(maxTransitionTerms, expectedTransitions)
      })

      context('when the max transition terms given is two', () => {
        const maxTransitionTerms = 2
        const expectedTransitions = 2

        itUpdatesTermsSuccessfully(maxTransitionTerms, expectedTransitions)
      })

      context('when the max transition terms given is three', () => {
        const maxTransitionTerms = 3
        const expectedTransitions = 3

        itUpdatesTermsSuccessfully(maxTransitionTerms, expectedTransitions)
      })
    })
  })
})