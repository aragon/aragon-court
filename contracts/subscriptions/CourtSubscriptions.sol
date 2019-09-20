pragma solidity ^0.5.8;

import "@aragon/os/contracts/lib/token/ERC20.sol";
import "@aragon/os/contracts/common/SafeERC20.sol";
import "@aragon/os/contracts/common/IsContract.sol";
import "@aragon/os/contracts/lib/math/SafeMath.sol";
import "@aragon/os/contracts/common/TimeHelpers.sol";

import "../lib/PctHelpers.sol";
import "../registry/IJurorsRegistry.sol";
import "../subscriptions/ISubscriptions.sol";
import "../subscriptions/ISubscriptionsOwner.sol";


contract CourtSubscriptions is IsContract, ISubscriptions, TimeHelpers {
    using SafeERC20 for ERC20;
    using SafeMath for uint256;
    using PctHelpers for uint256;

    uint64 internal constant START_TERM_ID = 1; // term 0 is for jurors onboarding

    string internal constant ERROR_NOT_GOVERNOR = "SUB_NOT_GOVERNOR";
    string internal constant ERROR_OWNER_ALREADY_SET = "SUB_OWNER_ALREADY_SET";
    string internal constant ERROR_ZERO_TRANSFER = "SUB_ZERO_TRANSFER";
    string internal constant ERROR_TOKEN_TRANSFER_FAILED = "SUB_TOKEN_TRANSFER_FAILED";
    string internal constant ERROR_ZERO_PERIOD_DURATION = "SUB_ZERO_PERIOD_DURATION";
    string internal constant ERROR_ZERO_FEE = "SUB_ZERO_FEE";
    string internal constant ERROR_NOT_CONTRACT = "SUB_NOT_CONTRACT";
    string internal constant ERROR_ZERO_PREPAYMENT_PERIODS = "SUB_ZERO_PREPAYMENT_PERIODS";
    string internal constant ERROR_OVERFLOW = "SUB_OVERFLOW";
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
        uint256 totalActiveBalance;
        uint256 collectedFees;
        mapping (address => bool) claimedFees; // tracks claimed fees by jurors for each period
    }

    ISubscriptionsOwner internal owner;
    IJurorsRegistry internal jurorsRegistry;
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
        ISubscriptionsOwner _owner,
        IJurorsRegistry _jurorsRegistry,
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
        jurorsRegistry = _jurorsRegistry;
        periodDuration = _periodDuration;
        _setFeeToken(_feeToken);
        _setFeeAmount(_feeAmount);
        _setPrePaymentPeriods(_prePaymentPeriods);
        latePaymentPenaltyPct = _latePaymentPenaltyPct;
        _setGovernorSharePct(_governorSharePct);
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
        // as _periods and feeAmount are > 0, amountToPay will be > 0 and newLastPeriod > subscriber.lastPaymentPeriodId
        uint256 governorFee = amountToPay.pct(governorSharePct);
        accumulatedGovernorFees += governorFee;

        // amount collected for the current period to share among jurors
        uint256 collectedFees = amountToPay - governorFee; // as governorSharePct <= PCT_BASE, governorFee should be <= amountToPay
        period.collectedFees += collectedFees;

        if (!subscriber.subscribed) {
            subscriber.subscribed = true;
        }
        subscriber.lastPaymentPeriodId = uint64(newLastPeriodId);

        // transfer tokens
        require(feeToken.safeTransferFrom(msg.sender, address(this), amountToPay), ERROR_TOKEN_TRANSFER_FAILED);

        emit FeesPaid(_from, _periods, newLastPeriodId, collectedFees, governorFee);
    }

    /**
     * @notice Check if `subscriber` has paid all fees up to current period
     * @param _subscriber Address of subscriber to check
     * @return True if subscriber has paid all fees up to current period
     */
    function isUpToDate(address _subscriber) external view returns (bool) {
        Subscriber storage subscriber = subscribers[_subscriber];
        return subscriber.subscribed && subscriber.lastPaymentPeriodId >= _getCurrentPeriodId();
    }

    /**
     * @notice Claim proportional fee share for period `_periodId` owed to `msg.sender`
     * @param _periodId Period which fees are claimed for
     */
    function claimFees(uint256 _periodId) external {
        require(_periodId < _getCurrentPeriodId(), ERROR_INVALID_PERIOD);
        Period storage period = periods[_periodId];
        require(!period.claimedFees[msg.sender], ERROR_ALREADY_CLAIMED);

        (uint64 periodBalanceCheckpoint, uint256 totalActiveBalance) = _ensurePeriodBalanceDetails(_periodId, period);

        uint256 jurorShare = _getJurorShare(msg.sender, period, periodBalanceCheckpoint, totalActiveBalance);
        require(jurorShare > 0, ERROR_NOTHING_TO_CLAIM);

        period.claimedFees[msg.sender] = true;

        require(period.feeToken.safeTransfer(msg.sender, jurorShare), ERROR_TOKEN_TRANSFER_FAILED);

        emit FeesClaimed(msg.sender, _periodId, jurorShare);
    }

    /**
     * @notice Set new fee amount to `_feeAmount`
     * @param _feeAmount New fee amount
     */
    function setFeeAmount(uint256 _feeAmount) external onlyGovernor {
        _setFeeAmount(_feeAmount);
    }

    /**
     * @notice Set new fee token to `_feeToken` and new fee amount to `_feeAmount`
     * @dev Accumulated fees owed to governor (if any) will be transferred
     * @param _feeToken New fee token
     * @param _feeAmount New fee amount
     */
    function setFeeToken(ERC20 _feeToken, uint256 _feeAmount) external onlyGovernor {
        // setFeeToken empties governor accumulated fees, so must be run first
        _setFeeToken(_feeToken);
        _setFeeAmount(_feeAmount);
    }

    /**
     * @notice Set new allowed max pre-payment periods value to `_prePaymentPeriods`
     * @param _prePaymentPeriods New max pre-payment periods value
     */
    function setPrePaymentPeriods(uint256 _prePaymentPeriods) external onlyGovernor {
        _setPrePaymentPeriods(_prePaymentPeriods);
    }

    /**
     * @notice Set new late payment penalty ‱ to `_latePaymentPenaltyPct`
     * @param _latePaymentPenaltyPct New late payment penalty ‱
     */
    function setLatePaymentPenaltyPct(uint16 _latePaymentPenaltyPct) external onlyGovernor {
        latePaymentPenaltyPct = _latePaymentPenaltyPct;
    }

    /**
     * @notice Set new governor fee share ‱ to `_governorSharePct`
     * @param _governorSharePct New governor fee share ‱
     */
    function setGovernorSharePct(uint16 _governorSharePct) external onlyGovernor {
        _setGovernorSharePct(_governorSharePct);
    }

    /**
     * @notice Make sure that balance details (checkpoint and total sum) are cached for period `_periodId`
     * @param _periodId Period id for the request
     * @return Checkpoint for taking balances for the period
     * @return Total active balance in the jurors registry for the period
     */
    function ensurePeriodBalanceDetails(uint256 _periodId) external returns (uint64, uint256) {
        Period storage period = periods[_periodId];
        return _ensurePeriodBalanceDetails(_periodId, period);
    }

    /**
     * @notice Get contract owner
     * @dev Implementing ISubscriptionsOwner
     * @return Address of owner
     */
    function getOwner() external view returns (address) {
        return address(owner);
    }

    /**
     * @notice Get number of overdue payments for subscriber `_subscriberAddress`
     * @param _subscriberAddress Subscriber to check
     * @return Number of overdue payments for subscriber
     */
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

    /**
     * @notice Get amount to pay and resulting last paid period for subscriber `_from` if paying for `_periods` periods
     * @param _from Subscriber being checked
     * @param _periods Periods that would be paid
     * @return Address of the token used to pay fees
     * @return Amount to pay
     * @return Resulting last paid period
     */
    function getPayFeesDetails(
        address _from,
        uint256 _periods
    )
        external
        view
        returns (address tokenAddress, uint256 amountToPay, uint256 newLastPeriodId)
    {
        Subscriber storage subscriber = subscribers[_from];
        uint256 currentPeriodId = _getCurrentPeriodId();

        (ERC20 feeToken, uint256 feeAmount) = _getPeriodFeeTokenAndAmount(periods[currentPeriodId]);
        tokenAddress = address(feeToken);

        // total amount to pay by sender (on behalf of org), including penalties for delayed periods
        (amountToPay, newLastPeriodId) = _getPayFeesDetails(subscriber, _periods, currentPeriodId, feeAmount);
    }

    /**
     * @notice Get fee share corresponding to `_juror` for period `_periodId`
     * @param _juror Address which fees are owed to
     * @param _periodId Period of the request
     * @return Address of the token
     * @return Amount owed
     */
    function getJurorShare(address _juror, uint256 _periodId) external view returns (address tokenAddress, uint256 jurorShare) {
        Period storage period = periods[_periodId];
        uint64 periodBalanceCheckpoint;
        uint256 totalActiveBalance = period.totalActiveBalance;
        if (totalActiveBalance == 0) {
            (periodBalanceCheckpoint, totalActiveBalance) = _getPeriodBalanceDetails(_periodId);
        } else {
            periodBalanceCheckpoint = period.balanceCheckpoint;
        }

        jurorShare = _getJurorShare(_juror, period, periodBalanceCheckpoint, totalActiveBalance);

        (ERC20 feeToken,) = _getPeriodFeeTokenAndAmount(period);
        tokenAddress = address(feeToken);
    }

    /**
     * @notice Check if `_juror` has already claimed owed fees for period `_periodId`
     * @param _juror Address being checked
     * @param _periodId Period of the request
     * @return True if fess were already claimed
     */
    function hasJurorClaimed(address _juror, uint256 _periodId) external view returns (bool) {
        return periods[_periodId].claimedFees[_juror];
    }

    /**
     * @notice Transfer owed fees to governor
     */
    function transferFeesToGovernor() public {
        require(accumulatedGovernorFees > 0, ERROR_ZERO_TRANSFER);

        uint256 amount = accumulatedGovernorFees;
        accumulatedGovernorFees = 0;
        require(currentFeeToken.safeTransfer(owner.getGovernor(), amount), ERROR_TOKEN_TRANSFER_FAILED);

        emit GovernorFeesTransferred(amount);
    }

    function _setFeeAmount(uint256 _feeAmount) internal {
        require(_feeAmount > 0, ERROR_ZERO_FEE);
        currentFeeAmount = _feeAmount;
    }

    function _setFeeToken(ERC20 _feeToken) internal {
        require(isContract(address(_feeToken)), ERROR_NOT_CONTRACT);
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

    function _setGovernorSharePct(uint16 _governorSharePct) internal {
        require(PctHelpers.isValid(_governorSharePct), ERROR_OVERFLOW);
        governorSharePct = _governorSharePct;
    }

    function _ensurePeriodFeeTokenAndAmount(Period storage _period) internal returns (ERC20 feeToken, uint256 feeAmount) {
        // if payFees has not been called for this period, these variables have not been set yet, so we get the global current ones
        feeToken = _period.feeToken;
        if (feeToken == ERC20(0)) {
            feeToken = currentFeeToken;
            _period.feeToken = feeToken;
            _period.feeAmount = currentFeeAmount;
        }
        feeAmount = _period.feeAmount;
    }

    function _ensurePeriodBalanceDetails(
        uint256 _periodId,
        Period storage _period
    )
        internal
        returns (uint64 periodBalanceCheckpoint, uint256 totalActiveBalance)
    {
        totalActiveBalance = _period.totalActiveBalance;

        // it's first time fees are claimed for this period
        if (totalActiveBalance == 0) {
            (periodBalanceCheckpoint, totalActiveBalance) = _getPeriodBalanceDetails(_periodId);
            // set period's variables
            _period.balanceCheckpoint = periodBalanceCheckpoint;
            _period.totalActiveBalance = totalActiveBalance;
        } else {
            periodBalanceCheckpoint = _period.balanceCheckpoint;
        }
    }

    function _getCurrentPeriodId() internal view returns (uint256) {
        return uint256(owner.getCurrentTermId()).sub(START_TERM_ID) / periodDuration;
    }

    function _getPeriodStartTermId(uint256 _periodId) internal view returns (uint64) {
        return START_TERM_ID + uint64(_periodId) * periodDuration;
    }

    function _getPeriodFeeTokenAndAmount(Period storage _period) internal view returns (ERC20 feeToken, uint256 feeAmount) {
        // if payFees has not been called for this period, these variables have not been set yet, so we get the global current ones
        feeToken = _period.feeToken;
        if (feeToken == ERC20(0)) {
            feeToken = currentFeeToken;
            feeAmount = currentFeeAmount;
        } else {
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
            newLastPeriodId = _currentPeriodId + _periods - 1;
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
            newLastPeriodId = lastPaymentPeriodId + _periods;
        }

        // don't allow to pay too many periods in advance (see comments in declaration section)
        require(newLastPeriodId <= _currentPeriodId || newLastPeriodId.sub(_currentPeriodId) < prePaymentPeriods, ERROR_TOO_MANY_PERIODS);

        // delayedPeriods * _feeAmount * (1 +  latePaymentPenaltyPct/PCT_BASE) + regularPeriods * _feeAmount
        amountToPay = delayedPeriods.mul(_feeAmount).pctIncrease(latePaymentPenaltyPct).add(regularPeriods.mul(_feeAmount));
    }

    function _getPeriodBalanceDetails(uint256 _periodId) internal view returns (uint64 periodBalanceCheckpoint, uint256 totalActiveBalance) {
        uint64 periodStartTermId = _getPeriodStartTermId(_periodId);
        uint64 nextPeriodStartTermId = _getPeriodStartTermId(_periodId + 1);

        // A Court term during the previous period is selected randomly and it is used as the checkpoint for distributing the fees collected during the period
        bytes32 randomness = owner.getTermRandomness(nextPeriodStartTermId);
        // if randomness was not calculated on first 256 blocks of the term, it will be zero
        // in that case we just get the previous block for it, as we'll have the hash for sure
        // it could be slightly beneficial for the first juror calling this function,
        // but it's still impossible to predict during the period
        if (randomness == bytes32(0)) {
            randomness = blockhash(getBlockNumber() - 1);
        }

        // use randomness to choose checkpoint
        periodBalanceCheckpoint = periodStartTermId + uint64(uint256(randomness) % periodDuration);
        totalActiveBalance = jurorsRegistry.totalActiveBalanceAt(periodBalanceCheckpoint);
    }

    function _getJurorShare(
        address _juror,
        Period storage _period,
        uint64 _periodBalanceCheckpoint,
        uint256 _totalActiveBalance
    )
        internal
        view
        returns (uint256)
    {
        // get balance at checkpoint
        uint256 jurorActiveBalance = jurorsRegistry.activeBalanceOfAt(_juror, _periodBalanceCheckpoint);
        if (jurorActiveBalance == 0) {
            return 0;
        }
        // Invariant: If the jurorActiveBalance is greater than 0, the totalSum must be greater than 0 as well

        // juror fee share
        return _period.collectedFees.mul(jurorActiveBalance) / _totalActiveBalance;
    }
}
