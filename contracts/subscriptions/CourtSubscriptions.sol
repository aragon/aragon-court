pragma solidity ^0.5.8;

import "../lib/os/ERC20.sol";
import "../lib/os/SafeMath.sol";
import "../lib/os/SafeMath64.sol";
import "../lib/os/SafeERC20.sol";
import "../lib/os/TimeHelpers.sol";

import "../registry/IJurorsRegistry.sol";
import "../court/controller/Controller.sol";
import "../court/controller/ControlledRecoverable.sol";

// TODO: Integrate BrightIdUserRegister, otherwise someone could stake as a juror, update their verified account
//  and withdraw fees using both accounts, if the jurors registry converts the sending address to the unique address.
contract CourtSubscriptions is ControlledRecoverable, TimeHelpers {
    using SafeERC20 for ERC20;
    using SafeMath for uint256;
    using SafeMath64 for uint64;

    string private constant ERROR_TOKEN_TRANSFER_FAILED = "CS_TOKEN_TRANSFER_FAILED";
    string private constant ERROR_PERIOD_DURATION_ZERO = "CS_PERIOD_DURATION_ZERO";
    string private constant ERROR_FEE_TOKEN_NOT_CONTRACT = "CS_FEE_TOKEN_NOT_CONTRACT";
    string private constant ERROR_STILL_PERIOD_ZERO = "CS_STILL_PERIOD_ZERO";
    string private constant ERROR_JUROR_FEES_ALREADY_CLAIMED = "CS_JUROR_FEES_ALREADY_CLAIMED";
    string private constant ERROR_JUROR_NOTHING_TO_CLAIM = "CS_JUROR_NOTHING_TO_CLAIM";
    string private constant ERROR_COURT_HAS_NOT_STARTED = "CS_COURT_HAS_NOT_STARTED";
    string private constant ERROR_FUTURE_PERIOD = "CS_FUTURE_PERIOD";

    // Term 0 is for jurors on-boarding
    uint64 internal constant START_TERM_ID = 1;

    struct Period {
        uint64 balanceCheckpoint;               // Court term ID of a period used to fetch the total active balance of the jurors registry
        ERC20 feeToken;                         // Fee token corresponding to a certain subscription period
        uint256 totalActiveBalance;             // Total amount of juror tokens active in the Court at the corresponding period checkpoint
        uint256 donatedFees;                    // The fee token balance of Subscriptions at the end of the period, for distribution to jurors
        mapping (address => bool) claimedFees;  // List of jurors that have claimed fees during a period, indexed by juror address
    }

    // Duration of a subscription period in Court terms
    uint64 public periodDuration;

    // ERC20 token used for the subscription fees
    ERC20 public currentFeeToken;

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
    * @notice Set new subscriptions fee token to `_feeToken`
    * @param _feeToken New ERC20 token to be used for the subscription fees
    */
    function setFeeToken(ERC20 _feeToken) external onlyConfigGovernor {
        _setFeeToken(_feeToken);
    }

    /**
    * @notice Claim proportional share of fees for the previous period
    */
    function claimFees() external {
        // Juror share fees can only be claimed for past periods
        uint256 currentPeriod = _getCurrentPeriodId();
        require(currentPeriod > 0, ERROR_STILL_PERIOD_ZERO);
        Period storage period = periods[currentPeriod - 1];
        require(!period.claimedFees[msg.sender], ERROR_JUROR_FEES_ALREADY_CLAIMED);

        // Check claiming juror has share fees to be transferred
        (uint64 periodBalanceCheckpoint, uint256 totalActiveBalance, uint256 donatedFees)
            = _ensurePeriodBalanceDetails(currentPeriod - 1, period);
        uint256 jurorShare = _getJurorShare(msg.sender, periodBalanceCheckpoint, totalActiveBalance, donatedFees);
        require(jurorShare > 0, ERROR_JUROR_NOTHING_TO_CLAIM);

        // Update juror state and transfer share fees
        period.claimedFees[msg.sender] = true;
        emit FeesClaimed(msg.sender, currentPeriod - 1, jurorShare);
        require(period.feeToken.safeTransfer(msg.sender, jurorShare), ERROR_TOKEN_TRANSFER_FAILED);
    }

    /**
    * @dev Tell the share fees corresponding to a juror
    * @param _juror Address of the juror querying the owed shared fees of
    * @return feeToken Address of the token used for the subscription fees
    * @return jurorShare Amount of share fees owed to the given juror for the previous period
    */
    function getJurorShare(address _juror) external view returns (ERC20 feeToken, uint256 jurorShare) {
        uint256 currentPeriod = _getCurrentPeriodId();
        require(currentPeriod > 0, ERROR_STILL_PERIOD_ZERO);

        Period storage period = periods[currentPeriod - 1];
        uint64 periodBalanceCheckpoint;
        uint256 totalActiveBalance = period.totalActiveBalance;
        uint256 donatedFees;

        // Compute period balance details if they were not ensured yet
        if (totalActiveBalance == 0) {
            (periodBalanceCheckpoint, feeToken, totalActiveBalance, donatedFees) = _getPeriodBalanceDetails(currentPeriod - 1);
        } else {
            periodBalanceCheckpoint = period.balanceCheckpoint;
            feeToken = period.feeToken;
            donatedFees = period.donatedFees;
        }

        // Compute juror share fees using the period balance details
        jurorShare = _getJurorShare(_juror, periodBalanceCheckpoint, totalActiveBalance, donatedFees);
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
    * @return periodBalanceCheckpoint Court term ID used to fetch the total active balance of the jurors registry
    * @return feeToken Fee token for this period
    * @return totalActiveBalance Total amount of juror tokens active in the Court at the corresponding used checkpoint
    * @return donatedFees The fee token balance of Subscriptions at the end of the period, to be distributed to jurors
    */
    function getCurrentPeriod() external view
        returns (uint64 periodBalanceCheckpoint, ERC20 feeToken, uint256 totalActiveBalance, uint256 donatedFees)
    {
        uint256 currentPeriodId = _getCurrentPeriodId();
        return _getPeriod(currentPeriodId);
    }

    /**
    * @dev Get details of a specific period
    * @param _periodId Identification number of the period being queried
    * @return periodBalanceCheckpoint Court term ID used to fetch the total active balance of the jurors registry
    * @return feeToken Fee token for this period
    * @return totalActiveBalance Total amount of juror tokens active in the Court at the corresponding used checkpoint
    * @return donatedFees The fee token balance of Subscriptions at the end of the period, to be distributed to jurors
    */
    function getPeriod(uint256 _periodId) external view
        returns (uint64 periodBalanceCheckpoint, ERC20 feeToken, uint256 totalActiveBalance, uint256 donatedFees)
    {
        return _getPeriod(_periodId);
    }

    /**
    * @dev Check if a given juror has already claimed the owed fees for the previous period
    * @param _juror Address of the juror being queried
    * @return True if the owed share fees have already been claimed, false otherwise
    */
    function hasJurorClaimed(address _juror) external view returns (bool) {
        uint256 currentPeriod = _getCurrentPeriodId();
        require(currentPeriod > 0, ERROR_STILL_PERIOD_ZERO);
        return periods[currentPeriod - 1].claimedFees[_juror];
    }

    /**
    * @dev Internal function to get the current period
    * @param _periodId Identification number of the period being queried
    * @return periodBalanceCheckpoint Court term ID used to fetch the total active balance of the jurors registry
    * @return feeToken Fee token for this period
    * @return totalActiveBalance Total amount of juror tokens active in the Court at the corresponding used checkpoint
    * @return donatedFees The fee token balance of Subscriptions at the end of the period, to be distributed to jurors
    */
    function _getPeriod(uint256 _periodId) internal view
        returns (uint64 periodBalanceCheckpoint, ERC20 feeToken, uint256 totalActiveBalance, uint256 donatedFees)
    {
        require(_periodId <= _getCurrentPeriodId(), ERROR_FUTURE_PERIOD);

        Period storage period = periods[_periodId];

        if (period.totalActiveBalance == 0) {
            return _getPeriodBalanceDetails(_periodId);
        } else {
            return (period.balanceCheckpoint, period.feeToken, period.totalActiveBalance, period.donatedFees);
        }
    }

    /**
    * @dev Internal function to make sure that the balance details of a certain period have been computed. This function assumes given ID and
    *      period correspond to each other.
    * @param _periodId Identification number of the period being ensured
    * @param _period Period being ensured
    * @return periodBalanceCheckpoint Court term ID used to fetch the total active balance of the jurors registry
    * @return totalActiveBalance Total amount of juror tokens active in the Court at the corresponding used checkpoint
    * @return donatedFees The fee token balance of Subscriptions at the end of the period, to be distributed to jurors
    */
    function _ensurePeriodBalanceDetails(uint256 _periodId, Period storage _period) internal
        returns (uint64 periodBalanceCheckpoint, uint256 totalActiveBalance, uint256 donatedFees)
    {
        totalActiveBalance = _period.totalActiveBalance;

        // Set balance details for the given period if these haven't been set yet
        if (totalActiveBalance == 0) {
            ERC20 feeToken;
            (periodBalanceCheckpoint, feeToken, totalActiveBalance, donatedFees) = _getPeriodBalanceDetails(_periodId);
            _period.balanceCheckpoint = periodBalanceCheckpoint;
            _period.feeToken = feeToken;
            _period.totalActiveBalance = totalActiveBalance;
            _period.donatedFees = donatedFees;
        } else {
            periodBalanceCheckpoint = _period.balanceCheckpoint;
            donatedFees = _period.donatedFees;
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
        require(termId >= START_TERM_ID, ERROR_COURT_HAS_NOT_STARTED);

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
    */
    function _getPeriodFeeToken(Period storage _period) internal view returns (ERC20 feeToken) {
        // Return current fee token address and amount if these haven't been set for the given period yet
        feeToken = _period.feeToken;
        if (feeToken == ERC20(0)) {
            feeToken = currentFeeToken;
        }
    }

    /**
    * @dev Internal function to get the total active balance of the jurors registry at a random term during a period
    * @param _periodId Identification number of the period being queried
    * @return periodBalanceCheckpoint Court term ID used to fetch the total active balance of the jurors registry
    * @return feeToken Fee token for this period
    * @return totalActiveBalance Total amount of juror tokens active in the Court at the corresponding used checkpoint
    * @return donatedFees The fee token balance of Subscriptions at the end of the period, to be distributed to jurors
    */
    function _getPeriodBalanceDetails(uint256 _periodId) internal view
        returns (uint64 periodBalanceCheckpoint, ERC20 feeToken, uint256 totalActiveBalance, uint256 donatedFees)
    {
        feeToken = _getPeriodFeeToken(periods[_periodId]);
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
        donatedFees = feeToken.balanceOf(address(this));
    }

    /**
    * @dev Internal function to tell the share fees corresponding to a juror for a certain period
    * @param _juror Address of the juror querying the owed shared fees of
    * @param _periodBalanceCheckpoint Court term ID used to fetch the active balance of the juror for the requested period
    * @param _totalActiveBalance Total amount of juror tokens active in the Court at the corresponding used checkpoint
    * @param _donatedFees The fee token balance of Subscriptions at the end of the period, to be distributed to jurors
    * @return Amount of share fees owed to the given juror for the requested period
    */
    function _getJurorShare(address _juror, uint64 _periodBalanceCheckpoint, uint256 _totalActiveBalance, uint256 _donatedFees) internal view
        returns (uint256)
    {
        // Fetch juror active balance at the checkpoint used for the requested period
        IJurorsRegistry jurorsRegistry = _jurorsRegistry();
        uint256 jurorActiveBalance = jurorsRegistry.activeBalanceOfAt(_juror, _periodBalanceCheckpoint);
        if (jurorActiveBalance == 0) {
            return 0;
        }

        // Note that we already checked the juror active balance is greater than zero, then, the total active balance must be greater than zero.
        return _donatedFees.mul(jurorActiveBalance) / _totalActiveBalance;
    }
}
