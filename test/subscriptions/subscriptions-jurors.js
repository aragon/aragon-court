const { assertBn } = require('../helpers/asserts/assertBn')
const { bn, bigExp } = require('../helpers/lib/numbers')
const { buildHelper } = require('../helpers/wrappers/court')(web3, artifacts)
const { buildBrightIdHelper } = require('../helpers/wrappers/brightid')(web3, artifacts)
const { assertRevert } = require('../helpers/asserts/assertThrow')
const { ACTIVATE_DATA } = require('../helpers/utils/jurors')
const { padLeft, toHex } = require('web3-utils')
const { SUBSCRIPTIONS_ERRORS } = require('../helpers/utils/errors')
const { SUBSCRIPTIONS_EVENTS } = require('../helpers/utils/events')
const { assertAmountOfEvents, assertEvent } = require('../helpers/asserts/assertEvent')

const CourtSubscriptions = artifacts.require('CourtSubscriptions')
const JurorsRegistry = artifacts.require('JurorsRegistry')
const DisputeManager = artifacts.require('DisputeManagerMockForRegistry')
const ERC20 = artifacts.require('ERC20Mock')

contract('CourtSubscriptions', ([_, payer, jurorPeriod0Term1, jurorPeriod0Term3, jurorMidPeriod1]) => {
  let controller, subscriptions, jurorsRegistry, feeToken, jurorToken, brightIdHelper, courtHelper

  const PCT_BASE_HIGH_PRECISION = bigExp(1, 18)
  const DONATED_FEES = bigExp(10, 18)
  const PERIOD_DURATION = 30           // 30 days, assuming terms are 1d
  const GOVERNOR_SHARE_PCT = bn(100)        // 100‱ = 1%

  const MIN_JURORS_ACTIVE_TOKENS = bigExp(100, 18)
  const TOTAL_ACTIVE_BALANCE_LIMIT = bigExp(100e6, 18)

  const jurorPeriod0Term1Balance = MIN_JURORS_ACTIVE_TOKENS
  const jurorPeriod0Term3Balance = MIN_JURORS_ACTIVE_TOKENS.mul(bn(2))
  const jurorMidPeriod1Balance = MIN_JURORS_ACTIVE_TOKENS.mul(bn(3))

  beforeEach('create base contracts', async () => {
    courtHelper = buildHelper()
    controller = await courtHelper.deploy({ minActiveBalance: MIN_JURORS_ACTIVE_TOKENS,
      minMaxPctTotalSupply: PCT_BASE_HIGH_PRECISION.sub(bn(1)), maxMaxPctTotalSupply: PCT_BASE_HIGH_PRECISION })
    feeToken = courtHelper.feeToken

    subscriptions = await CourtSubscriptions.new(controller.address, PERIOD_DURATION, feeToken.address)
    await controller.setSubscriptions(subscriptions.address)

    jurorsRegistry = await JurorsRegistry.new(controller.address, TOTAL_ACTIVE_BALANCE_LIMIT)
    await controller.setJurorsRegistry(jurorsRegistry.address)

    const disputeManager = await DisputeManager.new(controller.address)
    await controller.setDisputeManager(disputeManager.address)

    brightIdHelper = buildBrightIdHelper()
    const brightIdRegister = await brightIdHelper.deploy()
    await brightIdHelper.registerUsers([jurorPeriod0Term1, jurorPeriod0Term3, jurorMidPeriod1])
    await controller.setBrightIdRegister(brightIdRegister.address)

    // Donate subscription fees
    await feeToken.generateTokens(payer, DONATED_FEES)
    await feeToken.transfer(subscriptions.address, DONATED_FEES, { from: payer })
    await controller.mockSetTerm(PERIOD_DURATION + 1)
  })

  const activateJurors =  async () => {
    await controller.mockSetTerm(0) // tokens are activated for the next term
    await feeToken.generateTokens(jurorPeriod0Term1, jurorPeriod0Term1Balance)
    await feeToken.approveAndCall(jurorsRegistry.address, jurorPeriod0Term1Balance, ACTIVATE_DATA, { from: jurorPeriod0Term1 })

    await controller.mockSetTerm(2) // tokens are activated for the next term
    await feeToken.generateTokens(jurorPeriod0Term3, jurorPeriod0Term3Balance)
    await feeToken.approveAndCall(jurorsRegistry.address, jurorPeriod0Term3Balance, ACTIVATE_DATA, { from: jurorPeriod0Term3 })

    await controller.mockSetTerm(PERIOD_DURATION * 1.5 - 1)
    await feeToken.generateTokens(jurorMidPeriod1, jurorMidPeriod1Balance)
    await feeToken.approveAndCall(jurorsRegistry.address, jurorMidPeriod1Balance, ACTIVATE_DATA, { from: jurorMidPeriod1 })
  }

  const setCheckpointUsedToTerm = async (term) => {
    const randomness = padLeft(toHex(PERIOD_DURATION + (term - 1)), 64)
    await controller.mockSetTermRandomness(randomness)
  }

  describe('claimFees()', () => {

    context('with jurors activated', () => {
      beforeEach(async () => {
        await activateJurors()
      })

      it('reverts when requesting before period 1 has begun', async () => {
        await controller.mockSetTerm(1)
        await assertRevert(subscriptions.claimFees({ from: jurorPeriod0Term1 }), SUBSCRIPTIONS_ERRORS.STILL_PERIOD_ZERO)
      })

      it('transfers share fees to the juror with term 1 as checkpoint', async () => {
        await setCheckpointUsedToTerm(1)
        const previousBalance = await feeToken.balanceOf(jurorPeriod0Term1)

        await subscriptions.claimFees({ from: jurorPeriod0Term1 })

        const currentBalance = await feeToken.balanceOf(jurorPeriod0Term1)
        assertBn(previousBalance.add(DONATED_FEES), currentBalance, 'juror balance does not match')
        assert.isTrue(await subscriptions.hasJurorClaimed(jurorPeriod0Term1))
      })

      it('transfers share fees to the juror when they were active in previous term', async () => {
        await setCheckpointUsedToTerm(2)
        const previousBalance = await feeToken.balanceOf(jurorPeriod0Term1)

        await subscriptions.claimFees({ from: jurorPeriod0Term1 })

        const currentBalance = await feeToken.balanceOf(jurorPeriod0Term1)
        assertBn(previousBalance.add(DONATED_FEES), currentBalance, 'juror balance does not match')
        assert.isTrue(await subscriptions.hasJurorClaimed(jurorPeriod0Term1))
      })

      it('reverts when juror is not active at checkpoint', async () => {
        await setCheckpointUsedToTerm(2)
        await assertRevert(subscriptions.claimFees({ from: jurorPeriod0Term3 }), SUBSCRIPTIONS_ERRORS.JUROR_NOTHING_TO_CLAIM)
      })

      it('transfers share fees to the juror with term 3 as checkpoint', async () => {
        await setCheckpointUsedToTerm(3)
        const expectedTotalActiveBalance = jurorPeriod0Term1Balance.add(jurorPeriod0Term3Balance)
        const expectedShareFees = DONATED_FEES.mul(jurorPeriod0Term3Balance).div(expectedTotalActiveBalance)
        const previousBalance = await feeToken.balanceOf(jurorPeriod0Term3)

        await subscriptions.claimFees({ from: jurorPeriod0Term3 })

        const currentBalance = await feeToken.balanceOf(jurorPeriod0Term3)
        assertBn(previousBalance.add(expectedShareFees), currentBalance, 'juror balance does not match')
        assert.isTrue(await subscriptions.hasJurorClaimed(jurorPeriod0Term3))
      })

      it('transfers share fees to the second claiming juror', async () => {
        const previousBalance = await feeToken.balanceOf(jurorPeriod0Term1)
        const expectedTotalActiveBalance = jurorPeriod0Term1Balance.add(jurorPeriod0Term3Balance)
        const secondJurorExpectedShareFees = DONATED_FEES.mul(jurorPeriod0Term1Balance).div(expectedTotalActiveBalance)
        await subscriptions.claimFees({ from: jurorPeriod0Term3 })

        await subscriptions.claimFees({ from: jurorPeriod0Term1 })

        const currentBalance = await feeToken.balanceOf(jurorPeriod0Term1)
        assertBn(previousBalance.add(secondJurorExpectedShareFees), currentBalance, 'juror balance does not match')
        assert.isTrue(await subscriptions.hasJurorClaimed(jurorPeriod0Term1))
      })

      it('sets the periods details correctly', async () => {
        const checkpointTerm = 1
        await setCheckpointUsedToTerm(checkpointTerm)
        await subscriptions.claimFees({ from: jurorPeriod0Term1 })
        const periodId = await subscriptions.getCurrentPeriodId()

        const { periodBalanceCheckpoint, feeToken: periodFeeToken, totalActiveBalance, donatedFees } = await subscriptions.getPeriod(periodId - 1)

        assertBn(periodBalanceCheckpoint, checkpointTerm, 'checkpoint does not match')
        assert.equal(periodFeeToken, feeToken.address, 'fee token does not match')
        assertBn(totalActiveBalance, jurorPeriod0Term1Balance, 'total active balance does not match')
        assertBn(donatedFees, DONATED_FEES, 'donated fees does not match')
      })

      it('reverts when claiming fees twice', async () => {
        await setCheckpointUsedToTerm(1)
        await subscriptions.claimFees({ from: jurorPeriod0Term1 })

        await assertRevert(subscriptions.claimFees({ from: jurorPeriod0Term1 }), 'CS_JUROR_FEES_ALREADY_CLAIMED')
      })
    })

    it('reverts when juror has nothing to claim', async () => {
      await controller.mockSetTerm(PERIOD_DURATION + 1)
      await assertRevert(subscriptions.claimFees({ from: jurorPeriod0Term1 }), SUBSCRIPTIONS_ERRORS.JUROR_NOTHING_TO_CLAIM)
    })
  })

  describe('getJurorShare(address _juror)', () => {
    context('with jurors active', () => {
      beforeEach(async () => {
        await activateJurors()
      })

      it('estimates juror share correctly with term 1 as checkpoint', async () => {
        await setCheckpointUsedToTerm(1)

        const { feeToken: tokenAddress, jurorShare } = await subscriptions.getJurorShare(jurorPeriod0Term1)

        assert.equal(tokenAddress, feeToken.address, 'fee token address does not match')
        assertBn(jurorShare, DONATED_FEES, 'juror share fees does not match')
      })

      it('estimates previously registered juror share correctly with term 3 as checkpoint', async () => {
        await setCheckpointUsedToTerm(3)
        const expectedTotalActiveBalance = jurorPeriod0Term1Balance.add(jurorPeriod0Term3Balance)
        const expectedShareFees = DONATED_FEES.mul(jurorPeriod0Term1Balance).div(expectedTotalActiveBalance)

        const { feeToken: tokenAddress, jurorShare } = await subscriptions.getJurorShare(jurorPeriod0Term1)

        assert.equal(tokenAddress, feeToken.address, 'fee token address does not match')
        assertBn(jurorShare, expectedShareFees, 'juror share fees does not match')
      })

      it('estimates juror share correctly with term 3 as checkpoint', async () => {
        await setCheckpointUsedToTerm(3)
        const expectedTotalActiveBalance = jurorPeriod0Term1Balance.add(jurorPeriod0Term3Balance)
        const expectedShareFees = DONATED_FEES.mul(jurorPeriod0Term3Balance).div(expectedTotalActiveBalance)

        const { feeToken: tokenAddress, jurorShare } = await subscriptions.getJurorShare(jurorPeriod0Term3)

        assert.equal(tokenAddress, feeToken.address, 'fee token address does not match')
        assertBn(jurorShare, expectedShareFees, 'juror share fees does not match')
      })

      it('estimates juror share correctly after a claim has occurred', async () => {
        await setCheckpointUsedToTerm(3)
        const expectedTotalActiveBalance = jurorPeriod0Term1Balance.add(jurorPeriod0Term3Balance)
        const expectedShareFees = DONATED_FEES.mul(jurorPeriod0Term3Balance).div(expectedTotalActiveBalance)
        await subscriptions.claimFees({ from: jurorPeriod0Term1 })

        const { feeToken: tokenAddress, jurorShare } = await subscriptions.getJurorShare(jurorPeriod0Term3)

        assert.equal(tokenAddress, feeToken.address, 'fee token address does not match')
        assertBn(jurorShare, expectedShareFees, 'juror share fees does not match')
      })
    })

    it('estimates juror share correctly when not active', async () => {
      const { feeToken: tokenAddress, jurorShare } = await subscriptions.getJurorShare(jurorPeriod0Term1)

      assert.equal(tokenAddress, feeToken.address, 'fee token address does not match')
      assertBn(jurorShare, 0, 'juror share fees does not match')
    })

    it('reverts when called before first period', async () => {
      await controller.mockSetTerm(1)

      await assertRevert(subscriptions.claimFees({ from: jurorPeriod0Term1 }), SUBSCRIPTIONS_ERRORS.STILL_PERIOD_ZERO)
    })
  })

  describe('getCurrentPeriodId()', () => {
    it('reverts when term is 0', async () => {
      await controller.mockSetTerm(0)
      await assertRevert(subscriptions.getCurrentPeriodId(), 'CS_COURT_HAS_NOT_STARTED')
    })

    it('returns correct periodId at start of period 0', async () => {
      await controller.mockSetTerm(1)

      const periodId = await subscriptions.getCurrentPeriodId()

      assertBn(periodId, bn(0), 'Incorrect periodId')
    })

    it('returns correct periodId at start of period 1', async () => {
      await controller.mockSetTerm(PERIOD_DURATION + 1)

      const periodId = await subscriptions.getCurrentPeriodId()

      assertBn(periodId, bn(1), 'Incorrect periodId')
    })

    it('returns correct periodId at start of period 3', async () => {
      await controller.mockSetTerm((PERIOD_DURATION * 3) + 1)

      const periodId = await subscriptions.getCurrentPeriodId()

      assertBn(periodId, bn(3), 'Incorrect periodId')
    })
  })

  describe('getCurrentPeriod()', () => {
    beforeEach(async () => {
      await activateJurors()
    })

    it('gets correct period details with term 1 as checkpoint at period 0', async () => {
      await controller.mockSetTerm(2)
      const periodCheckpoint = 1
      await setCheckpointUsedToTerm(periodCheckpoint)

      const { periodBalanceCheckpoint, feeToken: periodFeeToken, totalActiveBalance, donatedFees } = await subscriptions.getCurrentPeriod()

      assertBn(periodBalanceCheckpoint, periodCheckpoint, 'checkpoint does not match')
      assert.equal(periodFeeToken, feeToken.address, 'fee token does not match')
      assertBn(totalActiveBalance, jurorPeriod0Term1Balance, 'total active balance does not match')
      assertBn(donatedFees, DONATED_FEES, 'donated fees does not match')
    })

    it('gets correct period details at period 1', async () => {
      await controller.mockSetTerm(PERIOD_DURATION + 1)
      const periodCheckpoint = PERIOD_DURATION + 1
      await setCheckpointUsedToTerm(periodCheckpoint)
      const expectedTotalActiveBalance = jurorPeriod0Term1Balance.add(jurorPeriod0Term3Balance)

      const { periodBalanceCheckpoint, feeToken: periodFeeToken, totalActiveBalance, donatedFees } = await subscriptions.getCurrentPeriod()

      assertBn(periodBalanceCheckpoint, periodCheckpoint, 'checkpoint does not match')
      assert.equal(periodFeeToken, feeToken.address, 'fee token does not match')
      assertBn(totalActiveBalance, expectedTotalActiveBalance, 'total active balance does not match')
      assertBn(donatedFees, DONATED_FEES, 'donated fees does not match')
    })
  })

  describe('getPeriod(uint256 _periodId)', () => {
    beforeEach(async () => {
      await activateJurors()
    })

    it('reverts when period is later than the current period', async () => {
      await controller.mockSetTerm(1) // Is in period 0
      await assertRevert(subscriptions.getPeriod(1), 'CS_FUTURE_PERIOD')
    })

    it('computes period details correctly with term 1 as checkpoint', async () => {
      const periodCheckpoint = 1
      await setCheckpointUsedToTerm(periodCheckpoint)

      const { periodBalanceCheckpoint, feeToken: periodFeeToken, totalActiveBalance, donatedFees } = await subscriptions.getPeriod(0)

      assertBn(periodBalanceCheckpoint, periodCheckpoint, 'checkpoint does not match')
      assert.equal(periodFeeToken, feeToken.address, 'fee token does not match')
      assertBn(totalActiveBalance, jurorPeriod0Term1Balance, 'total active balance does not match')
      assertBn(donatedFees, DONATED_FEES, 'donated fees does not match')
    })

    it('computes period details correctly with term 3 as checkpoint', async () => {
      const periodCheckpoint = 3
      await setCheckpointUsedToTerm(periodCheckpoint)
      const expectedTotalActiveBalance = jurorPeriod0Term1Balance.add(jurorPeriod0Term3Balance)

      const { periodBalanceCheckpoint, feeToken: periodFeeToken, totalActiveBalance, donatedFees } = await subscriptions.getPeriod(0)

      assertBn(periodBalanceCheckpoint, periodCheckpoint, 'checkpoint does not match')
      assert.equal(periodFeeToken, feeToken.address, 'fee token does not match')
      assertBn(totalActiveBalance, expectedTotalActiveBalance, 'total active balance does not match')
      assertBn(donatedFees, DONATED_FEES, 'donated fees does not match')
    })

    it('computes period details correctly with term 3 as checkpoint after claim', async () => {
      const periodCheckpoint = 3
      await setCheckpointUsedToTerm(periodCheckpoint)
      const expectedTotalActiveBalance = jurorPeriod0Term1Balance.add(jurorPeriod0Term3Balance)
      await subscriptions.claimFees({ from: jurorPeriod0Term1 })

      const { periodBalanceCheckpoint, feeToken: periodFeeToken, totalActiveBalance, donatedFees } = await subscriptions.getPeriod(0)

      assertBn(periodBalanceCheckpoint, periodCheckpoint, 'checkpoint does not match')
      assert.equal(periodFeeToken, feeToken.address, 'fee token does not match')
      assertBn(totalActiveBalance, expectedTotalActiveBalance, 'total active balance does not match')
      assertBn(donatedFees, DONATED_FEES, 'donated fees does not match')
    })
  })

  describe('hasJurorClaimed(address _juror)', () => {
    it('reverts when current period is 0', async () => {
      await controller.mockSetTerm(1) // Is in period 0
      await assertRevert(subscriptions.hasJurorClaimed(jurorPeriod0Term1), 'CS_STILL_PERIOD_ZERO')
    })
  })
})
