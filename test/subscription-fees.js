const { sha3 } = require('web3-utils')
const { bn, bigExp } = require('./helpers/numbers')
const { assertRevert } = require('./helpers/assertThrow')

const CourtSubscriptions = artifacts.require('CourtSubscriptions')
const SubscriptionsOwner = artifacts.require('SubscriptionsOwnerMock')
const JurorsRegistry = artifacts.require('JurorsRegistry')
const MiniMeToken = artifacts.require('@aragon/apps-shared-minime/contracts/MiniMeToken')

const assertEqualBN = async (actualPromise, expected, message) =>
      assert.equal((await actualPromise).toString(), expected, message)

const assertEqualBNs = (actual, expected, message) =>
      assert.equal(actual.toString(), expected.toString(), message)

const getLog = async (receiptPromise, logName, argName) => {
  const receipt = await receiptPromise
  const log = receipt.logs.find(({ event }) => event === logName)
  return log ? log.args[argName] : null
}

const assertLogs = async (receiptPromise, ...logNames) => {
  const receipt = await receiptPromise
  for (const logName of logNames) {
    assert.isNotNull(getLog(receipt, logName), `Expected ${logName} in receipt`)
  }
}

const ERROR_NOT_GOVERNOR = 'SUB_NOT_GOVERNOR'
const ERROR_ZERO_FEE = 'SUB_ZERO_FEE'
const ERROR_ZERO_PREPAYMENT_PERIODS = 'SUB_ZERO_PREPAYMENT_PERIODS'
const ERROR_INVALID_PERIOD = 'SUB_INVALID_PERIOD'
const ERROR_TOO_MANY_PERIODS = 'SUB_TOO_MANY_PERIODS'

const FEES_PAID_EVENT = 'FeesPaid'
const FEES_CLAIMED_EVENT = 'FeesClaimed'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

