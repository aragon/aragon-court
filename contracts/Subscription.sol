pragma solidity ^0.4.24; // TODO: pin solc

import "@aragon/os/contracts/lib/token/ERC20.sol";
import "@aragon/os/contracts/common/SafeERC20.sol";
import "@aragon/os/contracts/common/IsContract.sol";
import "@aragon/os/contracts/lib/math/SafeMath.sol";

import "./standards/subscription/ISubscription.sol";
import "./standards/subscription/ISubscriptionOwner.sol";
import "./standards/sumtree/ISumTree.sol";


contract Subscription is IsContract, ISubscription {
    using SafeERC20 for ERC20;
    using SafeMath for uint256;

    uint256 internal constant PCT_BASE = 10000; // ‱
    uint64 internal constant START_TERM_ID = 1; // term 0 is for jurors onboarding

    string internal constant ERROR_NOT_GOVERNOR = "SUB_NOT_GOVERNOR";
    string internal constant ERROR_OWNER_ALREADY_SET = "SUB_OWNER_ALREADY_SET";
    string internal constant ERROR_ZERO_TRANSFER = "SUB_ZERO_TRANSFER";
    string internal constant ERROR_TOKEN_TRANSFER_FAILED = "SUB_TOKEN_TRANSFER_FAILED";
    string internal constant ERROR_ZERO_PERIOD_DURATION = "SUB_ZERO_PERIOD_DURATION";
    string internal constant ERROR_ZERO_FEE = "SUB_ZERO_FEE";
    string internal constant ERROR_NOT_CONTRACT = "SUB_NOT_CONTRACT";
    string internal constant ERROR_ZERO_PREPAYMENT_PERIODS = "SUB_ZERO_PREPAYMENT_PERIODS";
    string internal constant ERROR_INVALID_PERIOD = "SUB_INVALID_PERIOD";
    string internal constant ERROR_ALREADY_CLAIMED = "SUB_ALREADY_CLAIMED";
    string internal constant ERROR_NOTHING_TO_CLAIM = "SUB_NOTHING_TO_CLAIM";
    string internal constant ERROR_PAY_ZERO_PERIODS = "SUB_PAY_ZERO_PERIODS";
    string internal constant ERROR_TOO_MANY_PERIODS = "SUB_TOO_MANY_PERIODS";

    struct Subscriber {
        bool subscribed;
        uint64 lastPaymentPeriodId;
    }

    struct Period {
        uint64 balanceCheckpoint;
        ERC20 feeToken; // cached to keep consistency after changes of the global variable
        uint256 feeAmount;
        uint256 totalTreeSum;
        uint256 collectedFees;
        mapping (address  => bool) claimedFees; // tracks claimed fees by jurors for each period
    }

    ISubscriptionOwner internal owner;
    ISumTree internal sumTree;
    uint64 internal periodDuration; // in Court terms
    uint16 public latePaymentPenaltyPct; // ‱ of penalty applied for not paying during proper period
    uint16 public governorSharePct; // ‱ of fees that go to governor of the Court
    ERC20 public currentFeeToken;
    // How many periods can be paid in advance (includes current period, so it must be at least 1).
    // Although paying in advance seems a good thing from the Court perspective,
    // it has some drawbacks too, so it's good to limit it to diminish them:
    // - Fees distribution among jurors take place when the payment is made, so jurors activating after a pre-payment wouldn't get their share of it.
    // - Fee amount could increase, while pre-payments would be made with the old rate.
    uint256 public prePaymentPeriods;
    uint256 public currentFeeAmount;
    uint256 public accumulatedGovernorFees;
    mapping (address => Subscriber) internal subscribers;
    mapping (uint256 => Period) internal periods;

    event FeesPaid(address indexed subscriber, uint256 periods, uint256 newLastPeriodId, uint256 collectedFees, uint256 governorFee);
    event FeesClaimed(address indexed juror, uint256 indexed periodId, uint256 jurorShare);
    event GovernorFeesTransferred(uint256 amount);

    modifier onlyGovernor {
        require(msg.sender == owner.getGovernor(), ERROR_NOT_GOVERNOR);
        _;
    }

    /**
     * @dev This can be frontrunned, and ownership stolen, but the Court will notice,
     *      because its call to this function will revert
     */
    function init(
        ISubscriptionOwner _owner,
        ISumTree _sumTree,
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
        periodDuration = _periodDuration;
        _setFeeToken(_feeToken);
        _setFeeAmount(_feeAmount);
        _setPrePaymentPeriods(_prePaymentPeriods);
        latePaymentPenaltyPct = _latePaymentPenaltyPct;
        governorSharePct = _governorSharePct;
    }

    /**
     * @notice Pay fees on behalf of `_from` for `_periods` periods
     * @param _from Subscriber whose subscription is being paid
     * @param _periods Number of periods to be paid in total (delayed plus regular)
     * @dev This is a graphical explanation of a generic case:
     *
     *  subs      last           cur       new
     * +----+----+----+----+----+----+----+----+
     *                <---------><------------->
     *                  delayed      regular
     *                <------------------------>
     *                        _periods
     */
    function payFees(address _from, uint256 _periods) external {
        require(_periods > 0, ERROR_PAY_ZERO_PERIODS);

        Subscriber storage subscriber = subscribers[_from];
        uint256 currentPeriodId = _getCurrentPeriodId();
        Period storage period = periods[currentPeriodId];

        (ERC20 feeToken, uint256 feeAmount) = _ensurePeriodFeeTokenAndAmount(period);

        // total amount to pay by sender (on behalf of org), including penalties for delayed periods
        (uint256 amountToPay, uint256 newLastPeriodId) = _getPayFeesDetails(subscriber, _periods, currentPeriodId, feeAmount);
        // governor fee
        uint256 governorFee = _pct4(amountToPay, governorSharePct);
        accumulatedGovernorFees += governorFee;
        // amount collected for the current period to share among jurors
        uint256 collectedFees = amountToPay - governorFee;

        subscriber.lastPaymentPeriodId = uint64(newLastPeriodId);
        if (!subscriber.subscribed) {
            subscriber.subscribed = true;
        }
        period.collectedFees += collectedFees;

        // transfer tokens
        require(feeToken.safeTransferFrom(msg.sender, address(this), amountToPay), ERROR_TOKEN_TRANSFER_FAILED);

        emit FeesPaid(_from, _periods, newLastPeriodId, collectedFees, governorFee);
    }

    function isUpToDate(address _subscriber) external view returns (bool) {
        Subscriber storage subscriber = subscribers[_subscriber];
        return subscriber.subscribed && subscriber.lastPaymentPeriodId >= _getCurrentPeriodId();
    }

    function claimFees(uint256 _periodId) external {
        require(_periodId < _getCurrentPeriodId(), ERROR_INVALID_PERIOD);
        Period storage period = periods[_periodId];
        require(!period.claimedFees[msg.sender], ERROR_ALREADY_CLAIMED);

        (uint64 periodBalanceCheckpoint, uint256 totalTreeSum) = _ensurePeriodBalanceCheckpoint(_periodId, period);

        uint256 jurorShare = _getJurorShare(msg.sender, period, periodBalanceCheckpoint, totalTreeSum);
        require(jurorShare > 0, ERROR_NOTHING_TO_CLAIM);

        period.claimedFees[msg.sender] = true;

        require(period.feeToken.safeTransfer(msg.sender, jurorShare), ERROR_TOKEN_TRANSFER_FAILED);

        emit FeesClaimed(msg.sender, _periodId, jurorShare);
    }

    function setFeeAmount(uint256 _feeAmount) external onlyGovernor {
        _setFeeAmount(_feeAmount);
    }

    function setFeeToken(ERC20 _feeToken, uint256 _feeAmount) external onlyGovernor {
        // setFeeToken empties governor accumulated fees, so must be run first
        _setFeeToken(_feeToken);
        _setFeeAmount(_feeAmount);
    }

    function setPrePaymentPeriods(uint256 _prePaymentPeriods) external onlyGovernor {
        _setPrePaymentPeriods(_prePaymentPeriods);
    }

    function setLatePaymentPenaltyPct(uint16 _latePaymentPenaltyPct) external onlyGovernor {
        latePaymentPenaltyPct = _latePaymentPenaltyPct;
    }

    function setGovernorSharePct(uint16 _governorSharePct) external onlyGovernor {
        governorSharePct = _governorSharePct;
    }

    function ensurePeriodBalanceCheckpoint(uint256 _periodId) external returns (uint64, uint256) {
        Period storage period = periods[_periodId];
        return _ensurePeriodBalanceCheckpoint(_periodId, period);
    }

    function getOwner() external view returns (address) {
        return owner;
    }

    function getDelayedPeriods(address _subscriberAddress) external view returns (uint256) {
        Subscriber storage subscriber = subscribers[_subscriberAddress];
        uint256 currentPeriodId = _getCurrentPeriodId();
        uint256 lastPaymentPeriodId = subscriber.lastPaymentPeriodId;

        if (!subscriber.subscribed || lastPaymentPeriodId >= currentPeriodId) {
            // not yet subscribed orgs can't have pending payments
            return 0;
        } else {
            return currentPeriodId - lastPaymentPeriodId - 1;
        }
    }

    function getPayFeesDetails(address _from, uint256 _periods) external view returns (uint256 amountToPay, uint256 newLastPeriodId) {
        Subscriber storage subscriber = subscribers[_from];
        uint256 currentPeriodId = _getCurrentPeriodId();

        (, uint256 feeAmount) = _getPeriodFeeTokenAndAmount(periods[currentPeriodId]);
        // total amount to pay by sender (on behalf of org), including penalties for delayed periods
        (amountToPay, newLastPeriodId) = _getPayFeesDetails(subscriber, _periods, currentPeriodId, feeAmount);

    }

    function getJurorShare(address _juror, uint256 _periodId) external view returns (uint256 jurorShare) {
        Period storage period = periods[_periodId];
        uint64 periodBalanceCheckpoint;
        uint256 totalTreeSum = period.totalTreeSum;
        if (totalTreeSum == 0) {
            (periodBalanceCheckpoint, totalTreeSum) = _getPeriodBalanceDetails(_periodId);
        } else {
            periodBalanceCheckpoint = period.balanceCheckpoint;
        }

        jurorShare = _getJurorShare(_juror, period, periodBalanceCheckpoint, totalTreeSum);
    }

    function hasJurorClaimed(address _juror, uint256 _periodId) external view returns (bool) {
        return periods[_periodId].claimedFees[_juror];
    }

    function transferFeesToGovernor() public {
        uint256 amount = accumulatedGovernorFees;
        require(amount > 0, ERROR_ZERO_TRANSFER);
        accumulatedGovernorFees = 0;
        require(currentFeeToken.safeTransfer(owner.getGovernor(), amount), ERROR_TOKEN_TRANSFER_FAILED);

        emit GovernorFeesTransferred(amount);
    }

    function _setFeeAmount(uint256 _feeAmount) internal {
        require(_feeAmount > 0, ERROR_ZERO_FEE);
        currentFeeAmount = _feeAmount;
    }

    function _setFeeToken(ERC20 _feeToken) internal {
        require(isContract(_feeToken), ERROR_NOT_CONTRACT);
        if (accumulatedGovernorFees > 0) {
            transferFeesToGovernor();
        }
        currentFeeToken = _feeToken;
    }

    function _setPrePaymentPeriods(uint256 _prePaymentPeriods) internal {
        // zero wouldn't allow to pay for current period
        require(_prePaymentPeriods > 0, ERROR_ZERO_PREPAYMENT_PERIODS);
        prePaymentPeriods = _prePaymentPeriods;
    }

    function _ensurePeriodFeeTokenAndAmount(Period storage _period) internal returns (ERC20 feeToken, uint256 feeAmount) {
        (feeToken, feeAmount) = _getPeriodFeeTokenAndAmount(_period);
        if (_period.feeToken == address(0)) {
            _period.feeToken = feeToken;
            _period.feeAmount = feeAmount;
        }
    }

    function _ensurePeriodBalanceCheckpoint(uint256 _periodId, Period storage _period) internal returns (uint64 periodBalanceCheckpoint, uint256 totalTreeSum) {
        totalTreeSum = _period.totalTreeSum;

        // it's first time fees are claimed for this period
        if (totalTreeSum == 0) {
            (periodBalanceCheckpoint, totalTreeSum) = _getPeriodBalanceDetails(_periodId);
            // set period's variables
            _period.balanceCheckpoint = periodBalanceCheckpoint;
            _period.totalTreeSum = totalTreeSum;
        } else {
            periodBalanceCheckpoint = _period.balanceCheckpoint;
        }
    }

    function _getCurrentPeriodId() internal view returns (uint256) {
        return (owner.getCurrentTermId() - START_TERM_ID) / periodDuration;
    }

    function _getPeriodStartTermId(uint256 _periodId) internal view returns (uint64) {
        return START_TERM_ID + uint64(_periodId) * periodDuration;
    }

    function _getPeriodFeeTokenAndAmount(Period storage _period) internal view returns (ERC20 feeToken, uint256 feeAmount) {
        // if payFees has not been called for this period, these variables have not been set yet, so we get the global current ones
        if (_period.feeToken == address(0)) {
            feeToken = currentFeeToken;
            feeAmount = currentFeeAmount;
        } else {
            feeToken = _period.feeToken;
            feeAmount = _period.feeAmount;
        }
    }

    function _getPayFeesDetails(
        Subscriber storage _subscriber,
        uint256 _periods,
        uint256 _currentPeriodId,
        uint256 _feeAmount
    )
        internal
        view
        returns (uint256 amountToPay, uint256 newLastPeriodId)
    {
        uint256 lastPaymentPeriodId = _subscriber.lastPaymentPeriodId;

        uint256 delayedPeriods = 0;
        uint256 regularPeriods = 0;
        if (!_subscriber.subscribed) {
            // not yet subscribed orgs can't have pending payments
            regularPeriods = _periods;
        } else {
            // check for pending payments
            if (_currentPeriodId > lastPaymentPeriodId + 1) {
                delayedPeriods = _currentPeriodId - lastPaymentPeriodId - 1;
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
        newLastPeriodId = lastPaymentPeriodId + delayedPeriods + regularPeriods;
        require(newLastPeriodId - _currentPeriodId < prePaymentPeriods, ERROR_TOO_MANY_PERIODS);

        amountToPay = _pct4Increase(delayedPeriods.mul(_feeAmount), latePaymentPenaltyPct).add(regularPeriods.mul(_feeAmount));
    }

    function _getPeriodBalanceDetails(uint256 _periodId) internal view returns (uint64 periodBalanceCheckpoint, uint256 totalTreeSum) {
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
        totalTreeSum = sumTree.totalSumPast(periodBalanceCheckpoint);
    }

    function _getJurorShare(address _juror, Period storage _period, uint64 _periodBalanceCheckpoint, uint256 _totalTreeSum) internal view returns (uint256) {
        // get balance and total at checkpoint
        uint256 sumTreeId = owner.getAccountSumTreeId(_juror);
        uint256 jurorBalance = sumTree.getItemPast(sumTreeId, _periodBalanceCheckpoint);

        if (jurorBalance == 0) {
            return 0;
        }
        // it can't happen that total sum is zero if juror's balance is not

        // juror fee share
        return _period.collectedFees.mul(jurorBalance) / _totalTreeSum;
    }

    function _pct4(uint256 _number, uint16 _pct) internal pure returns (uint256) {
        return _number * uint256(_pct) / PCT_BASE;
    }

    function _pct4Increase(uint256 _number, uint16 _pct) internal pure returns (uint256) {
        return _number * (PCT_BASE + uint256(_pct)) / PCT_BASE;
    }
}
