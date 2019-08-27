const { bigExp } = require('../helpers/numbers')(web3)
const { assertRevert } = require('@aragon/os/test/helpers/assertThrow')
const { TOMORROW, ONE_DAY } = require('../helpers/time')
const { buildHelper, DISPUTE_STATES } = require('../helpers/court')(web3, artifacts)
const { assertAmountOfEvents, assertEvent } = require('@aragon/os/test/helpers/assertEvent')(web3)

const MiniMeToken = artifacts.require('MiniMeToken')
const Arbitrable = artifacts.require('ArbitrableMock')

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

contract('Court', ([_, sender]) => {
  let courtHelper, court, feeToken, arbitrable

  const termDuration = ONE_DAY
  const firstTermStartTime = TOMORROW
  const jurorFee = bigExp(10, 18)
  const heartbeatFee = bigExp(20, 18)
  const draftFee = bigExp(30, 18)
  const settleFee = bigExp(40, 18)

  beforeEach('create court', async () => {
    courtHelper = buildHelper()
    feeToken = await MiniMeToken.new(ZERO_ADDRESS, ZERO_ADDRESS, 0, 'Court Fee Token', 18, 'CFT', true)
    court = await courtHelper.deploy({ firstTermStartTime, termDuration, feeToken, jurorFee, heartbeatFee, draftFee, settleFee })
  })

  beforeEach('mock subscriptions and arbitrable instance', async () => {
    arbitrable = await Arbitrable.new()
    await courtHelper.subscriptions.setUpToDate(true)
  })

  describe('createDispute', () => {
    context('when the given input is valid', () => {
      const draftTermId = 2
      const jurorsNumber = 10
      const possibleRulings = 2

      const itHandlesDisputesCreationProperly = expectedTermTransitions => {
        context('when the creator deposits enough collateral', () => {
          const jurorFees = jurorFee.mul(jurorsNumber)
          const jurorRewards = (draftFee.plus(settleFee)).mul(jurorsNumber)
          const requiredCollateral = jurorFees.plus(heartbeatFee).plus(jurorRewards)

          beforeEach('deposit collateral', async () => {
            await feeToken.generateTokens(sender, requiredCollateral)
            await feeToken.approve(court.address, requiredCollateral, { from: sender })
          })

          it('creates a new dispute', async () => {
            const receipt = await court.createDispute(arbitrable.address, possibleRulings, jurorsNumber, draftTermId, { from: sender })

            assertAmountOfEvents(receipt, 'NewDispute')
            assertEvent(receipt, 'NewDispute', { disputeId: 0, subject: arbitrable.address, draftTermId, jurorsNumber })

            const [subject, rulings, state, finalRuling] = await court.getDispute(0)
            assert.equal(subject, arbitrable.address, 'dispute subject does not match')
            assert.equal(state, DISPUTE_STATES.PRE_DRAFT, 'dispute state does not match')
            assert.equal(rulings.toString(), possibleRulings, 'dispute possible rulings do not match')
            assert.equal(finalRuling.toString(), 0, 'dispute final ruling does not match')
          })

          it('creates a new adjudication round', async () => {
            await court.createDispute(arbitrable.address, possibleRulings, jurorsNumber, draftTermId, { from: sender })

            const [draftTerm, delayTerm, jurorNumber, selectedJurors, triggeredBy, settledPenalties, slashedTokens] = await court.getAdjudicationRound(0, 0)

            assert.equal(draftTerm.toString(), draftTermId, 'round draft term does not match')
            assert.equal(delayTerm.toString(), 0, 'round delay term does not match')
            assert.equal(jurorNumber.toString(), jurorsNumber, 'round jurors number does not match')
            assert.equal(selectedJurors.toString(), 0, 'round selected jurors number does not match')
            assert.equal(triggeredBy, sender, 'round trigger does not match')
            assert.equal(settledPenalties, false, 'round penalties should not be settled')
            assert.equal(slashedTokens.toString(), 0, 'round slashed tokens should be zero')
          })

          it('transfers the collateral to the court', async () => {
            const previousCourtBalance = await feeToken.balanceOf(court.address)
            const previousAccountingBalance = await feeToken.balanceOf(courtHelper.accounting.address)
            const previousSenderBalance = await feeToken.balanceOf(sender)

            await court.createDispute(arbitrable.address, possibleRulings, jurorsNumber, draftTermId, { from: sender })

            const jurorFees = jurorFee.mul(jurorsNumber)
            const jurorRewards = (draftFee.plus(settleFee)).mul(jurorsNumber)
            const expectedDelta = jurorFees.plus(heartbeatFee).plus(jurorRewards)

            const currentCourtBalance = await feeToken.balanceOf(court.address)
            assert.equal(previousCourtBalance.toString(), currentCourtBalance.toString(), 'court balances do not match')

            const currentAccountingBalance = await feeToken.balanceOf(courtHelper.accounting.address)
            assert.equal(previousAccountingBalance.plus(expectedDelta).toString(), currentAccountingBalance.toString(), 'court accounting balances do not match')

            const currentSenderBalance = await feeToken.balanceOf(sender)
            assert.equal(previousSenderBalance.minus(expectedDelta).toString(), currentSenderBalance.toString(), 'sender balances do not match')
          })

          it(`transitions ${expectedTermTransitions} terms`, async () => {
            const previousTermId = await court.getLastEnsuredTermId()

            const receipt = await court.createDispute(arbitrable.address, possibleRulings, jurorsNumber, draftTermId, { from: sender })

            assertAmountOfEvents(receipt, 'NewTerm', expectedTermTransitions)

            const currentTermId = await court.getLastEnsuredTermId()
            assert.equal(previousTermId.plus(expectedTermTransitions).toString(), currentTermId.toString(), 'term id does not match')
          })
        })

        context('when the creator does not deposit enough collateral', () => {
          it('reverts', async () => {
            await assertRevert(court.createDispute(arbitrable.address, possibleRulings, jurorsNumber, draftTermId), 'CTDEPOSIT_FAIL')
          })
        })
      }

      context('when the court is at term zero', () => {
        it('reverts', async () => {
          await assertRevert(court.createDispute(arbitrable.address, possibleRulings, jurorsNumber, draftTermId), 'CT_CANNOT_CREATE_DISPUTE')
        })
      })

      context('when the court is after term zero', () => {
        beforeEach('set timestamp at the beginning of the first term', async () => {
          await courtHelper.setTimestamp(firstTermStartTime)
        })

        context('when the term is up-to-date', () => {
          const expectedTermTransitions = 0

          beforeEach('update term', async () => {
            await court.heartbeat(1)
          })

          itHandlesDisputesCreationProperly(expectedTermTransitions)
        })

        context('when the term is outdated by one term', () => {
          const expectedTermTransitions = 1

          itHandlesDisputesCreationProperly(expectedTermTransitions)
        })

        context('when the term is outdated by more than one term', () => {
          beforeEach('set timestamp two terms after the first term', async () => {
            await courtHelper.setTimestamp(firstTermStartTime + termDuration * 2)
          })

          it('reverts', async () => {
            await assertRevert(court.createDispute(arbitrable.address, possibleRulings, jurorsNumber, draftTermId), 'CTTOO_MANY_TRANSITIONS')
          })
        })
      })
    })

    context('when the given input is not valid', () => {
      beforeEach('set timestamp at the beginning of the first term', async () => {
        await courtHelper.setTimestamp(firstTermStartTime)
      })

      context('when the possible rulings are invalid', () => {
        it('reverts', async () => {
          await assertRevert(court.createDispute(arbitrable.address, 0, 10, 20), 'CTBAD_RULING_OPTS')
          await assertRevert(court.createDispute(arbitrable.address, 1, 10, 20), 'CTBAD_RULING_OPTS')
          await assertRevert(court.createDispute(arbitrable.address, 3, 10, 20), 'CTBAD_RULING_OPTS')
        })
      })

      context('when the subscription is outdated', () => {
        it('reverts', async () => {
          await courtHelper.subscriptions.setUpToDate(false)

          await assertRevert(court.createDispute(arbitrable.address, 2, 10, 20), 'CTSUBSC_UNPAID')
        })
      })

      context('when the number of jurors is invalid', () => {
        // TODO: implement
      })

      context('when the given term id is invalid', () => {
        // TODO: implement
      })

      context('when the arbitrable is not valid', () => {
        // TODO: implement
      })
    })
  })

  describe('getDispute', () => {
    context('when the dispute exists', async () => {
      const draftTermId = 2
      const jurorsNumber = 10
      const possibleRulings = 2

      beforeEach('create dispute', async () => {
        await courtHelper.setTimestamp(firstTermStartTime)
        await feeToken.generateTokens(sender, bigExp(1000, 18))
        await feeToken.approve(court.address, bigExp(1000, 18), { from: sender })

        await court.createDispute(arbitrable.address, possibleRulings, jurorsNumber, draftTermId, { from: sender })
      })

      it('returns the requested dispute', async () => {
        const [subject, rulings, state, finalRuling] = await court.getDispute(0)

        assert.equal(subject, arbitrable.address, 'dispute subject does not match')
        assert.equal(state, DISPUTE_STATES.PRE_DRAFT, 'dispute state does not match')
        assert.equal(rulings.toString(), possibleRulings, 'dispute possible rulings do not match')
        assert.equal(finalRuling.toString(), 0, 'dispute final ruling does not match')
      })
    })

    context('when the dispute does not exist', async () => {
      it('reverts', async () => {
        await assertRevert(court.getDispute(0), 'CT_DISPUTE_DOES_NOT_EXIST')
      })
    })
  })

  describe('getRound', () => {
    context('when the dispute exists', async () => {
      const draftTermId = 2
      const jurorsNumber = 10
      const possibleRulings = 2

      beforeEach('create dispute', async () => {
        await courtHelper.setTimestamp(firstTermStartTime)
        await feeToken.generateTokens(sender, bigExp(1000, 18))
        await feeToken.approve(court.address, bigExp(1000, 18), { from: sender })

        await court.createDispute(arbitrable.address, possibleRulings, jurorsNumber, draftTermId, { from: sender })
      })

      context('when the round exists', async () => {
        it('returns the requested round', async () => {
          const [draftTerm, delayTerm, jurorNumber, selectedJurors, triggeredBy, settledPenalties, slashedTokens] = await court.getAdjudicationRound(0, 0)

          assert.equal(draftTerm.toString(), draftTermId, 'round draft term does not match')
          assert.equal(delayTerm.toString(), 0, 'round delay term does not match')
          assert.equal(jurorNumber.toString(), jurorsNumber, 'round jurors number does not match')
          assert.equal(selectedJurors.toString(), 0, 'round selected jurors number does not match')
          assert.equal(triggeredBy, sender, 'round trigger does not match')
          assert.equal(settledPenalties, false, 'round penalties should not be settled')
          assert.equal(slashedTokens.toString(), 0, 'round slashed tokens should be zero')
        })
      })

      context('when the round does not exist', async () => {
        // TODO: this scenario is not implemented in the contracts yet
        it.skip('reverts', async () => {
          await assertRevert(court.getAdjudicationRound(0, 1), 'CT_ROUND_DOES_NOT_EXIST')
        })
      })
    })

    context('when the dispute does not exist', () => {
      // TODO: this scenario is not implemented in the contracts yet
      it.skip('reverts', async () => {
        await assertRevert(court.getAdjudicationRound(0, 0), 'CT_DISPUTE_DOES_NOT_EXIST')
      })
    })
  })
})
