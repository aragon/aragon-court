pragma solidity ^0.5.8;

import "../lib/os/ERC20.sol";
import "../lib/os/SafeMath.sol";
import "../lib/os/SafeMath64.sol";
import "../lib/os/SafeERC20.sol";
import "../lib/os/TimeHelpers.sol";

import "./ISubscriptions.sol";
import "./IAragonAppFeesCashier.sol";
import "../lib/PctHelpers.sol";
import "../registry/IJurorsRegistry.sol";
import "../court/controller/Controller.sol";
import "../court/controller/ControlledRecoverable.sol";


// AUDIT: in terms of this contract, should it be "recoverable"? Since it holds tokens.
contract CourtSubscriptions is ControlledRecoverable, TimeHelpers, ISubscriptions, IAragonAppFeesCashier {
    using SafeERC20 for ERC20;
    using SafeMath for uint256;
    using SafeMath64 for uint64;
    using PctHelpers for uint256;

    string private constant ERROR_GOVERNOR_SHARE_FEES_ZERO = "CS_GOVERNOR_SHARE_FEES_ZERO";
    string private constant ERROR_TOKEN_DEPOSIT_FAILED = "CS_TOKEN_DEPOSIT_FAILED";
    string private constant ERROR_TOKEN_TRANSFER_FAILED = "CS_TOKEN_TRANSFER_FAILED";
    string private constant ERROR_PERIOD_DURATION_ZERO = "CS_PERIOD_DURATION_ZERO";
    string private constant ERROR_FEE_TOKEN_NOT_CONTRACT = "CS_FEE_TOKEN_NOT_CONTRACT";
    string private constant ERROR_OVERRATED_GOVERNOR_SHARE_PCT = "CS_OVERRATED_GOVERNOR_SHARE_PCT";
    string private constant ERROR_NON_PAST_PERIOD = "CS_NON_PAST_PERIOD";
    string private constant ERROR_JUROR_FEES_ALREADY_CLAIMED = "CS_JUROR_FEES_ALREADY_CLAIMED";
    string private constant ERROR_JUROR_NOTHING_TO_CLAIM = "CS_JUROR_NOTHING_TO_CLAIM";
    string private constant ERROR_DONATION_AMOUNT_ZERO = "CS_DONATION_AMOUNT_ZERO";
    string private constant ERROR_COURT_HAS_NOT_STARTED = "CS_COURT_HAS_NOT_STARTED";
    string private constant ERROR_APP_FEE_NOT_SET = "CS_APP_FEE_NOT_SET";
    string private constant ERROR_WRONG_TOKEN = "CS_WRONG_TOKEN";
    string private constant ERROR_WRONG_TOKENS_LENGTH = "CS_WRONG_TOKENS_LENGTH";
    string private constant ERROR_WRONG_AMOUNTS_LENGTH = "CS_WRONG_AMOUNTS_LENGTH";

    // Term 0 is for jurors on-boarding
    uint64 internal constant START_TERM_ID = 1;

    struct Period {
        uint64 balanceCheckpoint;               // Court term ID of a period used to fetch the total active balance of the jurors registry
        ERC20 feeToken;                         // Fee token used for the subscription fees corresponding to a certain period
        uint256 totalActiveBalance;             // Total amount of juror tokens active in the Court at the corresponding period checkpoint
        uint256 collectedFees;                  // Total amount of subscription fees collected during a period
        uint256 accumulatedGovernorFees;        // Total amount of fees accumulated for the governor of the Court during a period
        mapping (address => bool) claimedFees;  // List of jurors that have claimed fees during a period, indexed by juror address
    }

    struct AppFee {
        // AUDIT: how useful is this variable? Could we check amount == 0?
        bool set;
        uint256 amount;
    }

    // Duration of a subscription period in Court terms
    uint64 public periodDuration;

    // Permyriad of subscription fees that will be allocated to the governor of the Court (‱ - 1/10,000)
    uint16 public governorSharePct;

    // ERC20 token used for the subscription fees
    ERC20 public currentFeeToken;

    // List of periods indexed by ID
    mapping (uint256 => Period) internal periods;

    // List of fees per appId
    mapping (bytes32 => AppFee) internal appFees;

    // AUDIT: I'm guessing we shouldn't change it anymore, but should we index the feeTokens?
    event FeesDonated(address indexed payer, uint256 indexed periodId, ERC20 feeToken, uint256 feeAmount);
    event FeesClaimed(address indexed juror, uint256 indexed periodId, ERC20 feeToken, uint256 jurorShare);
    event GovernorFeesTransferred(ERC20 indexed feeToken, uint256 amount);
    event FeeTokenChanged(ERC20 previousFeeToken, ERC20 currentFeeToken);
    event GovernorSharePctChanged(uint16 previousGovernorSharePct, uint16 currentGovernorSharePct);

    /**
    * @dev Initialize court subscriptions
    * @param _controller Address of the controller
    * @param _periodDuration Duration of a subscription period in Court terms
    * @param _feeToken Initial ERC20 token used for the subscription fees
    * @param _governorSharePct Initial permyriad of subscription fees that will be allocated to the governor of the Court (‱ - 1/10,000)
    */
    constructor(Controller _controller, uint64 _periodDuration, ERC20 _feeToken, uint16 _governorSharePct)
        ControlledRecoverable(_controller)
        public
    {
        // No need to explicitly call `Controlled` constructor since `ControlledRecoverable` is already doing it
        require(_periodDuration > 0, ERROR_PERIOD_DURATION_ZERO);

        periodDuration = _periodDuration;
        _setFeeToken(_feeToken);
        _setGovernorSharePct(_governorSharePct);
    }

    /**
    * @notice Donate fees to the Court
    * @param _amount Amount of fee tokens to be donated
    */
    function donate(uint256 _amount) external payable {
        require(_amount > 0, ERROR_DONATION_AMOUNT_ZERO);

        // Ensure fee token data for the current period
        (uint256 currentPeriodId, Period storage period, ERC20 feeToken) = _ensureCurrentPeriodFeeToken();

        // Update collected fees for the jurors
        period.collectedFees = period.collectedFees.add(_amount);

        // Deposit fee tokens from sender to this contract
        _deposit(msg.sender, feeToken, _amount);
        emit FeesDonated(msg.sender, currentPeriodId, feeToken, _amount);
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
        ERC20 feeToken = _ensurePeriodFeeToken(period);
        _transfer(msg.sender, feeToken, jurorShare);
        emit FeesClaimed(msg.sender, _periodId, feeToken, jurorShare);
    }

    /**
    * @notice Transfer owed fees to the governor for the current period
    */
    function transferCurrentPeriodFeesToGovernor() external {
        (, Period storage period) = _getCurrentPeriod();
        _transferFeesToGovernor(period);
    }

    /**
    * @notice Transfer owed fees to the governor
    * @param _periodId Identification number of the period for accumulated fees
    */
    function transferFeesToGovernor(uint256 _periodId) external {
        require(_periodId <= _getCurrentPeriodId(), ERROR_NON_PAST_PERIOD);
        Period storage period = periods[_periodId];
        _transferFeesToGovernor(period);
    }

    /**
    * @notice Make sure that the balance details of a certain period have been computed
    * @param _periodId Identification number of the period being ensured
    * @return periodBalanceCheckpoint Court term ID used to fetch the total active balance of the jurors registry
    * @return totalActiveBalance Total amount of juror tokens active in the Court at the corresponding used checkpoint
    */
    function ensurePeriodBalanceDetails(uint256 _periodId) external returns (uint64 periodBalanceCheckpoint, uint256 totalActiveBalance) {
        // AUDIT: should we also have a check that the period is in the past?
        Period storage period = periods[_periodId];
        return _ensurePeriodBalanceDetails(_periodId, period);
    }

    /**
    * @notice Set subscriptions fee token to `_feeToken`
    * @param _feeToken New ERC20 token to be used for the subscription fees
    */
    function setFeeToken(ERC20 _feeToken) external onlyConfigGovernor {
        _setFeeToken(_feeToken);
    }

    /**
    * @notice Set new governor share to `_governorSharePct`‱ (1/10,000)
    * @param _governorSharePct New permyriad of subscription fees that will be allocated to the governor of the Court (‱ - 1/10,000)
    */
    function setGovernorSharePct(uint16 _governorSharePct) external onlyConfigGovernor {
        _setGovernorSharePct(_governorSharePct);
    }

    // IAragonAppFeesCashier interface

    /**
    * @notice Set fees for app with id `_appId` to @tokenAmount(`_token`, `_amount`)
    * @param _appId Id of the app
    // AUDIT: I found this kind of weird, since we're the only one using this interface... is this a "just in case" parameter for the future?
    * @param _token Token for the fee, must be the same as the current period one
    * @param _amount Amount of fee tokens. The change applies immediately.
    */
    function setAppFee(bytes32 _appId, ERC20 _token, uint256 _amount) external onlyConfigGovernor {
        // Ensure fee token data for the current period
        (,, ERC20 feeToken) = _ensureCurrentPeriodFeeToken();
        require(_token == feeToken, ERROR_WRONG_TOKEN);

        _setAppFee(_appId, feeToken, _amount);
    }

    /**
    * @notice Set fees for apps with ids `_appIds`
    * @param _appIds Id of the apps
    // AUDIT: I found this kind of weird, since we're the only one using this interface... is this a "just in case" parameter for the future?
    * @param _tokens Token for the fees for each app (must be an empty array, as we are using the global token)
    * @param _amounts Amount of fee tokens for each app. The change applies immediately.
    */
    function setAppFees(bytes32[] calldata _appIds, ERC20[] calldata _tokens, uint256[] calldata _amounts) external onlyConfigGovernor {
        require(_tokens.length == 0, ERROR_WRONG_TOKENS_LENGTH);
        require(_appIds.length == _amounts.length, ERROR_WRONG_AMOUNTS_LENGTH);

        // Ensure fee token data for the current period
        (,, ERC20 feeToken) = _ensureCurrentPeriodFeeToken();

        for (uint256 i = 0; i < _appIds.length; i++) {
            _setAppFee(_appIds[i], feeToken, _amounts[i]);
        }
    }

    /**
    * @notice Unset fees for app with id `_appId`
    * @param _appId Id of the app
    */
    function unsetAppFee(bytes32 _appId) external onlyConfigGovernor {
        _unsetAppFee(_appId);
    }

    /**
    * @notice Unset fees for apps with ids `_appIds`
    * @param _appIds Ids of the apps
    */
    function unsetAppFees(bytes32[] calldata _appIds) external onlyConfigGovernor {
        for (uint256 i = 0; i < _appIds.length; i++) {
            _unsetAppFee(_appIds[i]);
        }
    }

    /**
    * @notice Pay fees corresponding to a new action in app with id `appId`
    * @dev To be called by Agreements. If a fee is defined, it requires the sender to have pre-approved tokens.
    * @param _appId Id of the app paying fees for
    * @param _data Extra data for context of the payment
    */
   // AUDIT: should we revert on receiving ETH?
    function payAppFees(bytes32 _appId, bytes calldata _data) external payable {
        uint256 feeAmount = _getAppFee(_appId);
        if (feeAmount == 0) {
            return;
        }

        // Ensure fee token data for the current period
        (,Period storage period, ERC20 feeToken) = _ensureCurrentPeriodFeeToken();

        // Compute the portion of the total amount to pay that will be allocated to the governor
        uint256 governorFee = feeAmount.pct(governorSharePct);
        period.accumulatedGovernorFees = period.accumulatedGovernorFees.add(governorFee);

        // Update collected fees for the jurors
        uint256 collectedFees = feeAmount.sub(governorFee);
        period.collectedFees = period.collectedFees.add(collectedFees);

        // Deposit fee tokens from sender to this contract
        _deposit(msg.sender, feeToken, feeAmount);
        emit AppFeePaid(msg.sender, _appId, _data);
    }

    /**
    * @dev Tell whether a certain subscriber has paid all the fees up to current period or not
    * @return Always true. Previously we were using monthly subscriptions but this "off-chain verified" fee model removes the concept of a monthly fee.
    */
    function isUpToDate(address /*_subscriber*/) external view returns (bool) {
        return true;
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
    * @return feeToken Fee token corresponding to a certain period
    * @return balanceCheckpoint Court term ID of a period used to fetch the total active balance of the jurors registry
    * @return totalActiveBalance Total amount of juror tokens active in the Court at the corresponding period checkpoint
    * @return collectedFees Total amount of subscription fees collected during a period
    * @return accumulatedGovernorFees Total amount of fees accumulated for the governor of the Court during a period
    */
    function getPeriod(uint256 _periodId)
        external
        view
        returns (
            ERC20 feeToken,
            uint64 balanceCheckpoint,
            uint256 totalActiveBalance,
            uint256 collectedFees,
            uint256 accumulatedGovernorFees
        )
    {
        Period storage period = periods[_periodId];

        feeToken = period.feeToken;
        balanceCheckpoint = period.balanceCheckpoint;
        totalActiveBalance = period.totalActiveBalance;
        collectedFees = period.collectedFees;
        accumulatedGovernorFees = period.accumulatedGovernorFees;
    }

    /**
    * @dev Tell the minimum amount of fees to pay and resulting last paid period for a given subscriber in order to be up-to-date
    * @return feeToken ERC20 token used for the subscription fees
    * @return amountToPay Amount of subscription fee tokens to be paid for all the owed periods
    * @return newLastPeriodId Identification number of the resulting last paid period
    */
    function getOwedFeesDetails(address /*_subscriber*/) external view returns (ERC20 feeToken, uint256 amountToPay, uint256 newLastPeriodId) {
        (uint256 periodId, Period storage period) = _getCurrentPeriod();

        // Subscription fees were deprecated, this module now only implements app action fees.
        // However, we still need to support this view function to be compliant with the AragonCourt's IArbitrator implementation.
        // Therefore, we simply say that all subscribers do not owe subscription payments.

        feeToken = _getEnsuredPeriodFeeToken(period);
        amountToPay = 0;
        newLastPeriodId = periodId;
    }

    /**
    * @dev Tell the share fees corresponding to a juror for a certain period
    * @param _juror Address of the juror querying the owed shared fees of
    * @param _periodId Identification number of the period being queried
    * @return feeToken Address of the token used for the subscription fees
    * @return jurorShare Amount of share fees owed to the given juror for the requested period
    */
    function getJurorShare(address _juror, uint256 _periodId) external view returns (ERC20 feeToken, uint256 jurorShare) {
        require(_periodId < _getCurrentPeriodId(), ERROR_NON_PAST_PERIOD);
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
        feeToken = _getEnsuredPeriodFeeToken(period);
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
    * @notice Get fees for app with id `_appId`
    * @param _appId Id of the app
    * @return ERC20 token for the fees
    * @return Amount of fee tokens
    */
    function getAppFee(bytes32 _appId) external view returns (ERC20 feeToken, uint256 feeAmount) {
        (, Period storage period) = _getCurrentPeriod();
        feeToken = _getEnsuredPeriodFeeToken(period);
        feeAmount = _getAppFee(_appId);
    }

    /**
    * @dev Internal function to transfer owed fees to the governor
    * @param _period Period instance for the accumulated fees
    */
    function _transferFeesToGovernor(Period storage _period) internal {
        uint256 amount = _period.accumulatedGovernorFees;
        require(amount > 0, ERROR_GOVERNOR_SHARE_FEES_ZERO);

        _period.accumulatedGovernorFees = 0;
        address payable governor = address(uint160(_configGovernor()));
        ERC20 feeToken = _ensurePeriodFeeToken(_period);
        _transfer(governor, feeToken, amount);
        emit GovernorFeesTransferred(feeToken, amount);
    }

    /**
    * @dev Internal function to pull tokens into this contract
    * @param _from Owner of the deposited funds
    * @param _token Token to deposit
    * @param _amount Amount to be deposited
    */
    function _deposit(address _from, ERC20 _token, uint256 _amount) internal {
        if (_amount == 0) {
            return;
        }

        require(_token.safeTransferFrom(_from, address(this), _amount), ERROR_TOKEN_DEPOSIT_FAILED);
    }

    /**
    * @dev Internal function to transfer tokens
    * @param _to Recipient of the transfer
    * @param _token Token to transfer
    * @param _amount Amount to be transferred
    */
    function _transfer(address payable _to, ERC20 _token, uint256 _amount) internal {
        if (_amount == 0) {
            return;
        }

        require(_token.safeTransfer(_to, _amount), ERROR_TOKEN_TRANSFER_FAILED);
    }

    /**
    * @dev Internal function to make sure the fee token address and amount are set for the current period
    * @return periodId Identification number of the current period
    * @return period Current period instance
    * @return feeToken ERC20 token to be used for the subscription fees during the given period
    */
    function _ensureCurrentPeriodFeeToken() internal returns (uint256 periodId, Period storage period, ERC20 feeToken) {
        (periodId, period) = _getCurrentPeriod();
        feeToken = _ensurePeriodFeeToken(period);
    }

    /**
    * @dev Internal function to make sure the fee token address and amount are set for a certain period
    * @param _period Period instance to ensure
    * @return ERC20 token to be used for the subscription fees during the given period
    */
    function _ensurePeriodFeeToken(Period storage _period) internal returns (ERC20) {
        // Use current fee token address for the given period if these haven't been set yet
        ERC20 feeToken = _period.feeToken;
        if (feeToken == ERC20(0)) {
            feeToken = currentFeeToken;
            _period.feeToken = feeToken;
        }

        return feeToken;
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

        emit FeeTokenChanged(currentFeeToken, _feeToken);
        // AUDIT: If I understand this correctly, we are allowing the fee tokens to change in the
        // current period, until a fee or donation is made (and then any changes to the fee token
        // would only be applied at the next period)?
        currentFeeToken = _feeToken;
    }

    /**
    * @dev Internal function to set a new governor share value
    * @param _governorSharePct New permyriad of subscription fees that will be allocated to the governor of the Court (‱ - 1/10,000)
    */
    function _setGovernorSharePct(uint16 _governorSharePct) internal {
        // Check governor share is not greater than 10,000‱
        require(PctHelpers.isValid(_governorSharePct), ERROR_OVERRATED_GOVERNOR_SHARE_PCT);

        emit GovernorSharePctChanged(governorSharePct, _governorSharePct);
        governorSharePct = _governorSharePct;
    }

    /**
    * @notice Set fees for app with id `_appId` to `_amount`
    * @param _appId Id of the app
    * @param _token Token for the fee, must be the same as the current period one
    * @param _amount Amount of fee tokens
    */
    function _setAppFee(bytes32 _appId, ERC20 _token, uint256 _amount) internal {
        AppFee storage appFee = appFees[_appId];

        appFee.set = true;
        appFee.amount = _amount;
        emit AppFeeSet(_appId, _token, _amount);
    }

    /**
    * @notice Unset fees for app with id `_appId`
    * @param _appId Id of the app
    */
    function _unsetAppFee(bytes32 _appId) internal {
        require(appFees[_appId].set, ERROR_APP_FEE_NOT_SET);

        delete appFees[_appId];
        emit AppFeeUnset(_appId);
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
    * @dev Internal function to get the current period
    * @return periodId Identification number of the current period
    * @return period Current period instance
    */
    function _getCurrentPeriod() internal view returns (uint256 periodId, Period storage period) {
        periodId = _getCurrentPeriodId();
        period = periods[periodId];
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
    * @return ERC20 token to be used for the subscription fees during the given period
    */
    function _getEnsuredPeriodFeeToken(Period storage _period) internal view returns (ERC20) {
        // Return current fee token address and amount if these haven't been set for the given period yet
        ERC20 feeToken = _period.feeToken;
        return feeToken == ERC20(0) ? currentFeeToken : feeToken;
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
    function _getJurorShare(address _juror, Period storage _period, uint64 _periodBalanceCheckpoint, uint256 _totalActiveBalance)
        internal
        view
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

    /**
    * @dev Get fees for app with the given id
    * @param _appId Id of the app
    * @return Amount of fee tokens
    */
    function _getAppFee(bytes32 _appId) internal view returns (uint256) {
        AppFee storage appFee = appFees[_appId];
        require(appFee.set, ERROR_APP_FEE_NOT_SET);
        return appFee.amount;
    }
}
