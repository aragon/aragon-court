const { bn } = require('../helpers/numbers')
const { buildHelper } = require('../helpers/controller')(web3, artifacts)
const { assertRevert } = require('../helpers/assertThrow')
const { NEXT_WEEK, NOW, ONE_DAY } = require('../helpers/time')
const { assertAmountOfEvents, assertEvent } = require('../helpers/assertEvent')

contract('Controller', () => {
  let controllerHelper, controller

  const EMPTY_RANDOMNESS = '0x0000000000000000000000000000000000000000000000000000000000000000'

  beforeEach('build helper', () => {
    controllerHelper = buildHelper()
  })

  describe('constructor', () => {
    const termDuration = bn(ONE_DAY)

    context('when setting the first term start time in the past', () => {
      const firstTermStartTime = bn(NOW - 1)

      it('reverts', async () => {
        await assertRevert(controllerHelper.deploy({ termDuration, firstTermStartTime }), 'CLK_BAD_FIRST_TERM_START_TIME')
      })
    })

    context('when setting the first term start time previous to one term duration', () => {
      const firstTermStartTime = bn(NOW).add(termDuration.sub(bn(1)))

      it('reverts', async () => {
        await assertRevert(controllerHelper.deploy({ termDuration, firstTermStartTime }), 'CLK_BAD_FIRST_TERM_START_TIME')
      })
    })

    context('when setting the first term start time in the future', () => {
      const firstTermStartTime = bn(NEXT_WEEK)

      beforeEach('deploy controller', async () => {
        controller = await controllerHelper.deploy({ termDuration, firstTermStartTime })
      })

      it('it must have already started term #0', async () => {
        const { startTime, randomnessBN, randomness } = await controller.getTerm(0)

        assert.equal(startTime.toString(), firstTermStartTime.sub(termDuration), 'term zero start time does not match')
        assert.equal(randomnessBN.toString(), 0, 'zero term randomness block number should not be computed')
        assert.equal(randomness, EMPTY_RANDOMNESS, 'zero term randomness should not be computed')
      })

      it('does not require a term transition', async () => {
        assert.equal((await controller.getNeededTermTransitions()).toString(), 0, 'needed term transitions does not match')
      })
    })
  })

  describe('heartbeat', () => {
    const termDuration = bn(ONE_DAY)
    const firstTermStartTime = bn(NEXT_WEEK)
    const zeroTermStartTime = firstTermStartTime.sub(termDuration)

    beforeEach('create controller', async () => {
      controller = await controllerHelper.deploy({ termDuration, firstTermStartTime })
    })

    const itRevertsOnHeartbeat = maxTransitionTerms => {
      it('reverts', async () => {
        await assertRevert(controller.heartbeat(maxTransitionTerms), 'CLK_INVALID_TRANSITION_TERMS')
      })
    }

    const itRevertsTryingToTransitionOneTerm = () => {
      context('when the max transition terms given is zero', () => {
        const maxTransitionTerms = 0

        itRevertsOnHeartbeat(maxTransitionTerms)
      })

      context('when the max transition terms given is one', () => {
        const maxTransitionTerms = 1

        itRevertsOnHeartbeat(maxTransitionTerms)
      })
    }

    const itNeedsTermTransitions = neededTransitions => {
      it(`requires ${neededTransitions} term transitions`, async () => {
        assert.equal((await controller.getNeededTermTransitions()).toString(), neededTransitions, 'needed term transitions does not match')
      })
    }

    const itUpdatesTermsSuccessfully = (maxTransitionTerms, expectedTransitions, remainingTransitions) => {
      it('updates the term id', async () => {
        const previousTermId = await controller.getLastEnsuredTermId()

        const receipt = await controller.heartbeat(maxTransitionTerms)

        assertAmountOfEvents(receipt, 'Heartbeat', 1)
        assertEvent(receipt, 'Heartbeat', { previousTermId, currentTermId: previousTermId.add(bn(expectedTransitions)) })
      })

      it(`initializes ${expectedTransitions} new terms`, async () => {
        const lastEnsuredTermId = await controller.getLastEnsuredTermId()

        await controller.heartbeat(maxTransitionTerms)
        const currentBlockNumber = await controller.getBlockNumberExt()

        for (let transition = 1; transition <= expectedTransitions; transition++) {
          const termId = lastEnsuredTermId.add(bn(transition))
          const { startTime, randomnessBN, randomness } = await controller.getTerm(termId)

          assert.equal(startTime.toString(), firstTermStartTime.add(termDuration.mul(bn(transition - 1))), `start time for term ${termId} does not match`)
          assert.equal(randomnessBN.toString(), currentBlockNumber.add(bn(1)).toString(), `randomness block number for term ${termId} should be the next block number`)
          assert.equal(randomness, EMPTY_RANDOMNESS, `randomness for term ${termId} should not be computed`)
        }
      })

      it(`remains ${remainingTransitions} transitions`, async () => {
        await controller.heartbeat(maxTransitionTerms)

        assert.equal((await controller.getNeededTermTransitions()).toString(), remainingTransitions, 'needed term transitions does not match')
      })
    }

    context('when current timestamp is before zero term start time', () => {
      beforeEach('set current timestamp', async () => {
        await controller.mockSetTimestamp(zeroTermStartTime)
      })

      itNeedsTermTransitions(0)
      itRevertsTryingToTransitionOneTerm()
    })

    context('when current timestamp is between zero term and first term ', () => {
      beforeEach('set current timestamp', async () => {
        await controller.mockSetTimestamp(zeroTermStartTime.add(termDuration).div(bn(2)))
      })

      itNeedsTermTransitions(0)
      itRevertsTryingToTransitionOneTerm()
    })

    context('when current timestamp is right at the beginning of the first term', () => {
      beforeEach('set current timestamp', async () => {
        await controller.mockSetTimestamp(firstTermStartTime)
      })

      itNeedsTermTransitions(1)

      context('when the max transition terms given is zero', () => {
        const maxTransitionTerms = 0

        itRevertsOnHeartbeat(maxTransitionTerms)
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
        await controller.mockSetTimestamp(firstTermStartTime.add(termDuration))
      })

      itNeedsTermTransitions(2)

      context('when the max transition terms given is zero', () => {
        const maxTransitionTerms = 0

        itRevertsOnHeartbeat(maxTransitionTerms)
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

    context('when current timestamp is two terms after the first term', () => {
      beforeEach('set current timestamp', async () => {
        await controller.mockSetTimestamp(firstTermStartTime.add(termDuration.mul(bn(2))))
      })

      itNeedsTermTransitions(3)

      context('when the max transition terms given is zero', () => {
        const maxTransitionTerms = 0

        itRevertsOnHeartbeat(maxTransitionTerms)
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
