pragma solidity ^0.4.24; // TODO: pin solc

import "./standards/subscription/ISubscription.sol";
import "./standards/subscription/ISubscriptionOwner.sol";
import "./standards/sumtree/ISumTree.sol";

import "@aragon/os/contracts/lib/token/ERC20.sol";
import "@aragon/os/contracts/common/SafeERC20.sol";
import "@aragon/os/contracts/lib/math/SafeMath.sol";


contract Subscription is ISubscription {
    using SafeERC20 for ERC20;
    using SafeMath for uint256;

    uint16 internal constant PCT_BASE = 10000; // ‱

    string internal constant ERROR_NOT_OWNER = "SUB_NOT_OWNER";
    string internal constant ERROR_OWNER_ALREADY_SET = "SUB_OWNER_ALREADY_SET";
    string internal constant ERROR_TOKEN_TRANSFER_FAILED = "SUB_TOKEN_TRANSFER_FAILED";
    string internal constant ERROR_ZERO_PERIOD_DURATION = "SUB_ZERO_PERIOD_DURATION";
    string internal constant ERROR_ZERO_FEE = "SUB_ZERO_FEE";
    string internal constant ERROR_ZERO_PREPAYMENT_PERIODS = "SUB_ZERO_PREPAYMENT_PERIODS";
    string internal constant ERROR_INVALID_PERIOD = "SUB_INVALID_PERIOD";
    string internal constant ERROR_NOTHING_TO_CLAIM = "SUB_NOTHING_TO_CLAIM";
    string internal constant ERROR_PAY_ZERO_PERIODS = "SUB_PAY_ZERO_PERIODS";
    string internal constant ERROR_TOO_MANY_PERIODS = "SUB_TOO_MANY_PERIODS";

    struct Organization {
        uint256 lastPaymentPeriodId;
    }

    struct Period {
        uint64 balanceCheckpoint;
        uint256 totalTreeSum;
        uint256 collectedFees;
    }

    ISubscriptionOwner internal owner;
    ISumTree internal sumTree;
    uint64 internal startTermId;
    uint64 internal periodDuration; // in Court terms
    uint16 public latePaymentPenaltyPct; // ‱ of penalty applied for not paying during proper period
    uint16 public governorSharePct; // ‱ of fees that go to governor of the Court
    ERC20 public feeToken;
    // How many periods can be paid in advance (includes current period, so it must be at least 1).
    // Although paying in advance seems a good thing from the Court perspective,
    // it has some drawbacks too, so it's good to limit it to diminish them:
    // - Fees distribution among jurors take place when the payment is made, so jurors activating after a pre-payment wouldn't get their share of it.
    // - Fee amount could increase, while pre-payments would be made with the old rate.
    uint256 public prePaymentPeriods;
    uint256 public feeAmount;
    uint256 internal accumulatedGovernorFees;
    mapping (address => Organization) internal organizations;
    mapping (uint256 => Period) internal periods;

    event FeesPaid(address indexed organization, uint256 periods, uint256 newLastPeriodId, uint256 collectedFees, uint256 governorFee);
    event FeesClaimed(address indexed juror, uint256 indexed periodId, uint256 jurorShare);
    event GovernorSharesTransferred(uint256 amount);

    modifier onlyOwner {
        require(msg.sender == address(owner), ERROR_NOT_OWNER);
        _;
    }

    /**
     * @dev This can be frontrunned, and ownership stolen, but the Court will notice,
     *      because its call to this function will revert
     */
    function init(
        ISubscriptionOwner _owner,
        ISumTree _sumTree,
        uint64 _startTermId,
        uint64 _periodDuration,
        ERC20 _feeToken,
        uint256 _feeAmount,
        uint256 _prePaymentPeriods,
        uint16 _latePaymentPenaltyPct,
        uint16 _governorSharePct
    )
        external
    {
        require(address(owner) == address(0), ERROR_OWNER_ALREADY_SET);
        require(_periodDuration > 0, ERROR_ZERO_PERIOD_DURATION);

        owner = _owner;
        sumTree = _sumTree;
        startTermId = _startTermId; // Court should set this to > 0, as term 0 is for jurors onboarding
        periodDuration = _periodDuration;
        feeToken = _feeToken;
        _setFeeAmount(_feeAmount);
        _setPrePaymentPeriods(_prePaymentPeriods);
        latePaymentPenaltyPct = _latePaymentPenaltyPct;
        governorSharePct = _governorSharePct;
    }

    function payFees(address _from, uint256 _periods) external {
        require(_periods > 0, ERROR_PAY_ZERO_PERIODS);

        Organization storage organization = organizations[_from];
        uint256 currentPeriodId = _getCurrentPeriodId();
        uint256 nextPaymentPeriodId = organization.lastPaymentPeriodId + 1;

        uint256 delayedPeriods = 0;
        uint256 regularPeriods = 0;
        // periodId 0 is reserved to signal non-subscribed organizations
        if (nextPaymentPeriodId == 1) {
            // not yet subscribed orgs can't have pending payments
            regularPeriods = _periods;
        } else {
            // check for pending payments
            if (currentPeriodId > nextPaymentPeriodId) {
                delayedPeriods = currentPeriodId - nextPaymentPeriodId;
            }
            // if there are more pending payments than requested to pay, adjust them
            if (delayedPeriods > _periods) {
                delayedPeriods = _periods;
                // regular periods will therefore be zero, as all to be paid periods are past ones
            } else { // otherwise the rest are regular payments
                regularPeriods = _periods - delayedPeriods;
            }
        }

        // don't allow to pay too many periods in advance (see comments in declaration section)
        uint256 newLastPeriodId = nextPaymentPeriodId + regularPeriods - 1;
        require(newLastPeriodId <= prePaymentPeriods, ERROR_TOO_MANY_PERIODS);

        // total amount to pay by sender (on behalf of org), including penalties for delayed periods
        uint256 amountToPay = _pct4Increase(delayedPeriods.mul(feeAmount), latePaymentPenaltyPct).add(regularPeriods.mul(feeAmount));
        // governor fee
        uint256 governorFee = _pct4(amountToPay, governorSharePct);
        accumulatedGovernorFees += governorFee;
        // amount collected for the current period to share among jurors
        uint256 collectedFees = amountToPay - governorFee;

        organization.lastPaymentPeriodId = newLastPeriodId;
        periods[currentPeriodId].collectedFees += collectedFees;

        // transfer tokens
        require(feeToken.safeTransferFrom(msg.sender, address(this), amountToPay), ERROR_TOKEN_TRANSFER_FAILED);

        emit FeesPaid(_from, _periods, newLastPeriodId, collectedFees, governorFee);
    }

    function isUpToDate(address _organization) external view returns (bool) {
        return organizations[_organization].lastPaymentPeriodId >= _getCurrentPeriodId();
    }

    function claimFees(uint256 _periodId) external {
        // periodId 0 is reserved to signal non-subscribed organizations
        require(_periodId > 0 && _periodId < _getCurrentPeriodId(), ERROR_INVALID_PERIOD);

        Period storage period = periods[_periodId];
        uint64 periodBalanceCheckpoint = period.balanceCheckpoint;

        // it's first time fees are claimed for this period
        if (periodBalanceCheckpoint == 0) {
            uint64 periodStartTermId = _getPeriodStartTermId(_periodId);
            uint64 nextPeriodStartTermId = _getPeriodStartTermId(_periodId + 1);
            bytes32 randomness = owner.getTermRandomness(nextPeriodStartTermId);
            // if randomness was not calculated on first 256 blocks of the term, it will be zero
            // in that case we just get the previous block for it, as we'll have the hash for sure
            // it could be slightly beneficial for the first juror calling this function,
            // but it's still impossible to predict during the period
            if (randomness == bytes32(0)) {
                randomness = blockhash(block.number - 1);
            }
            periodBalanceCheckpoint = periodStartTermId + uint64(uint256(randomness) % periodDuration);

            // set period's variables
            period.balanceCheckpoint = periodBalanceCheckpoint;
            period.totalTreeSum = sumTree.totalSumPast(periodBalanceCheckpoint);
        }

        // get balance and total at checkpoint
        uint256 sumTreeId = owner.getAccountSumTreeId(msg.sender);
        uint256 jurorBalance = sumTree.getItemPast(sumTreeId, periodBalanceCheckpoint);
        require(jurorBalance > 0, ERROR_NOTHING_TO_CLAIM);
        // it can't happen that total sum is zero if juror's balance is not

        // juror fee share
        uint256 jurorShare = period.collectedFees.mul(jurorBalance) / period.totalTreeSum;

        require(feeToken.safeTransfer(msg.sender, jurorShare), ERROR_TOKEN_TRANSFER_FAILED);

        emit FeesClaimed(msg.sender, _periodId, jurorShare);
    }

    function transferFeesToGovernor() external {
        uint256 amount = accumulatedGovernorFees;
        accumulatedGovernorFees = 0;
        require(feeToken.safeTransfer(owner.getGovernor(), amount), ERROR_TOKEN_TRANSFER_FAILED);

        emit GovernorSharesTransferred(amount);
    }

    function setFeeAmount(uint256 _feeAmount) external onlyOwner {
        _setFeeAmount(_feeAmount);
    }

    function setFeeToken(ERC20 _feeToken) external onlyOwner {
        feeToken = _feeToken;
    }

    function setPrePaymentPeriods(uint256 _prePaymentPeriods) external onlyOwner {
        _setPrePaymentPeriods(_prePaymentPeriods);
    }

    function setLatePaymentPenaltyPct(uint16 _latePaymentPenaltyPct) external onlyOwner {
        latePaymentPenaltyPct = _latePaymentPenaltyPct;
    }

    function setGovernorSharePct(uint16 _governorSharePct) external onlyOwner {
        governorSharePct = _governorSharePct;
    }

    function getOwner() external view returns (address) {
        return owner;
    }

    function _setFeeAmount(uint256 _feeAmount) internal {
        require(_feeAmount > 0, ERROR_ZERO_FEE);
        feeAmount = _feeAmount;
    }

    function _setPrePaymentPeriods(uint256 _prePaymentPeriods) internal {
        // zero wouldn't allow to pay for current period
        require(_prePaymentPeriods > 0, ERROR_ZERO_PREPAYMENT_PERIODS);
        prePaymentPeriods = _prePaymentPeriods;
    }

    function _getCurrentPeriodId() internal view returns (uint256) {
        // periodId 0 is reserved to signal non-subscribed organizations
        return (owner.getCurrentTermId() - startTermId) / periodDuration + 1;
    }

    function _getPeriodStartTermId(uint256 _periodId) internal view returns (uint64) {
        // periodId 0 is reserved to signal non-subscribed organizations
        require(_periodId > 0, ERROR_INVALID_PERIOD);
        return startTermId + uint64(_periodId - 1) * periodDuration;
    }

    function _pct4(uint256 _number, uint16 _pct) internal pure returns (uint256) {
        return _number * uint256(_pct) / uint256(PCT_BASE);
    }

    function _pct4Increase(uint256 _number, uint16 _pct) internal pure returns (uint256) {
        return _number * uint256(PCT_BASE + _pct) / uint256(PCT_BASE);
    }
}
