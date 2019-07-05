const { assertRevert } = require('@aragon/os/test/helpers/assertThrow')

const CourtSubscriptions = artifacts.require('CourtSubscriptions')
const SubscriptionsOwner = artifacts.require('SubscriptionsOwnerMock')
const SumTree = artifacts.require('HexSumTreeWrapper')
const MiniMeToken = artifacts.require('@aragon/apps-shared-minime/contracts/MiniMeToken')

const deployedContract = async (receiptPromise, name) =>
      artifacts.require(name).at(getLog(await receiptPromise, 'Deployed', 'addr'))

const assertEqualBN = async (actualPromise, expected, message) =>
      assert.equal((await actualPromise).toNumber(), expected, message)
const assertEqualBNs = (actual, expected, message) =>
      assert.equal(actual.toNumber(), expected.toNumber(), message)

const getLog = (receipt, logName, argName) => {
  const log = receipt.logs.find(({ event }) => event == logName)
  return log ? log.args[argName] : null
}

const assertLogs = (receipt, ...logNames) => {
  for (const logName of logNames) {
    assert.isNotNull(getLog(receipt, logName), `Expected ${logName} in receipt`)
  }
}

const ZERO_ADDRESS = '0x' + '00'.repeat(20)

const ERROR_NOT_GOVERNOR = 'SUB_NOT_GOVERNOR'
const ERROR_ZERO_FEE = 'SUB_ZERO_FEE'
const ERROR_ZERO_PREPAYMENT_PERIODS = 'SUB_ZERO_PREPAYMENT_PERIODS'
const ERROR_INVALID_PERIOD = 'SUB_INVALID_PERIOD'
const ERROR_TOO_MANY_PERIODS = 'SUB_TOO_MANY_PERIODS'

const FEES_PAID_EVENT = 'FeesPaid'
const FEES_CLAIMED_EVENT = 'FeesClaimed'
const GOVERNOR_FEES_TRANSFERRED_EVENT = 'GovernorFeesTransferred'

const DECIMALS = 1e18

contract('CourtSubscriptions', ([ org1, org2, juror1, juror2, juror3 ]) => {
  let token
  const START_TERM_ID = 1
  const PERIOD_DURATION = 24 * 30 // 30 days, assuming terms are 1h
  const PREPAYMENT_PERIODS = 12
  const FEE_AMOUNT = new web3.BigNumber(10).mul(DECIMALS)
  const INITIAL_BALANCE = new web3.BigNumber(1e6).mul(DECIMALS)
  const GOVERNOR_SHARE_PCT = 100 // 100‱ = 1%
  const LATE_PAYMENT_PENALTY_PCT = 1000 // 1000‱ = 10%
  const orgs = [ org1, org2 ]
  const jurors = [ juror1, juror2, juror3 ]

  const bnPct4Decrease = (n, p) => n.mul(1e4 - p).div(1e4)
  const bnPct4Increase = (n, p) => n.mul(1e4 + p).div(1e4)

  beforeEach(async () => {
    this.sumTree = await SumTree.new()

    this.subscription = await CourtSubscriptions.new()
    // Mints 1,000,000 tokens for orgs
    token = await MiniMeToken.new(ZERO_ADDRESS, ZERO_ADDRESS, 0, 'n', 0, 'n', true) // empty parameters minime
    for (let org of orgs) {
      await token.generateTokens(org, INITIAL_BALANCE)
      await token.approve(this.subscription.address, INITIAL_BALANCE, { from: org })
      await assertEqualBN(token.balanceOf(org), INITIAL_BALANCE, `org ${org} balance`)
    }
  })

  it('can init and set owner', async () => {
    assert.equal(await this.subscription.getOwner.call(), ZERO_ADDRESS, 'wrong owner before init')
    const subscriptionOwner = await SubscriptionsOwner.new(this.subscription.address, this.sumTree.address)
    await this.subscription.init(subscriptionOwner.address, this.sumTree.address, PERIOD_DURATION, token.address, FEE_AMOUNT.toString(), PREPAYMENT_PERIODS, LATE_PAYMENT_PENALTY_PCT, GOVERNOR_SHARE_PCT)
    assert.equal(await this.subscription.getOwner.call(), subscriptionOwner.address, 'wrong owner after init')
  })

  context('With Owner interface', () => {
    const vote = 1

    beforeEach(async () => {
      this.subscriptionOwner = await SubscriptionsOwner.new(this.subscription.address, this.sumTree.address)
      await this.subscriptionOwner.setCurrentTermId(START_TERM_ID)
      await this.sumTree.init(this.subscriptionOwner.address)
      await this.subscription.init(this.subscriptionOwner.address, this.sumTree.address, PERIOD_DURATION, token.address, FEE_AMOUNT.toString(), PREPAYMENT_PERIODS, LATE_PAYMENT_PENALTY_PCT, GOVERNOR_SHARE_PCT)
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
      const token2 = await MiniMeToken.new(ZERO_ADDRESS, ZERO_ADDRESS, 0, 'n', 0, 'n', true) // empty parameters minime
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
      beforeEach(async () => {
      })

      const logPeriod = async() => {
        const currentTermId = (await this.subscriptionOwner.getCurrentTermId()).toNumber()
        console.log(currentTermId, START_TERM_ID, PERIOD_DURATION, (currentTermId - START_TERM_ID) / PERIOD_DURATION);
      }

      const subscribeAndPay = async (org, periods) => {
        assert.isFalse(await this.subscription.isUpToDate(org))

        const initialBalance = await token.balanceOf(org)

        const receipt = await this.subscription.payFees(org, periods, { from: org })
        await assertLogs(receipt, FEES_PAID_EVENT)

        const finalBalance = await token.balanceOf(org)

        assertEqualBNs(initialBalance.sub(FEE_AMOUNT.mul(periods)), finalBalance, 'Token balance mismatch')
        assert.isTrue(await this.subscription.isUpToDate(org))
      }

      it('Org subscribes and pays fees for current period', async () => {
        await subscribeAndPay(org1, 1)
      })

      it('Org subscribes and pays fees in advance', async () => {
        const periods = 5

        await subscribeAndPay(org1, periods)

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

      it('Org subscribes, stops paying and pays due amounts +1 in advance', async () => {
        const notPayingPeriods = 3

        // subscribes
        await subscribeAndPay(org1, 1)

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
            bnPct4Increase(FEE_AMOUNT.mul(notPayingPeriods), LATE_PAYMENT_PENALTY_PCT).add(FEE_AMOUNT.mul(2))
          ),
          finalBalance,
          'Token balance mismatch'
        )
        assert.isTrue(await this.subscription.isUpToDate(org1))
        await this.subscriptionOwner.addToCurrentTermId(PERIOD_DURATION * 2)
        assert.isFalse(await this.subscription.isUpToDate(org1))
      })

    })

    context('Juror actions', () => {
      const JUROR_STAKE = new web3.BigNumber(20).mul(DECIMALS)

      beforeEach(async () => {
        // jurors stake
        for (let juror of jurors) {
          await this.subscriptionOwner.insertJuror(juror, 1, JUROR_STAKE)
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

        const jurorFee = bnPct4Decrease(FEE_AMOUNT.mul(orgs.length), GOVERNOR_SHARE_PCT).div(jurors.length)

        assertEqualBNs(initialBalance.add(jurorFee), finalBalance, 'Token balance mismatch')
      })
    })
  })
})
