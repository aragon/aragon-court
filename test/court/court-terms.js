const { bigExp } = require('../helpers/numbers')(web3)
const { buildHelper } = require('../helpers/court')(web3, artifacts)
const { assertRevert } = require('@aragon/os/test/helpers/assertThrow')
const { TOMORROW, NOW, ONE_DAY } = require('../helpers/time')
const { assertAmountOfEvents, assertEvent } = require('@aragon/os/test/helpers/assertEvent')(web3)

const MiniMeToken = artifacts.require('MiniMeToken')

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const EMPTY_RANDOMNESS = '0x0000000000000000000000000000000000000000000000000000000000000000'

contract('Court', ([_, sender]) => {
  let courtHelper, court

  beforeEach('build court helper', async () => {
    courtHelper = buildHelper()
  })

  describe('zero term', () => {
    const termDuration = ONE_DAY

    context('when setting the first term start time in the past', () => {
      const firstTermStartTime = NOW - 1

      it('reverts', async () => {
        await assertRevert(courtHelper.deploy({ firstTermStartTime, termDuration }), 'CT_BAD_FIRST_TERM_START_TIME')
      })
    })

    context('when setting the first term start time to now', () => {
      // TODO: cannot test this scenario properly until we move the court initialization logic to a separate contract
      const firstTermStartTime = TOMORROW // using tomorrow but will set current timestamp to same datetime

      beforeEach('deploy court', async () => {
        court = await courtHelper.deploy({ firstTermStartTime, termDuration })
        await courtHelper.setTimestamp(firstTermStartTime)
      })

      it('it must have already started', async () => {
        const [startTime, dependingDrafts, courtConfigId, randomnessBN, randomness] = await court.getTerm(0)

        assert.equal(startTime.toString(), firstTermStartTime - termDuration, 'term zero start time does not match')
        assert.equal(dependingDrafts.toString(), 0, 'zero term should not have depending drafts initially')
        assert.equal(courtConfigId.toString(), 1, 'zero term config should not be set')
        assert.equal(randomnessBN.toString(), 0, 'zero term randomness block number should not be computed')
        assert.equal(randomness, EMPTY_RANDOMNESS, 'zero term randomness should not be computed')
      })

      it('requires one term transition', async () => {
        assert.equal((await court.neededTermTransitions()).toString(), 1, 'needed term transitions does not match')
      })
    })

    context('when setting the first term start time in the future', () => {
      const firstTermStartTime = TOMORROW

      beforeEach('deploy court', async () => {
        court = await courtHelper.deploy({ firstTermStartTime, termDuration })
      })

      it('it must have already started', async () => {
        const [startTime, dependingDrafts, courtConfigId, randomnessBN, randomness] = await court.getTerm(0)

        assert.equal(startTime.toString(), firstTermStartTime - termDuration, 'term zero start time does not match')
        assert.equal(dependingDrafts.toString(), 0, 'zero term should not have depending drafts initially')
        assert.equal(courtConfigId.toString(), 1, 'zero term config should not be set')
        assert.equal(randomnessBN.toString(), 0, 'zero term randomness block number should not be computed')
        assert.equal(randomness, EMPTY_RANDOMNESS, 'zero term randomness should not be computed')
      })

      it('does not require a term transition', async () => {
        assert.equal((await court.neededTermTransitions()).toString(), 0, 'needed term transitions does not match')
      })
    })
  })

  describe('heartbeat', () => {
    let feeToken
    const termDuration = ONE_DAY
    const heartbeatFee = bigExp(50, 18)
    const firstTermStartTime = TOMORROW
    const zeroTermStartTime = firstTermStartTime - termDuration

    beforeEach('create court starting in one future term', async () => {
      feeToken = await MiniMeToken.new(ZERO_ADDRESS, ZERO_ADDRESS, 0, 'Court Fee Token', 18, 'CFT', true)
      court = await courtHelper.deploy({ firstTermStartTime, termDuration, feeToken, heartbeatFee })
    })

    const itReverts = maxTransitionTerms => {
      it('reverts', async () => {
        await assertRevert(court.heartbeat(maxTransitionTerms, { from: sender }), 'CT_INVALID_TRANSITION_TERMS')
      })
    }

    const itRevertsTryingToTransitionOneTerm = () => {
      context('when the max transition terms given is zero', () => {
        const maxTransitionTerms = 0

        itReverts(maxTransitionTerms)
      })

      context('when the max transition terms given is one', () => {
        const maxTransitionTerms = 1

        itReverts(maxTransitionTerms)
      })
    }

    const itNeedsTermTransitions = neededTransitions => {
      it(`requires ${neededTransitions} term transitions`, async () => {
        assert.equal((await court.neededTermTransitions()).toString(), neededTransitions, 'needed term transitions does not match')
      })
    }

    const itUpdatesTermsSuccessfully = (maxTransitionTerms, expectedTransitions, remainingTransitions) => {
      it('updates the term id', async () => {
        const lastEnsuredTermId = await court.getLastEnsuredTermId()

        const receipt = await court.heartbeat(maxTransitionTerms, { from: sender })

        assertAmountOfEvents(receipt, 'NewTerm', expectedTransitions)

        for (let transition = 1; transition <= expectedTransitions; transition++) {
          assertEvent(receipt, 'NewTerm', { termId: lastEnsuredTermId.plus(transition), heartbeatSender: sender }, transition - 1)
        }
      })

      it(`initializes ${expectedTransitions} new terms`, async () => {
        const lastEnsuredTermId = await court.getLastEnsuredTermId()
        const currentBlockNumber = await court.getBlockNumberExt()

        await court.heartbeat(maxTransitionTerms, { from: sender })

        for (let transition = 1; transition <= expectedTransitions; transition++) {
          const termId = lastEnsuredTermId.plus(transition)
          const [startTime, dependingDrafts, courtConfigId, randomnessBN, randomness] = await court.getTerm(termId)

          assert.equal(startTime.toString(), firstTermStartTime + (termDuration * (transition - 1)), `start time for term ${termId} does not match`)
          assert.equal(dependingDrafts.toString(), 0, `term ${termId} should not have depending drafts initially`)
          assert.equal(courtConfigId.toString(), 1, `term ${termId} should be using the previous config`)
          assert.equal(randomnessBN.toString(), currentBlockNumber.plus(1).toString(), `randomness block number for term ${termId} should be the next block number`)
          assert.equal(randomness, EMPTY_RANDOMNESS, `randomness for term ${termId} should not be computed`)
        }
      })

      it(`remains ${remainingTransitions} transitions`, async () => {
        await court.heartbeat(maxTransitionTerms, { from: sender })

        assert.equal((await court.neededTermTransitions()).toString(), remainingTransitions, 'needed term transitions does not match')
      })

      it('does not refund the caller', async () => {
        const previousBalance = await courtHelper.accounting.balanceOf(feeToken.address, sender)

        await court.heartbeat(maxTransitionTerms, { from: sender })

        const currentBalance = await courtHelper.accounting.balanceOf(feeToken.address, sender)
        assert.equal(currentBalance.toString(), previousBalance.toString(), 'heartbeat fee token balances does not match')
      })
    }

    context('when current timestamp is before zero term start time', () => {
      beforeEach('set current timestamp', async () => {
        await courtHelper.setTimestamp(zeroTermStartTime)
      })

      itNeedsTermTransitions(0)
      itRevertsTryingToTransitionOneTerm()
    })

    context('when current timestamp is between zero term and first term ', () => {
      beforeEach('set current timestamp', async () => {
        await courtHelper.setTimestamp(zeroTermStartTime + termDuration / 2)
      })

      itNeedsTermTransitions(0)
      itRevertsTryingToTransitionOneTerm()
    })

    context('when current timestamp is right at the beginning of the first term', () => {
      beforeEach('set current timestamp', async () => {
        await courtHelper.setTimestamp(firstTermStartTime)
      })

      itNeedsTermTransitions(1)

      context('when the max transition terms given is zero', () => {
        const maxTransitionTerms = 0

        itReverts(maxTransitionTerms)
      })

      context('when the max transition terms given is one', () => {
        const maxTransitionTerms = 1
        const expectedTransitions = 1
        const remainingTransitions = 0

        itUpdatesTermsSuccessfully(maxTransitionTerms, expectedTransitions, remainingTransitions)
      })
    })

    context('when current timestamp is right at the end of the first term ', () => {
      beforeEach('set current timestamp', async () => {
        await courtHelper.setTimestamp(firstTermStartTime + termDuration)
      })

      itNeedsTermTransitions(2)

      context('when the max transition terms given is zero', () => {
        const maxTransitionTerms = 0

        itReverts(maxTransitionTerms)
      })

      context('when the max transition terms given is one', () => {
        const maxTransitionTerms = 1
        const expectedTransitions = 1
        const remainingTransitions = 1

        itUpdatesTermsSuccessfully(maxTransitionTerms, expectedTransitions, remainingTransitions)
      })

      context('when the max transition terms given is two', () => {
        const maxTransitionTerms = 2
        const expectedTransitions = 2
        const remainingTransitions = 0

        itUpdatesTermsSuccessfully(maxTransitionTerms, expectedTransitions, remainingTransitions)
      })

      context('when the max transition terms given is three', () => {
        const maxTransitionTerms = 3
        const expectedTransitions = 2
        const remainingTransitions = 0

        itUpdatesTermsSuccessfully(maxTransitionTerms, expectedTransitions, remainingTransitions)
      })
    })

    context('when current timestamp is two terms after the first term ', () => {
      beforeEach('set current timestamp', async () => {
        await courtHelper.setTimestamp(firstTermStartTime + termDuration * 2)
      })

      itNeedsTermTransitions(3)

      context('when the max transition terms given is zero', () => {
        const maxTransitionTerms = 0

        itReverts(maxTransitionTerms)
      })

      context('when the max transition terms given is one', () => {
        const maxTransitionTerms = 1
        const expectedTransitions = 1
        const remainingTransitions = 2

        itUpdatesTermsSuccessfully(maxTransitionTerms, expectedTransitions, remainingTransitions)
      })

      context('when the max transition terms given is two', () => {
        const maxTransitionTerms = 2
        const expectedTransitions = 2
        const remainingTransitions = 1

        itUpdatesTermsSuccessfully(maxTransitionTerms, expectedTransitions, remainingTransitions)
      })

      context('when the max transition terms given is three', () => {
        const maxTransitionTerms = 3
        const expectedTransitions = 3
        const remainingTransitions = 0

        itUpdatesTermsSuccessfully(maxTransitionTerms, expectedTransitions, remainingTransitions)
      })

      context('when the max transition terms given is four', () => {
        const maxTransitionTerms = 4
        const expectedTransitions = 3
        const remainingTransitions = 0

        itUpdatesTermsSuccessfully(maxTransitionTerms, expectedTransitions, remainingTransitions)
      })
    })
  })
})
