pragma solidity ^0.5.8;

import "../lib/os/ERC20.sol";
import "../lib/os/SafeMath.sol";
import "../lib/os/SafeMath64.sol";
import "../lib/os/SafeERC20.sol";
import "../lib/os/TimeHelpers.sol";

import "../lib/PctHelpers.sol";
import "../registry/IJurorsRegistry.sol";
import "../court/controller/Controller.sol";
import "../court/controller/ControlledRecoverable.sol";


contract CourtSubscriptions is ControlledRecoverable, TimeHelpers {
    using SafeERC20 for ERC20;
    using SafeMath for uint256;
    using SafeMath64 for uint64;
    using PctHelpers for uint256;

    string private constant ERROR_TOKEN_TRANSFER_FAILED = "CS_TOKEN_TRANSFER_FAILED";
    string private constant ERROR_PERIOD_DURATION_ZERO = "CS_PERIOD_DURATION_ZERO";
    string private constant ERROR_FEE_TOKEN_NOT_CONTRACT = "CS_FEE_TOKEN_NOT_CONTRACT";
    string private constant ERROR_NON_PAST_PERIOD = "CS_NON_PAST_PERIOD";
    string private constant ERROR_JUROR_FEES_ALREADY_CLAIMED = "CS_JUROR_FEES_ALREADY_CLAIMED";
    string private constant ERROR_JUROR_NOTHING_TO_CLAIM = "CS_JUROR_NOTHING_TO_CLAIM";
    string private constant ERROR_COURT_HAS_NOT_STARTED = "CS_COURT_HAS_NOT_STARTED";

    // Term 0 is for jurors on-boarding
    uint64 internal constant START_TERM_ID = 1;

    struct Subscriber {
        bool subscribed;                        // Whether or not a user has been subscribed to the Court
        bool paused;                            // Whether or not a user has paused the Court subscriptions
        uint64 lastPaymentPeriodId;             // Identification number of the last period paid by a subscriber
        uint64 previousDelayedPeriods;          // Number of delayed periods before pausing
    }

    struct Period {
        uint64 balanceCheckpoint;               // Court term ID of a period used to fetch the total active balance of the jurors registry
        ERC20 feeToken;                         // Fee token corresponding to a certain subscription period
        uint256 feeAmount;                      // Amount of fees paid for a certain subscription period
        uint256 totalActiveBalance;             // Total amount of juror tokens active in the Court at the corresponding period checkpoint
        uint256 collectedFees;                  // Total amount of subscription fees collected during a period
        mapping (address => bool) claimedFees;  // List of jurors that have claimed fees during a period, indexed by juror address
    }

    // Duration of a subscription period in Court terms
    uint64 public periodDuration;

    // ERC20 token used for the subscription fees
    ERC20 public currentFeeToken;

    // Amount of fees to be paid for each subscription period
    uint256 public currentFeeAmount;

    // List of subscribers indexed by address
    mapping (address => Subscriber) internal subscribers;

    // List of periods indexed by ID
    mapping (uint256 => Period) internal periods;

    event FeesClaimed(address indexed juror, uint256 indexed periodId, uint256 jurorShare);
    event FeeTokenChanged(address previousFeeToken, address currentFeeToken);

    /**
    * @dev Initialize court subscriptions
    * @param _controller Address of the controller
    * @param _periodDuration Duration of a subscription period in Court terms
    * @param _feeToken Initial ERC20 token used for the subscription fees
    */
    constructor(Controller _controller, uint64 _periodDuration, ERC20 _feeToken)
        ControlledRecoverable(_controller) public
    {
        // No need to explicitly call `Controlled` constructor since `ControlledRecoverable` is already doing it
        require(_periodDuration > 0, ERROR_PERIOD_DURATION_ZERO);
        periodDuration = _periodDuration;
        _setFeeToken(_feeToken);
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
    * @notice Make sure that the balance details of a certain period have been computed
    * @param _periodId Identification number of the period being ensured
    * @return periodBalanceCheckpoint Court term ID used to fetch the total active balance of the jurors registry
    * @return totalActiveBalance Total amount of juror tokens active in the Court at the corresponding used checkpoint
    */
    function ensurePeriodBalanceDetails(uint256 _periodId) external returns (uint64 periodBalanceCheckpoint, uint256 totalActiveBalance) {
        Period storage period = periods[_periodId];
        return _ensurePeriodBalanceDetails(_periodId, period);
    }

    /**
    * @notice Set new subscriptions fee to `@tokenAmount(_feeToken, _feeAmount)`
    * @dev Accumulated fees owed to governor (if any) will be transferred
    * @param _feeToken New ERC20 token to be used for the subscription fees
    */
    function setFeeToken(ERC20 _feeToken) external onlyConfigGovernor {
        _setFeeToken(_feeToken);
    }

    /**
    * @dev Tell the identification number of the current period
    * @return Identification number of the current period
    */
    function getCurrentPeriodId() external view returns (uint256) {
        return _getCurrentPeriodId();
    }

    /**
    * @dev Get details of the current period
    * @return feeToken Fee token corresponding to a certain subscription period
    * @return balanceCheckpoint Court term ID of a period used to fetch the total active balance of the jurors registry
    * @return totalActiveBalance Total amount of juror tokens active in the Court at the corresponding period checkpoint
    * @return collectedFees Total amount of subscription fees collected during a period
    */
    function getCurrentPeriod() external view
        returns (ERC20 feeToken, uint64 balanceCheckpoint, uint256 totalActiveBalance, uint256 collectedFees)
    {
        uint256 currentPeriodId = _getCurrentPeriodId();
        Period storage period = periods[currentPeriodId];

        feeToken = period.feeToken;
        balanceCheckpoint = period.balanceCheckpoint;
        totalActiveBalance = period.totalActiveBalance;
        collectedFees = period.collectedFees;
    }

    /**
    * @dev Tell total active balance of the jurors registry at a random term during a certain period
    * @param _periodId Identification number of the period being queried
    * @return periodBalanceCheckpoint Court term ID used to fetch the total active balance of the jurors registry
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
    * @dev Internal function to make sure that the balance details of a certain period have been computed. This function assumes given ID and
    *      period correspond to each other.
    * @param _periodId Identification number of the period being ensured
    * @param _period Period being ensured
    * @return periodBalanceCheckpoint Court term ID used to fetch the total active balance of the jurors registry
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
    * @dev Internal function to set a new ERC20 token for the subscription fees
    * @param _feeToken New ERC20 token to be used for the subscription fees
    */
    function _setFeeToken(ERC20 _feeToken) internal {
        require(isContract(address(_feeToken)), ERROR_FEE_TOKEN_NOT_CONTRACT);

        emit FeeTokenChanged(address(currentFeeToken), address(_feeToken));
        currentFeeToken = _feeToken;
    }

    /**
    * @dev Internal function to tell the identification number of the current period
    * @return Identification number of the current period
    */
    function _getCurrentPeriodId() internal view returns (uint256) {
        // Since the Court starts at term #1, and the first subscription period is #0, then subtract one unit to the current term of the Court
        uint64 termId = _getCurrentTermId();
        require(termId > 0, ERROR_COURT_HAS_NOT_STARTED);

        // No need for SafeMath: we already checked that the term ID is at least 1
        uint64 periodId = (termId - START_TERM_ID) / periodDuration;
        return uint256(periodId);
    }

    /**
    * @dev Internal function to get the Court term in which a certain period starts
    * @param _periodId Identification number of the period querying the start term of
    * @return Court term where the given period starts
    */
    function _getPeriodStartTermId(uint256 _periodId) internal view returns (uint64) {
        // Periods are measured in Court terms. Since Court terms are represented in uint64, we are safe to use uint64 for period ids too.
        // We are using SafeMath here because if any user calls `getPeriodBalanceDetails` for a huge period ID,
        // it would overflow and therefore return wrong information.
        return START_TERM_ID.add(uint64(_periodId).mul(periodDuration));
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
    * @dev Internal function to get the total active balance of the jurors registry at a random term during a period
    * @param _periodId Identification number of the period being queried
    * @return periodBalanceCheckpoint Court term ID used to fetch the total active balance of the jurors registry
    * @return totalActiveBalance Total amount of juror tokens active in the Court at the corresponding used checkpoint
    */
    function _getPeriodBalanceDetails(uint256 _periodId) internal view returns (uint64 periodBalanceCheckpoint, uint256 totalActiveBalance) {
        uint64 periodStartTermId = _getPeriodStartTermId(_periodId);
        uint64 nextPeriodStartTermId = _getPeriodStartTermId(_periodId.add(1));

        // Pick a random Court term during the next period of the requested one to get the total amount of juror tokens active in the Court
        IClock clock = _clock();
        bytes32 randomness = clock.getTermRandomness(nextPeriodStartTermId);

        // The randomness factor for each Court term is computed using the the hash of a block number set during the initialization of the
        // term, to ensure it cannot be known beforehand. Note that the hash function being used only works for the 256 most recent block
        // numbers. Therefore, if that occurs we use the hash of the previous block number. This could be slightly beneficial for the first
        // juror calling this function, but it's still impossible to predict during the requested period.
        if (randomness == bytes32(0)) {
            randomness = blockhash(getBlockNumber() - 1);
        }

        // Use randomness to choose a Court term of the requested period and query the total amount of juror tokens active at that term
        IJurorsRegistry jurorsRegistry = _jurorsRegistry();
        periodBalanceCheckpoint = periodStartTermId.add(uint64(uint256(randomness) % periodDuration));
        totalActiveBalance = jurorsRegistry.totalActiveBalanceAt(periodBalanceCheckpoint);
    }

    /**
    * @dev Internal function to tell the share fees corresponding to a juror for a certain period
    * @param _juror Address of the juror querying the owed shared fees of
    * @param _period Period being queried
    * @param _periodBalanceCheckpoint Court term ID used to fetch the active balance of the juror for the requested period
    * @param _totalActiveBalance Total amount of juror tokens active in the Court at the corresponding used checkpoint
    * @return Amount of share fees owed to the given juror for the requested period
    */
    function _getJurorShare(address _juror, Period storage _period, uint64 _periodBalanceCheckpoint, uint256 _totalActiveBalance) internal view
        returns (uint256)
    {
        // Fetch juror active balance at the checkpoint used for the requested period
        IJurorsRegistry jurorsRegistry = _jurorsRegistry();
        uint256 jurorActiveBalance = jurorsRegistry.activeBalanceOfAt(_juror, _periodBalanceCheckpoint);
        if (jurorActiveBalance == 0) {
            return 0;
        }

        // Note that we already checked the juror active balance is greater than zero, then, the total active balance must be greater than zero.
        return _period.collectedFees.mul(jurorActiveBalance) / _totalActiveBalance;
    }
}
