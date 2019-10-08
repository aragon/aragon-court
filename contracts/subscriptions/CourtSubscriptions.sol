pragma solidity ^0.5.8;

import "@aragon/os/contracts/lib/token/ERC20.sol";
import "@aragon/os/contracts/lib/math/SafeMath.sol";
import "@aragon/os/contracts/common/SafeERC20.sol";
import "@aragon/os/contracts/common/IsContract.sol";
import "@aragon/os/contracts/common/TimeHelpers.sol";
import "@aragon/os/contracts/common/Initializable.sol";

import "../lib/PctHelpers.sol";
import "../registry/IJurorsRegistry.sol";
import "../subscriptions/ISubscriptions.sol";
import "../subscriptions/ISubscriptionsOwner.sol";


contract CourtSubscriptions is TimeHelpers, Initializable, IsContract, ISubscriptions {
    using SafeERC20 for ERC20;
    using SafeMath for uint256;
    using PctHelpers for uint256;

    string private constant ERROR_OWNER_ALREADY_SET = "CS_OWNER_ALREADY_SET";
    string private constant ERROR_REGISTRY_NOT_CONTRACT = "CS_REGISTRY_NOT_CONTRACT";
    string private constant ERROR_SENDER_NOT_GOVERNOR = "CS_SENDER_NOT_GOVERNOR";
    string private constant ERROR_SENDER_NOT_SUBSCRIBED = "CS_SENDER_NOT_SUBSCRIBED";
    string private constant ERROR_GOVERNOR_SHARE_FEES_ZERO = "CS_GOVERNOR_SHARE_FEES_ZERO";
    string private constant ERROR_TOKEN_TRANSFER_FAILED = "CS_TOKEN_TRANSFER_FAILED";
    string private constant ERROR_PERIOD_DURATION_ZERO = "CS_PERIOD_DURATION_ZERO";
    string private constant ERROR_INVALID_FEE_AMOUNT = "CS_INVALID_FEE_AMOUNT";
    string private constant ERROR_FEE_AMOUNT_ZERO = "CS_FEE_AMOUNT_ZERO";
    string private constant ERROR_INVALID_FEE_TOKEN = "CS_INVALID_FEE_TOKEN";
    string private constant ERROR_FEE_TOKEN_NOT_CONTRACT = "CS_FEE_TOKEN_NOT_CONTRACT";
    string private constant ERROR_INVALID_PREPAYMENT_PERIODS = "CS_INVALID_PREPAYMENT_PERIODS";
    string private constant ERROR_PREPAYMENT_PERIODS_ZERO = "CS_PREPAYMENT_PERIODS_ZERO";
    string private constant ERROR_INVALID_GOVERNOR_SHARE_PCT = "CS_INVALID_GOVERNOR_SHARE_PCT";
    string private constant ERROR_OVERRATED_GOVERNOR_SHARE_PCT = "CS_OVERRATED_GOVERNOR_SHARE_PCT";
    string private constant ERROR_INVALID_LATE_PAYMENT_PENALTY_PCT = "CS_INVALID_LATE_PAYMENT_PENALTY";
    string private constant ERROR_RESUME_PRE_PAID_PERIODS_TOO_BIG = "CS_RESUME_PRE_PAID_PERIODS_BIG";
    string private constant ERROR_NON_PAST_PERIOD = "CS_NON_PAST_PERIOD";
    string private constant ERROR_JUROR_FEES_ALREADY_CLAIMED = "CS_JUROR_FEES_ALREADY_CLAIMED";
    string private constant ERROR_JUROR_NOTHING_TO_CLAIM = "CS_JUROR_NOTHING_TO_CLAIM";
    string private constant ERROR_PAYING_ZERO_PERIODS = "CS_PAYING_ZERO_PERIODS";
    string private constant ERROR_PAYING_TOO_MANY_PERIODS = "CS_PAYING_TOO_MANY_PERIODS";
    string private constant ERROR_LOW_RESUME_PERIODS_PAYMENT = "CS_LOW_RESUME_PERIODS_PAYMENT";

    // Term 0 is for jurors on-boarding
    uint64 internal constant START_TERM_ID = 1;

    struct Subscriber {
        bool subscribed;                        // Whether or not a user has been subscribed to the Court
        bool paused;                            // Whether or not a user has paused the Court subscriptions
        uint64 lastPaymentPeriodId;             // Identification number of the last period paid by a subscriber
        uint64 previousDelayedPeriods;          // Number of delayed periods before pausing
    }

    struct Period {
        uint64 balanceCheckpoint;               // Court term id of a period used to fetch the total active balance of the jurors registry
        ERC20 feeToken;                         // Fee token corresponding to a certain subscription period
        uint256 feeAmount;                      // Amount of fees paid for a certain subscription period
        uint256 totalActiveBalance;             // Total amount of juror tokens active in the Court at the corresponding period checkpoint
        uint256 collectedFees;                  // Total amount of subscription fees collected during a period
        mapping (address => bool) claimedFees;  // List of jurors that have claimed fees during a period, indexed by juror address
    }

    // Subscriptions owner address
    ISubscriptionsOwner internal owner;

    // Registry of jurors
    IJurorsRegistry internal jurorsRegistry;

    // Duration of a subscription period in Court terms
    uint64 internal periodDuration;

    // Per ten thousand of subscription fees that will be applied as penalty for not paying during proper period (‱ - 1/10,000)
    uint16 public latePaymentPenaltyPct;

    // Per ten thousand of subscription fees that will be allocated to the governor of the Court (‱ - 1/10,000)
    uint16 public governorSharePct;

    // ERC20 token used for the subscription fees
    ERC20 public currentFeeToken;

    // Amount of fees to be paid for each subscription period
    uint256 public currentFeeAmount;

    // Number of periods that can be paid in advance including the current period. Paying in advance has some drawbacks:
    // - Fee amount could increase, while pre-payments would be made with the old rate.
    // - Fees are distributed among jurors when the payment is made, so jurors activating after a pre-payment won't get their share of it.
    uint256 public prePaymentPeriods;

    // Number of periods a subscriber must pre-pay in order to resume his activity after pausing
    uint256 public resumePrePaidPeriods;

    // Total amount of fees accumulated for the governor of the Court
    uint256 public accumulatedGovernorFees;

    // List of subscribers indexed by address
    mapping (address => Subscriber) internal subscribers;

    // List of periods indexed by ID
    mapping (uint256 => Period) internal periods;

    event FeesPaid(address indexed subscriber, uint256 periods, uint256 newLastPeriodId, uint256 collectedFees, uint256 governorFee);
    event FeesClaimed(address indexed juror, uint256 indexed periodId, uint256 jurorShare);
    event GovernorFeesTransferred(uint256 amount);
    event FeeTokenChanged(address previousFeeToken, address currentFeeToken);
    event FeeAmountChanged(uint256 previousFeeAmount, uint256 currentFeeAmount);
    event PrePaymentPeriodsChanged(uint256 previousPrePaymentPeriods, uint256 currentPrePaymentPeriods);
    event GovernorSharePctChanged(uint16 previousGovernorSharePct, uint16 currentGovernorSharePct);
    event LatePaymentPenaltyPctChanged(uint16 previousLatePaymentPenaltyPct, uint16 currentLatePaymentPenaltyPct);
    event ResumePenaltiesChanged(uint256 previousResumePrePaidPeriods, uint256 currentResumePrePaidPeriods);

    /**
    * @dev Ensure the msg.sender is the governor of the Court
    */
    modifier onlyGovernor {
        require(msg.sender == owner.getGovernor(), ERROR_SENDER_NOT_GOVERNOR);
        _;
    }

    /**
    * @dev Initialize court subscriptions
    * @param _owner Address to be set as the owner of the court subscriptions
    * @param _jurorsRegistry Address of the JurorsRegistry component of the Court
    * @param _periodDuration Initial duration of a subscription period in Court terms
    * @param _feeToken Initial ERC20 token used for the subscription fees
    * @param _feeAmount Initial amount of fees to be paid for each subscription period
    * @param _prePaymentPeriods Initial number of periods that can be paid in advance including the current period
    * @param _resumePrePaidPeriods Initial number of periods a subscriber must pre-pay in order to resume his activity after pausing
    * @param _latePaymentPenaltyPct Initial per ten thousand of subscription fees that will be applied as penalty for not paying during proper period (‱ - 1/10,000)
    * @param _governorSharePct Initial per ten thousand of subscription fees that will be allocated to the governor of the Court (‱ - 1/10,000)
    */
    function init(
        ISubscriptionsOwner _owner,
        IJurorsRegistry _jurorsRegistry,
        uint64 _periodDuration,
        ERC20 _feeToken,
        uint256 _feeAmount,
        uint256 _prePaymentPeriods,
        uint256 _resumePrePaidPeriods,
        uint16 _latePaymentPenaltyPct,
        uint16 _governorSharePct
    )
        external
    {
        // TODO: cannot check the given owner is a contract cause the Court set this up in the constructor, move to a factory
        // require(isContract(_owner), ERROR_OWNER_NOT_CONTRACT);
        require(isContract(address(_jurorsRegistry)), ERROR_REGISTRY_NOT_CONTRACT);
        require(_periodDuration > 0, ERROR_PERIOD_DURATION_ZERO);

        initialized();

        owner = _owner;
        jurorsRegistry = _jurorsRegistry;
        periodDuration = _periodDuration;
        _setFeeToken(_feeToken);
        _setFeeAmount(_feeAmount);
        _setPrePaymentPeriods(_prePaymentPeriods);
        _setLatePaymentPenaltyPct(_latePaymentPenaltyPct);
        _setGovernorSharePct(_governorSharePct);
        _setResumePrePaidPeriods(_resumePrePaidPeriods);
    }

    /**
    * @notice Pay fees on behalf of `_from` for `_periods` periods
    * @param _from Subscriber whose subscription is being paid
    * @param _periods Number of periods to be paid in total since the last paid period
    */
    function payFees(address _from, uint256 _periods) external {
        require(_periods > 0, ERROR_PAYING_ZERO_PERIODS);

        Subscriber storage subscriber = subscribers[_from];
        uint256 currentPeriodId = _getCurrentPeriodId();
        Period storage period = periods[currentPeriodId];

        (ERC20 feeToken, uint256 feeAmount) = _ensurePeriodFeeTokenAndAmount(period);

        // Compute the total amount to pay by sender on behalf of the subscriber, including the penalties for delayed periods
        (uint256 amountToPay, uint256 newLastPeriodId) = _getPayFeesDetails(subscriber, _periods, currentPeriodId, feeAmount);

        // Compute the portion of the total amount to pay that will be allocated to the governor
        uint256 governorFee = amountToPay.pct(governorSharePct);
        accumulatedGovernorFees = accumulatedGovernorFees.add(governorFee);

        // Note that it is safe to avoid SafeMath here since the governor share cannot be above 100%. Thus, the highest governor fees we
        // could have is equal to the amount to be paid.
        uint256 collectedFees = amountToPay - governorFee;
        period.collectedFees = period.collectedFees.add(collectedFees);

        // Initialize subscription for the requested subscriber if it is the first time paying fees, or resume subscriptions if they were paused
        if (!subscriber.subscribed) {
            subscriber.subscribed = true;
        } else if (subscriber.paused) {
            subscriber.paused = false;
            subscriber.previousDelayedPeriods = 0;
        }

        // Periods are measured in Court terms. Since Court terms are represented in `uint64`, we are safe to use `uint64` for period ids too.
        subscriber.lastPaymentPeriodId = uint64(newLastPeriodId);

        // Deposit fee tokens from sender to this contract
        emit FeesPaid(_from, _periods, newLastPeriodId, collectedFees, governorFee);
        require(feeToken.safeTransferFrom(msg.sender, address(this), amountToPay), ERROR_TOKEN_TRANSFER_FAILED);
    }

    /**
    * @notice Claim proportional share fees for period `_periodId` owed to `msg.sender`
    * @param _periodId Identification number of the period which fees are claimed for
    */
    function claimFees(uint256 _periodId) external {
        // Juror share fees can only be claimed for past periods
        require(_periodId < _getCurrentPeriodId(), ERROR_NON_PAST_PERIOD);
        Period storage period = periods[_periodId];
        require(!period.claimedFees[msg.sender], ERROR_JUROR_FEES_ALREADY_CLAIMED);

        // Check claiming juror has share fees to be transferred
        (uint64 periodBalanceCheckpoint, uint256 totalActiveBalance) = _ensurePeriodBalanceDetails(_periodId, period);
        uint256 jurorShare = _getJurorShare(msg.sender, period, periodBalanceCheckpoint, totalActiveBalance);
        require(jurorShare > 0, ERROR_JUROR_NOTHING_TO_CLAIM);

        // Update juror state and transfer share fees
        period.claimedFees[msg.sender] = true;
        emit FeesClaimed(msg.sender, _periodId, jurorShare);
        require(period.feeToken.safeTransfer(msg.sender, jurorShare), ERROR_TOKEN_TRANSFER_FAILED);
    }

    /**
    * @notice Pause sender subscriptions
    */
    function pause() external {
        Subscriber storage subscriber = subscribers[msg.sender];
        require(subscriber.subscribed, ERROR_SENDER_NOT_SUBSCRIBED);

        subscriber.previousDelayedPeriods = uint64(_getDelayedPeriods(subscriber, _getCurrentPeriodId()));
        subscriber.paused = true;
    }

    /**
    * @notice Transfer owed fees to the governor
    */
    function transferFeesToGovernor() external {
        require(accumulatedGovernorFees > 0, ERROR_GOVERNOR_SHARE_FEES_ZERO);
        _transferFeesToGovernor();
    }

    /**
    * @notice Make sure that the balance details of a certain period have been computed
    * @param _periodId Identification number of the period being ensured
    * @return periodBalanceCheckpoint Court term id used to fetch the total active balance of the jurors registry
    * @return totalActiveBalance Total amount of juror tokens active in the Court at the corresponding used checkpoint
    */
    function ensurePeriodBalanceDetails(uint256 _periodId) external returns (uint64 periodBalanceCheckpoint, uint256 totalActiveBalance) {
        Period storage period = periods[_periodId];
        return _ensurePeriodBalanceDetails(_periodId, period);
    }

    /**
    * @notice Set new subscriptions fee amount to `_feeAmount`
    * @param _feeAmount New amount of fees to be paid for each subscription period
    */
    function setFeeAmount(uint256 _feeAmount) external onlyGovernor {
        _setFeeAmount(_feeAmount);
    }

    /**
    * @notice Set new subscriptions fee to `@tokenAmount(_feeToken, _feeAmount)`
    * @dev Accumulated fees owed to governor (if any) will be transferred
    * @param _feeToken New ERC20 token to be used for the subscription fees
    * @param _feeAmount New amount of fees to be paid for each subscription period
    */
    function setFeeToken(ERC20 _feeToken, uint256 _feeAmount) external onlyGovernor {
        _setFeeToken(_feeToken);
        // `setFeeToken` transfers governor's accumulated fees, so must be executed first
        _setFeeAmount(_feeAmount);
    }

    /**
    * @notice Set new number of pre payment to `_prePaymentPeriods` periods
    * @param _prePaymentPeriods New number of periods that can be paid in advance
    */
    function setPrePaymentPeriods(uint256 _prePaymentPeriods) external onlyGovernor {
        _setPrePaymentPeriods(_prePaymentPeriods);
    }

    /**
    * @notice Set new late payment penalty `_latePaymentPenaltyPct`‱ (1/10,000)
    * @param _latePaymentPenaltyPct New per ten thousand of subscription fees that will be applied as penalty for not paying during proper period
    */
    function setLatePaymentPenaltyPct(uint16 _latePaymentPenaltyPct) external onlyGovernor {
        _setLatePaymentPenaltyPct(_latePaymentPenaltyPct);
    }

    /**
    * @notice Set new governor share to `_governorSharePct`‱ (1/10,000)
    * @param _governorSharePct New per ten thousand of subscription fees that will be allocated to the governor of the Court (‱ - 1/10,000)
    */
    function setGovernorSharePct(uint16 _governorSharePct) external onlyGovernor {
        _setGovernorSharePct(_governorSharePct);
    }

    /**
    * @notice Set new resume pre-paid periods to `_resumePrePaidPeriods`
    * @param _resumePrePaidPeriods New number of periods a subscriber must pre-pay in order to resume his activity after pausing
    */
    function setResumePrePaidPeriods(uint256 _resumePrePaidPeriods) external onlyGovernor {
        _setResumePrePaidPeriods(_resumePrePaidPeriods);
    }

    /**
    * @dev Tell the address of the owner of the contract
    * @return Address of owner
    */
    function getOwner() external view returns (address) {
        return address(owner);
    }

    /**
    * @dev Tell whether a certain subscriber has paid all the fees up to current period or not
    * @param _subscriber Address of subscriber being checked
    * @return True if subscriber has paid all the fees up to current period, false otherwise
    */
    function isUpToDate(address _subscriber) external view returns (bool) {
        Subscriber storage subscriber = subscribers[_subscriber];
        return subscriber.subscribed && !subscriber.paused && subscriber.lastPaymentPeriodId >= _getCurrentPeriodId();
    }

    /**
    * @dev Tell the identification number of the current period
    * @return Identification number of the current period
    */
    function getCurrentPeriodId() external view returns (uint256) {
        return _getCurrentPeriodId();
    }

    /**
    * @dev Tell total active balance of the jurors registry at a random term during a certain period
    * @param _periodId Identification number of the period being queried
    * @return periodBalanceCheckpoint Court term id used to fetch the total active balance of the jurors registry
    * @return totalActiveBalance Total amount of juror tokens active in the Court at the corresponding used checkpoint
    */
    function getPeriodBalanceDetails(uint256 _periodId) external view returns (uint64 periodBalanceCheckpoint, uint256 totalActiveBalance) {
        return _getPeriodBalanceDetails(_periodId);
    }

    /**
    * @dev Tell information associated to a subscriber
    * @param _subscriber Address of the subscriber being queried
    * @return subscribed True if the given subscriber has already been subscribed to the Court, false otherwise
    * @return paused True if the given subscriber has paused the Court subscriptions, false otherwise
    * @return lastPaymentPeriodId Identification number of the last period paid by the given subscriber
    * @return previousDelayedPeriods Number of delayed periods the subscriber had before pausing
    */
    function getSubscriber(address _subscriber) external view
        returns (bool subscribed, bool paused, uint64 lastPaymentPeriodId, uint64 previousDelayedPeriods)
    {
        Subscriber storage subscriber = subscribers[_subscriber];
        subscribed = subscriber.subscribed;
        paused = subscriber.paused;
        lastPaymentPeriodId = subscriber.lastPaymentPeriodId;
        previousDelayedPeriods = subscriber.previousDelayedPeriods;
    }

    /**
    * @dev Tell the number of overdue payments for a given subscriber
    * @param _subscriber Address of the subscriber being checked
    * @return Number of overdue payments for the requested subscriber
    */
    function getDelayedPeriods(address _subscriber) external view returns (uint256) {
        Subscriber storage subscriber = subscribers[_subscriber];
        uint256 currentPeriodId = _getCurrentPeriodId();
        return _getDelayedPeriods(subscriber, currentPeriodId);
    }

    /**
    * @dev Tell the amount to pay and resulting last paid period for a given subscriber paying for a certain number of periods
    * @param _subscriber Address of the subscriber willing to pay
    * @param _periods Number of periods that would be paid
    * @return tokenAddress Address of the token used for the subscription fees
    * @return amountToPay Amount of subscription fee tokens to be paid
    * @return newLastPeriodId Identification number of the resulting last paid period
    */
    function getPayFeesDetails(address _subscriber, uint256 _periods) external view
        returns (address tokenAddress, uint256 amountToPay, uint256 newLastPeriodId)
    {
        Subscriber storage subscriber = subscribers[_subscriber];
        uint256 currentPeriodId = _getCurrentPeriodId();

        (ERC20 feeToken, uint256 feeAmount) = _getPeriodFeeTokenAndAmount(periods[currentPeriodId]);
        tokenAddress = address(feeToken);
        (amountToPay, newLastPeriodId) = _getPayFeesDetails(subscriber, _periods, currentPeriodId, feeAmount);
    }

    /**
    * @dev Tell the share fees corresponding to a juror for a certain period
    * @param _juror Address of the juror querying the owed shared fees of
    * @param _periodId Identification number of the period being queried
    * @return feeToken Address of the token used for the subscription fees
    * @return jurorShare Amount of share fees owed to the given juror for the requested period
    */
    function getJurorShare(address _juror, uint256 _periodId) external view returns (ERC20 feeToken, uint256 jurorShare) {
        Period storage period = periods[_periodId];
        uint64 periodBalanceCheckpoint;
        uint256 totalActiveBalance = period.totalActiveBalance;

        // Compute period balance details if they were not ensured yet
        if (totalActiveBalance == 0) {
            (periodBalanceCheckpoint, totalActiveBalance) = _getPeriodBalanceDetails(_periodId);
        } else {
            periodBalanceCheckpoint = period.balanceCheckpoint;
        }

        // Compute juror share fees using the period balance details
        jurorShare = _getJurorShare(_juror, period, periodBalanceCheckpoint, totalActiveBalance);
        (feeToken,) = _getPeriodFeeTokenAndAmount(period);
    }

    /**
    * @dev Check if a given juror has already claimed the owed share fees for a certain period
    * @param _juror Address of the juror being queried
    * @param _periodId Identification number of the period being queried
    * @return True if the owed share fees have already been claimed, false otherwise
    */
    function hasJurorClaimed(address _juror, uint256 _periodId) external view returns (bool) {
        return periods[_periodId].claimedFees[_juror];
    }

    /**
    * @dev Internal function to transfer owed fees to the governor. This function assumes there are some accumulated fees to be transferred.
    */
    function _transferFeesToGovernor() internal {
        uint256 amount = accumulatedGovernorFees;
        accumulatedGovernorFees = 0;
        emit GovernorFeesTransferred(amount);
        require(currentFeeToken.safeTransfer(owner.getGovernor(), amount), ERROR_TOKEN_TRANSFER_FAILED);
    }

    /**
    * @dev Internal function to make sure the fee token address and amount of a certain period have been cached
    * @param _period Period being ensured to have cached its fee token address and amount
    * @return feeToken ERC20 token to be used for the subscription fees during the given period
    * @return feeAmount Amount of fees to be paid during the given period
    */
    function _ensurePeriodFeeTokenAndAmount(Period storage _period) internal returns (ERC20 feeToken, uint256 feeAmount) {
        // Use current fee token address and amount for the given period if these haven't been set yet
        feeToken = _period.feeToken;
        if (feeToken == ERC20(0)) {
            feeToken = currentFeeToken;
            _period.feeToken = feeToken;
            _period.feeAmount = currentFeeAmount;
        }
        feeAmount = _period.feeAmount;
    }

    /**
    * @dev Internal function to make sure that the balance details of a certain period have been computed. This function assumes given ID and
    *      period correspond to each other.
    * @param _periodId Identification number of the period being ensured
    * @param _period Period being ensured
    * @return periodBalanceCheckpoint Court term id used to fetch the total active balance of the jurors registry
    * @return totalActiveBalance Total amount of juror tokens active in the Court at the corresponding used checkpoint
    */
    function _ensurePeriodBalanceDetails(uint256 _periodId, Period storage _period) internal
        returns (uint64 periodBalanceCheckpoint, uint256 totalActiveBalance)
    {
        totalActiveBalance = _period.totalActiveBalance;

        // Set balance details for the given period if these haven't been set yet
        if (totalActiveBalance == 0) {
            (periodBalanceCheckpoint, totalActiveBalance) = _getPeriodBalanceDetails(_periodId);
            _period.balanceCheckpoint = periodBalanceCheckpoint;
            _period.totalActiveBalance = totalActiveBalance;
        } else {
            periodBalanceCheckpoint = _period.balanceCheckpoint;
        }
    }

    /**
    * @dev Internal function to set a new amount for the subscription fees
    * @param _feeAmount New amount of fees to be paid for each subscription period
    */
    function _setFeeAmount(uint256 _feeAmount) internal {
        require(_feeAmount > 0, ERROR_FEE_AMOUNT_ZERO);

        emit FeeAmountChanged(currentFeeAmount, _feeAmount);
        currentFeeAmount = _feeAmount;
    }

    /**
    * @dev Internal function to set a new ERC20 token for the subscription fees
    * @param _feeToken New ERC20 token to be used for the subscription fees
    */
    function _setFeeToken(ERC20 _feeToken) internal {
        require(isContract(address(_feeToken)), ERROR_FEE_TOKEN_NOT_CONTRACT);

        if (accumulatedGovernorFees > 0) {
            _transferFeesToGovernor();
        }
        emit FeeTokenChanged(address(currentFeeToken), address(_feeToken));
        currentFeeToken = _feeToken;
    }

    /**
    * @dev Internal function to set a new number of pre payment periods
    * @param _prePaymentPeriods New number of periods that can be paid in advance including the current period
    */
    function _setPrePaymentPeriods(uint256 _prePaymentPeriods) internal {
        // The pre payments period number must contemplate the current period. Thus, it must be greater than zero.
        require(_prePaymentPeriods > 0, ERROR_PREPAYMENT_PERIODS_ZERO);
        // It must be also greater than or equal to the number of resume pre-paid periods since these are always paid in advance, and we must
        // make sure there won't be users covering too many periods in the future to avoid skipping fee changes or excluding many jurors from
        // their corresponding rewards.
        require(_prePaymentPeriods >= resumePrePaidPeriods, ERROR_RESUME_PRE_PAID_PERIODS_TOO_BIG);

        emit PrePaymentPeriodsChanged(prePaymentPeriods, _prePaymentPeriods);
        prePaymentPeriods = _prePaymentPeriods;
    }

    /**
    * @dev Internal function to set new late payment penalty `_latePaymentPenaltyPct`‱ (1/10,000)
    * @param _latePaymentPenaltyPct New per ten thousand of subscription fees that will be applied as penalty for not paying during proper period
    */
    function _setLatePaymentPenaltyPct(uint16 _latePaymentPenaltyPct) internal {
        emit LatePaymentPenaltyPctChanged(latePaymentPenaltyPct, _latePaymentPenaltyPct);
        latePaymentPenaltyPct = _latePaymentPenaltyPct;
    }

    /**
    * @dev Internal function to set a new governor share value
    * @param _governorSharePct New per ten thousand of subscription fees that will be allocated to the governor of the Court (‱ - 1/10,000)
    */
    function _setGovernorSharePct(uint16 _governorSharePct) internal {
        // Check governor share is not greater than 10,000‱
        require(PctHelpers.isValid(_governorSharePct), ERROR_OVERRATED_GOVERNOR_SHARE_PCT);

        emit GovernorSharePctChanged(governorSharePct, _governorSharePct);
        governorSharePct = _governorSharePct;
    }

    /**
    * @dev Internal function to set new number of resume pre-paid periods
    * @param _resumePrePaidPeriods New number of periods a subscriber must pre-pay in order to resume his activity after pausing
    */
    function _setResumePrePaidPeriods(uint256 _resumePrePaidPeriods) internal {
        // Check resume resume pre-paid periods it not above the number of allowed pre payment periods. Since these periods are always paid in
        // advance, we must make sure there won't be users covering too many periods in the future to avoid skipping fee changes or
        // excluding many jurors from their corresponding rewards
        require(_resumePrePaidPeriods <= prePaymentPeriods, ERROR_RESUME_PRE_PAID_PERIODS_TOO_BIG);

        emit ResumePenaltiesChanged(resumePrePaidPeriods, _resumePrePaidPeriods);
        resumePrePaidPeriods = _resumePrePaidPeriods;
    }

    /**
    * @dev Internal function to tell the identification number of the current period
    * @return Identification number of the current period
    */
    function _getCurrentPeriodId() internal view returns (uint256) {
        // Since the Court starts at term #1, and the first subscription period is #0, then subtract one unit to the current term of the Court
        return uint256(owner.getCurrentTermId()).sub(START_TERM_ID) / periodDuration;
    }

    /**
    * @dev Internal function to get the Court term in which a certain period starts
    * @param _periodId Identification number of the period querying the start term of
    * @return Court term where the given period starts
    */
    function _getPeriodStartTermId(uint256 _periodId) internal view returns (uint64) {
        // Periods are measured in Court terms. Since Court terms are represented in `uint64`, we are safe to use `uint64` for period ids too.
        return START_TERM_ID + uint64(_periodId) * periodDuration;
    }

    /**
    * @dev Internal function to get the fee token address and amount to be used for a certain period
    * @param _period Period querying the token address and amount of
    * @return feeToken ERC20 token to be used for the subscription fees during the given period
    * @return feeAmount Amount of fees to be paid during the given period
    */
    function _getPeriodFeeTokenAndAmount(Period storage _period) internal view returns (ERC20 feeToken, uint256 feeAmount) {
        // Return current fee token address and amount if these haven't been set for the given period yet
        feeToken = _period.feeToken;
        if (feeToken == ERC20(0)) {
            feeToken = currentFeeToken;
            feeAmount = currentFeeAmount;
        } else {
            feeAmount = _period.feeAmount;
        }
    }

    /**
    * @dev Internal function to compute the total amount of fees to be paid for the subscriber based on a requested number of periods
    * @param _subscriber Subscriber willing to pay
    * @param _periods Number of periods that would be paid
    * @param _currentPeriodId Identification number of the current period
    * @param _feeAmount Amount of fees to be paid for each subscription period
    * @return amountToPay Amount of subscription fee tokens to be paid
    * @return newLastPeriodId Identification number of the resulting last paid period
    */
    function _getPayFeesDetails(Subscriber storage _subscriber, uint256 _periods, uint256 _currentPeriodId, uint256 _feeAmount) internal view
        returns (uint256 amountToPay, uint256 newLastPeriodId)
    {
        uint256 regularPeriods = 0;
        uint256 delayedPeriods = 0;
        uint256 resumePeriods = 0;
        (newLastPeriodId, regularPeriods, delayedPeriods, resumePeriods) = _getPayingPeriodsDetails(_subscriber, _periods, _currentPeriodId);

        // Regular periods to be paid is equal to `(regularPeriods + resumePeriods) * _feeAmount`
        uint256 regularPayment = (regularPeriods.add(resumePeriods)).mul(_feeAmount);
        // Delayed periods to be paid is equal to `delayedPeriods * _feeAmount * (1 + latePaymentPenaltyPct) / PCT_BASE`
        uint256 delayedPayment = delayedPeriods.mul(_feeAmount).pctIncrease(latePaymentPenaltyPct);
        // Compute total amount to be paid
        amountToPay = regularPayment.add(delayedPayment);
    }

    /**
    * @dev Internal function to compute the total number of different periods a subscriber has to pay based on a requested number of periods
    *
    *    subs      last           paused           current                new last
    *   +----+----+----+----+----+------+----+----+-------+----+----+----+--------+
    *                  <--------->                <-----------------><------------>
    *                    delayed                       regular       resumed
    *
    * @param _subscriber Subscriber willing to pay
    * @param _periods Number of periods that would be paid
    * @param _currentPeriodId Identification number of the current period
    * @return newLastPeriodId Identification number of the resulting last paid period
    * @return regularPeriods Number of periods to be paid without penalties
    * @return delayedPeriods Number of periods to be paid applying the delayed penalty
    * @return resumePeriods Number of periods to be paid applying the resume penalty
    */
    function _getPayingPeriodsDetails(Subscriber storage _subscriber, uint256 _periods, uint256 _currentPeriodId) internal view
        returns (uint256 newLastPeriodId, uint256 regularPeriods, uint256 delayedPeriods, uint256 resumePeriods)
    {
        uint256 lastPaymentPeriodId = _subscriber.lastPaymentPeriodId;

        // Check if the subscriber has already been subscribed
        if (!_subscriber.subscribed) {
            // If the subscriber was not subscribed before, there are no delayed nor resumed periods
            resumePeriods = 0;
            delayedPeriods = 0;
            regularPeriods = _periods;
            // The number of periods to be paid includes the current period, thus we subtract one unit.
            // Note that there is no need to use SafeMath here since the number of periods is at least one.
            newLastPeriodId = _currentPeriodId + _periods - 1;
        } else {
            uint256 totalDelayedPeriods = _getDelayedPeriods(_subscriber, _currentPeriodId);
            // Resume a subscription only if it was paused and the previous last period is overdue by more than one period
            if (_subscriber.paused && lastPaymentPeriodId + 1 < _currentPeriodId) {
                // If the subscriber is resuming his activity he must pay the pre-paid periods penalty and the previous delayed periods
                resumePeriods = resumePrePaidPeriods;
                delayedPeriods = totalDelayedPeriods;
                require(_periods >= resumePeriods + delayedPeriods, ERROR_LOW_RESUME_PERIODS_PAYMENT);

                // Note that there is no need to use SafeMath here since we already checked the number of given and resume periods
                regularPeriods = _periods - resumePeriods - delayedPeriods;
                // The new last period is computed including the current period
                // Note that there is no need to use SafeMath here since the number of periods is at least one
                newLastPeriodId = _currentPeriodId + _periods - 1;
            } else {
                // If the subscriber does not need to resume his activity, there are no resume periods, last period is simply updated
                resumePeriods = 0;
                newLastPeriodId = lastPaymentPeriodId + _periods;

                // Compute the number of regular and delayed periods to be paid
                if (totalDelayedPeriods > _periods) {
                    // Non regular periods, all periods being paid are delayed ones
                    regularPeriods = 0;
                    delayedPeriods = _periods;
                } else {
                    // Note that there is no need to use SafeMath here, we already checked the total number of delayed periods
                    regularPeriods = _periods - totalDelayedPeriods;
                    delayedPeriods = totalDelayedPeriods;
                }
            }
        }

        // If the subscriber is paying some periods in advance, check it doesn't reach the pre-payment limit
        if (newLastPeriodId > _currentPeriodId) {
            require(newLastPeriodId.sub(_currentPeriodId) < prePaymentPeriods, ERROR_PAYING_TOO_MANY_PERIODS);
        }
    }

    /**
    * @dev Internal function to tell the number of overdue payments for a given subscriber
    * @param _subscriber Subscriber querying the delayed periods of
    * @param _currentPeriodId Identification number of the current period
    * @return Number of overdue payments for the requested subscriber
    */
    function _getDelayedPeriods(Subscriber storage _subscriber, uint256 _currentPeriodId) internal view returns (uint256) {
        // If the given subscriber was not subscribed yet, there are no pending payments
        if (!_subscriber.subscribed) {
            return 0;
        }

        // If the given subscriber was paused, return the delayed periods before pausing
        if (_subscriber.paused) {
            return _subscriber.previousDelayedPeriods;
        }

        // If the given subscriber is subscribed and not paused but is up-to-date, return 0
        uint256 lastPaymentPeriodId = _subscriber.lastPaymentPeriodId;
        if (lastPaymentPeriodId >= _currentPeriodId) {
            return 0;
        }

        // If the given subscriber was already subscribed, then the current period is not considered delayed
        // Note that there is no need to use SafeMath here since we already know last payment period is before current period
        return _currentPeriodId - lastPaymentPeriodId - 1;
    }

    /**
    * @dev Internal function to get the total active balance of the jurors registry at a random term during a period
    * @param _periodId Identification number of the period being queried
    * @return periodBalanceCheckpoint Court term id used to fetch the total active balance of the jurors registry
    * @return totalActiveBalance Total amount of juror tokens active in the Court at the corresponding used checkpoint
    */
    function _getPeriodBalanceDetails(uint256 _periodId) internal view returns (uint64 periodBalanceCheckpoint, uint256 totalActiveBalance) {
        uint64 periodStartTermId = _getPeriodStartTermId(_periodId);
        uint64 nextPeriodStartTermId = _getPeriodStartTermId(_periodId + 1);

        // Pick a random Court term during the next period of the requested one to get the total amount of juror tokens active in the Court
        bytes32 randomness = owner.getTermRandomness(nextPeriodStartTermId);

        // The randomness factor for each Court term is computed using the the hash of a block number set during the initialization of the
        // term, to ensure it cannot be known beforehand. Note that the hash function being used only works for the 256 most recent block
        // numbers. Therefore, if that occurs we use the hash of the previous block number. This could be slightly beneficial for the first juror
        // calling this function, but it's still impossible to predict during the requested period.
        if (randomness == bytes32(0)) {
            randomness = blockhash(getBlockNumber() - 1);
        }

        // Use randomness to choose a Court term of the requested period and query the total amount of juror tokens active at that term
        // Note that there is no need to use SafeMath here since terms are represented in `uint64`
        periodBalanceCheckpoint = periodStartTermId + uint64(uint256(randomness) % periodDuration);
        totalActiveBalance = jurorsRegistry.totalActiveBalanceAt(periodBalanceCheckpoint);
    }

    /**
    * @dev Internal function to tell the share fees corresponding to a juror for a certain period
    * @param _juror Address of the juror querying the owed shared fees of
    * @param _period Period being queried
    * @param _periodBalanceCheckpoint Court term id used to fetch the active balance of the juror for the requested period
    * @param _totalActiveBalance Total amount of juror tokens active in the Court at the corresponding used checkpoint
    * @return Amount of share fees owed to the given juror for the requested period
    */
    function _getJurorShare(address _juror, Period storage _period, uint64 _periodBalanceCheckpoint, uint256 _totalActiveBalance) internal view
        returns (uint256)
    {
        // Fetch juror active balance at the checkpoint used for the requested period
        uint256 jurorActiveBalance = jurorsRegistry.activeBalanceOfAt(_juror, _periodBalanceCheckpoint);
        if (jurorActiveBalance == 0) {
            return 0;
        }

        // Note that we already checked the juror active balance is greater than zero, then, the total active balance must be greater than zero.
        return _period.collectedFees.mul(jurorActiveBalance) / _totalActiveBalance;
    }
}