contract('CourtSubscriptions', ([ org1, org2, juror1, juror2, juror3 ]) => {
  let token

  const START_TERM_ID = 1
  const PERIOD_DURATION = 24 * 30 // 30 days, assuming terms are 1h
  const PREPAYMENT_PERIODS = 12

  const FEE_AMOUNT = bigExp(10, 18)
  const INITIAL_BALANCE = bigExp(1e6, 18)
  const GOVERNOR_SHARE_PCT = bn(100) // 100‱ = 1%
  const LATE_PAYMENT_PENALTY_PCT = bn(1000) // 1000‱ = 10%
  const MIN_ACTIVE_TOKEN = bigExp(1, 18)
  const ACTIVATE_DATA = sha3('activate(uint256)').slice(0, 10)

  const orgs = [org1, org2]
  const jurors = [juror1, juror2, juror3]

  const bnPct4Decrease = (n, p) => n.mul(bn(1e4).sub(p)).div(bn(1e4))
  const bnPct4Increase = (n, p) => n.mul(bn(1e4).add(p)).div(bn(1e4))

  beforeEach(async () => {
    this.jurorsRegistry = await JurorsRegistry.new()
    this.anj = await MiniMeToken.new(ZERO_ADDRESS, ZERO_ADDRESS, 0, 'ANJ Token', 18, 'ANJ', true)
    this.subscription = await CourtSubscriptions.new()
    // Mints 1,000,000 tokens for orgs
    token = await MiniMeToken.new(ZERO_ADDRESS, ZERO_ADDRESS, 0, 'Token', 0, 'SYM', true) // empty parameters minime
    for (let org of orgs) {
      await token.generateTokens(org, INITIAL_BALANCE)
      await token.approve(this.subscription.address, INITIAL_BALANCE, { from: org })
      await assertEqualBN(token.balanceOf(org), INITIAL_BALANCE, `org ${org} balance`)
    }
  })

  it('can init and set owner', async () => {
    assert.equal(await this.subscription.getOwner.call(), ZERO_ADDRESS, 'wrong owner before init')
    const subscriptionOwner = await SubscriptionsOwner.new(this.subscription.address)
    await this.subscription.init(subscriptionOwner.address, this.jurorsRegistry.address, PERIOD_DURATION, token.address, FEE_AMOUNT.toString(), PREPAYMENT_PERIODS, LATE_PAYMENT_PENALTY_PCT, GOVERNOR_SHARE_PCT)
    assert.equal(await this.subscription.getOwner.call(), subscriptionOwner.address, 'wrong owner after init')
  })

  context('With Owner interface', () => {
    beforeEach(async () => {
      this.subscriptionOwner = await SubscriptionsOwner.new(this.subscription.address)
      await this.subscriptionOwner.setCurrentTermId(START_TERM_ID)
      await this.jurorsRegistry.init(this.subscriptionOwner.address, this.anj.address, MIN_ACTIVE_TOKEN)
      await this.subscription.init(this.subscriptionOwner.address, this.jurorsRegistry.address, PERIOD_DURATION, token.address, FEE_AMOUNT.toString(), PREPAYMENT_PERIODS, LATE_PAYMENT_PENALTY_PCT, GOVERNOR_SHARE_PCT)
    })

    it('fails to set Fee Amount if not owner', async () => {
      await assertRevert(this.subscription.setFeeAmount(1, { from: org1 }), ERROR_NOT_GOVERNOR)
    })

    it('fails to set Fee Token if not owner', async () => {
      await assertRevert(this.subscription.setFeeToken(token.address, 1, { from: org1 }), ERROR_NOT_GOVERNOR)
    })

    it('fails to set pre-payment periods if not owner', async () => {
      await assertRevert(this.subscription.setPrePaymentPeriods(2, { from: org1 }), ERROR_NOT_GOVERNOR)
    })

    it('fails to set late payment penalty if not owner', async () => {
      await assertRevert(this.subscription.setLatePaymentPenaltyPct(2, { from: org1 }), ERROR_NOT_GOVERNOR)
    })

    it('fails to set governor share if not owner', async () => {
      await assertRevert(this.subscription.setGovernorSharePct(2, { from: org1 }), ERROR_NOT_GOVERNOR)
    })

    it('can set Fee amount as owner', async () => {
      const feeAmount = 2
      await this.subscriptionOwner.setFeeAmount(2)
      assertEqualBN(await this.subscription.currentFeeAmount(), feeAmount)
    })

    it('fails to set Fee Amount if zero', async () => {
      await assertRevert(this.subscriptionOwner.setFeeAmount(0), ERROR_ZERO_FEE)
    })

    it('can set Fee Token as owner', async () => {
      const token2 = await MiniMeToken.new(ZERO_ADDRESS, ZERO_ADDRESS, 0, 'Token', 0, 'SYM', true) // empty parameters minime
      await this.subscriptionOwner.setFeeToken(token2.address, FEE_AMOUNT)
      assert.equal(await this.subscription.currentFeeToken(), token2.address)
    })

    it('can set pre-payment periods as owner', async () => {
      const prePaymentPeriods = 2
      await this.subscriptionOwner.setPrePaymentPeriods(prePaymentPeriods)
      assertEqualBN(await this.subscription.prePaymentPeriods(), prePaymentPeriods)
    })

    it('fails to set pre-payment if zero', async () => {
      await assertRevert(this.subscriptionOwner.setPrePaymentPeriods(0), ERROR_ZERO_PREPAYMENT_PERIODS)
    })

    it('can set late payment penalty as owner', async () => {
      const latePaymentPenaltyPct = 2
      await this.subscriptionOwner.setLatePaymentPenaltyPct(latePaymentPenaltyPct)
      assertEqualBN(await this.subscription.latePaymentPenaltyPct(), latePaymentPenaltyPct)
    })

    it('can set governor share as owner', async () => {
      const governorSharePct = 2
      await this.subscriptionOwner.setGovernorSharePct(governorSharePct)
      assertEqualBN(await this.subscription.governorSharePct(), governorSharePct)
    })

    context('Org actions', () => {
      const subscribeAndPay = async (org, periods) => {
        assert.isFalse(await this.subscription.isUpToDate(org))

        const initialBalance = await token.balanceOf(org)

        const receipt = await this.subscription.payFees(org, periods, { from: org })
        await assertLogs(receipt, FEES_PAID_EVENT)

        const finalBalance = await token.balanceOf(org)

        assertEqualBNs(initialBalance.sub(FEE_AMOUNT.mul(periods)), finalBalance, 'Token balance mismatch')
        assert.isTrue(await this.subscription.isUpToDate(org))
      }

      const initialPeriods = [0, 3]
      for (const initialPeriod of initialPeriods) {
        context(`Starting on period ${initialPeriod}`, () => {
          beforeEach(async () => {
            // move forward
            await this.subscriptionOwner.addToCurrentTermId(PERIOD_DURATION * initialPeriod)
          })

          it('Org subscribes and pays fees for current period', async () => {
            await subscribeAndPay(org1, bn(1))
          })

          it('Org subscribes and pays fees in advance', async () => {
            const periods = 5

            await subscribeAndPay(org1, bn(periods))

            await this.subscriptionOwner.addToCurrentTermId(PERIOD_DURATION * (periods - 1))
            assert.isTrue(await this.subscription.isUpToDate(org1))
            await this.subscriptionOwner.addToCurrentTermId(PERIOD_DURATION)
            assert.isFalse(await this.subscription.isUpToDate(org1))
          })

          it('Org fails paying fees too far in the future', async () => {
            await assertRevert(this.subscription.payFees(org1, PREPAYMENT_PERIODS + 1, { from: org1 }), ERROR_TOO_MANY_PERIODS)
          })

          it('Org fails paying fees too far in the future with 2 calls', async () => {
            const halfPeriods = PREPAYMENT_PERIODS / 2 + 1
            await this.subscription.payFees(org1, halfPeriods, { from: org1 })
            await assertRevert(this.subscription.payFees(org1, halfPeriods, { from: org1 }), ERROR_TOO_MANY_PERIODS)
          })

          it('Org subscribes, stops paying and pays due amounts but without catching up completely', async () => {
            const notPayingPeriods = 3
            const paidDuePeriods = notPayingPeriods - 1

            // subscribes
            await subscribeAndPay(org1, bn(1))

            // stops paying
            await this.subscriptionOwner.addToCurrentTermId(PERIOD_DURATION * (notPayingPeriods + 1)) // +1 for the current, which is not yet overdue
            assert.isFalse(await this.subscription.isUpToDate(org1))

            // pays again
            const initialBalance = await token.balanceOf(org1)

            const receipt = await this.subscription.payFees(org1, paidDuePeriods, { from: org1 })
            await assertLogs(receipt, FEES_PAID_EVENT)

            const finalBalance = await token.balanceOf(org1)

            assertEqualBNs(
              initialBalance.sub(
                bnPct4Increase(FEE_AMOUNT.mul(bn(paidDuePeriods)), LATE_PAYMENT_PENALTY_PCT)
              ),
              finalBalance,
              'Token balance mismatch'
            )
            assert.isFalse(await this.subscription.isUpToDate(org1))
          })

          it('Org subscribes, stops paying and pays due amounts +1 in advance', async () => {
            const notPayingPeriods = 3

            // subscribes
            await subscribeAndPay(org1, bn(1))

            // stops paying
            await this.subscriptionOwner.addToCurrentTermId(PERIOD_DURATION * (notPayingPeriods + 1)) // +1 for the current, which is not yet overdue
            assert.isFalse(await this.subscription.isUpToDate(org1))

            // pays again
            const initialBalance = await token.balanceOf(org1)

            const receipt = await this.subscription.payFees(org1, notPayingPeriods + 2, { from: org1 })
            await assertLogs(receipt, FEES_PAID_EVENT)

            const finalBalance = await token.balanceOf(org1)

            assertEqualBNs(
              initialBalance.sub(
                bnPct4Increase(FEE_AMOUNT.mul(bn(notPayingPeriods)), LATE_PAYMENT_PENALTY_PCT).add(FEE_AMOUNT.mul(bn(2)))
              ),
              finalBalance,
              'Token balance mismatch'
            )
            assert.isTrue(await this.subscription.isUpToDate(org1))
            await this.subscriptionOwner.addToCurrentTermId(PERIOD_DURATION * 2)
            assert.isFalse(await this.subscription.isUpToDate(org1))
          })
        })
      }
    })

    context('Juror actions', () => {
      const JUROR_STAKE = bigExp(20, 18)

      beforeEach(async () => {
        // jurors stake
        for (let juror of jurors) {
          await this.anj.generateTokens(juror, JUROR_STAKE)
          await this.anj.approveAndCall(this.jurorsRegistry.address, JUROR_STAKE, ACTIVATE_DATA, { from: juror })
        }
        // orgs pay fees
        for (let org of orgs) {
          await this.subscription.payFees(org, 1, { from: org })
        }
        // move period forward
        await this.subscriptionOwner.setCurrentTermId(START_TERM_ID + PERIOD_DURATION)
      })

      it('Juror fails claiming fees in the future', async () => {
        await assertRevert(this.subscription.claimFees(3, { from: juror1 }), ERROR_INVALID_PERIOD)
      })

      it('Juror claim fees', async () => {
        const periodId = 0
        const initialBalance = await token.balanceOf(juror1)

        const receipt = await this.subscription.claimFees(periodId, { from: juror1 })
        await assertLogs(receipt, FEES_CLAIMED_EVENT)

        const finalBalance = await token.balanceOf(juror1)

        const jurorFee = bnPct4Decrease(FEE_AMOUNT.mul(bn(orgs.length)), GOVERNOR_SHARE_PCT).div(bn(jurors.length))

        assertEqualBNs(initialBalance.add(jurorFee), finalBalance, 'Token balance mismatch')
      })
    })
  })
})
