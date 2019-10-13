pragma solidity ^0.5.8;

import "@aragon/os/contracts/common/IsContract.sol";
import "@aragon/os/contracts/common/Initializable.sol";
import "@aragon/os/contracts/common/SafeERC20.sol";
import "@aragon/os/contracts/lib/token/ERC20.sol";
import "@aragon/os/contracts/lib/math/SafeMath.sol";

import "./IJurorsRegistry.sol";
import "./IJurorsRegistryOwner.sol";
import "../lib/BytesHelpers.sol";
import "../lib/HexSumTree.sol";
import "../lib/PctHelpers.sol";
import "../lib/JurorsTreeSortition.sol";
import "../standards/ERC900.sol";
import "../standards/ApproveAndCall.sol";


contract JurorsRegistry is Initializable, IsContract, IJurorsRegistry, ERC900, ApproveAndCallFallBack {
    using SafeERC20 for ERC20;
    using SafeMath for uint256;
    using PctHelpers for uint256;
    using BytesHelpers for bytes;
    using HexSumTree for HexSumTree.Tree;
    using JurorsTreeSortition for HexSumTree.Tree;

    string private constant ERROR_NOT_CONTRACT = "JR_NOT_CONTRACT";
    string private constant ERROR_SENDER_NOT_OWNER = "JR_SENDER_NOT_OWNER";
    string private constant ERROR_INVALID_ZERO_AMOUNT = "JR_INVALID_ZERO_AMOUNT";
    string private constant ERROR_INVALID_ACTIVATION_AMOUNT = "JR_INVALID_ACTIVATION_AMOUNT";
    string private constant ERROR_INVALID_DEACTIVATION_AMOUNT = "JR_INVALID_DEACTIVATION_AMOUNT";
    string private constant ERROR_INVALID_LOCKED_AMOUNTS_LENGTH = "JR_INVALID_LOCKED_AMOUNTS_LEN";
    string private constant ERROR_INVALID_REWARDED_JURORS_LENGTH = "JR_INVALID_REWARDED_JURORS_LEN";
    string private constant ERROR_ACTIVE_BALANCE_BELOW_MIN = "JR_ACTIVE_BALANCE_BELOW_MIN";
    string private constant ERROR_NOT_ENOUGH_AVAILABLE_BALANCE = "JR_NOT_ENOUGH_AVAILABLE_BALANCE";
    string private constant ERROR_CANNOT_REDUCE_DEACTIVATION_REQUEST = "JR_CANT_REDUCE_DEACTIVATION_REQ";
    string private constant ERROR_TOKEN_TRANSFER_FAILED = "JR_TOKEN_TRANSFER_FAILED";
    string private constant ERROR_TOKEN_APPROVE_NOT_ALLOWED = "JR_TOKEN_APPROVE_NOT_ALLOWED";
    string private constant ERROR_BAD_TOTAL_ACTIVE_BALANCE_LIMIT = "JR_BAD_TOTAL_ACTIVE_BAL_LIMIT";
    string private constant ERROR_TOTAL_ACTIVE_BALANCE_EXCEEDED = "JR_TOTAL_ACTIVE_BALANCE_EXCEEDED";

    // Address that will be used to burn juror tokens
    address internal constant BURN_ACCOUNT = address(0x000000000000000000000000000000000000dEaD);

    /**
    * @dev Jurors have three kind of balances, these are:
    *      - active: tokens activated for the Court that can be locked in case the juror is drafted
    *      - locked: amount of active tokens that are locked for a draft
    *      - available: tokens that are not activated for the Court and can be withdrawn by the juror at any time
    *
    *      Due to a gas optimization for drafting, the "active" tokens are stored in a `HexSumTree`, while the others
    *      are stored in this contract as `lockedBalance` and `availableBalance` respectively. Given that the jurors'
    *      active balances cannot be affected during the current Court term, if jurors want to deactivate some of their
    *      active tokens, their balance will be updated for the following term, and they won't be allowed to
    *      withdraw them until the current term has ended.
    *
    *      Note that even though jurors balances are stored separately, all the balances are held by this contract.
    */
    struct Juror {
        uint256 id;                 // key in the jurors tree used for drafting
        uint256 lockedBalance;      // maximum amount of tokens that can be slashed based on the juror's drafts
        uint256 availableBalance;   // available tokens that can be withdrawn at any time
        DeactivationRequest deactivationRequest;
    }

    /**
    * @dev Given that the jurors balances cannot be affected during a Court term, if jurors want to deactivate some
    *      of their tokens, the tree will always be updated for the following term, and they won't be able to
    *      withdraw the requested amount until the current term has finished. Thus, we need to keep track the term
    *      when a token deactivation was requested and its corresponding amount.
    */
    struct DeactivationRequest {
        uint256 amount;             // amount requested for deactivation
        uint64 availableTermId;     // id of the term when jurors can withdraw their requested deactivation tokens
    }

    struct DraftParams {
        bytes32 termRandomness;
        uint256 disputeId;
        uint64 termId;
        uint256 selectedJurors;
        uint256 batchRequestedJurors;
        uint256 roundRequestedJurors;
        uint256 draftLockAmount;
        uint256 sortitionIteration;
    }

    // Jurors registry owner address
    IJurorsRegistryOwner public owner;

    // Minimum amount of tokens jurors have to activate to participate in the Court
    uint256 internal minActiveBalance;

    // Maximum amount of total active balance that can be hold in the registry
    uint256 internal totalActiveBalanceLimit;

    // Juror ERC20 token
    ERC20 internal jurorsToken;

    // Mapping of juror data indexed by address
    mapping (address => Juror) internal jurorsByAddress;

    // Mapping of juror addresses indexed by id
    mapping (uint256 => address) internal jurorsAddressById;

    // Tree to store jurors active balance by term for the drafting process
    HexSumTree.Tree internal tree;

    event JurorDrafted(uint256 indexed disputeId, address juror);
    event JurorActivated(address indexed juror, uint64 fromTermId, uint256 amount);
    event JurorDeactivationRequested(address indexed juror, uint64 availableTermId, uint256 amount);
    event JurorDeactivationProcessed(address indexed juror, uint64 availableTermId, uint256 amount, uint64 processedTermId);
    event JurorDeactivationUpdated(address indexed juror, uint64 availableTermId, uint256 amount, uint64 updateTermId);
    event JurorAvailableBalanceChanged(address indexed juror, uint256 amount, bool positive);
    event JurorTokensCollected(address indexed juror, uint256 amount, uint64 termId);

    modifier onlyOwner() {
        require(msg.sender == address(owner), ERROR_SENDER_NOT_OWNER);
        _;
    }

    /**
    * @notice Initialize jurors registry with a minimum active amount of `@tokenAmount(_token, _minActiveBalance)`.
    * @param _owner Address to be set as the owner of the jurors registry
    * @param _jurorToken Address of the ERC20 token to be used as juror token for the registry
    * @param _minActiveBalance Minimum amount of juror tokens that can be activated
    * @param _totalActiveBalanceLimit Maximum amount of total active balance that can be hold in the registry
    */
    function init(IJurorsRegistryOwner _owner, ERC20 _jurorToken, uint256 _minActiveBalance, uint256 _totalActiveBalanceLimit) external {
        // TODO: cannot check the given owner is a contract cause the Court set this up in the constructor, move to a factory
        // require(isContract(_owner), ERROR_NOT_CONTRACT);
        require(isContract(address(_jurorToken)), ERROR_NOT_CONTRACT);
        require(_totalActiveBalanceLimit > 0, ERROR_BAD_TOTAL_ACTIVE_BALANCE_LIMIT);

        initialized();
        owner = _owner;
        jurorsToken = _jurorToken;
        minActiveBalance = _minActiveBalance;
        totalActiveBalanceLimit = _totalActiveBalanceLimit;

        tree.init();
        assert(tree.insert(0, 0) == 0); // first tree item is an empty juror
    }

    /**
    * @notice Activate `_amount == 0 ? 'all available tokens' : @tokenAmount(self.token(), _amount)` for the next term
    * @param _amount Amount of juror tokens to be activated for the next term
    */
    function activate(uint256 _amount) external isInitialized {
        uint64 termId = owner.ensureAndGetTermId();

        _processDeactivationRequest(msg.sender, termId);

        uint256 availableBalance = jurorsByAddress[msg.sender].availableBalance;
        uint256 amountToActivate = _amount == 0 ? availableBalance : _amount;
        require(amountToActivate > 0, ERROR_INVALID_ZERO_AMOUNT);
        require(amountToActivate <= availableBalance, ERROR_INVALID_ACTIVATION_AMOUNT);

        _activateTokens(msg.sender, termId, amountToActivate);
    }

    /**
    * @notice Deactivate `_amount == 0 ? 'all unlocked tokens' : @tokenAmount(self.token(), _amount)` for the next term
    * @param _amount Amount of juror tokens to be deactivated for the next term
    */
    function deactivate(uint256 _amount) external isInitialized {
        uint64 termId = owner.ensureAndGetTermId();

        uint256 unlockedActiveBalance = unlockedActiveBalanceOf(msg.sender);
        uint256 amountToDeactivate = _amount == 0 ? unlockedActiveBalance : _amount;
        require(amountToDeactivate > 0, ERROR_INVALID_ZERO_AMOUNT);
        require(amountToDeactivate <= unlockedActiveBalance, ERROR_INVALID_DEACTIVATION_AMOUNT);

        // No need for SafeMath: we already checked values above
        uint256 futureActiveBalance = unlockedActiveBalance - amountToDeactivate;
        require(futureActiveBalance == 0 || futureActiveBalance >= minActiveBalance, ERROR_INVALID_DEACTIVATION_AMOUNT);

        _createDeactivationRequest(msg.sender, termId, amountToDeactivate);
    }

    /**
    * @notice Stake `@tokenAmount(self.token(), _amount)` for the sender to the Court
    * @param _amount Amount of tokens to be staked
    * @param _data Optional data that can be used to request the activation of the transferred tokens
    */
    function stake(uint256 _amount, bytes calldata _data) external isInitialized {
        _stake(msg.sender, msg.sender, _amount, _data);
    }

    /**
    * @notice Stake `@tokenAmount(self.token(), _amount)` for `_to` to the Court
    * @param _to Address to stake an amount of tokens to
    * @param _amount Amount of tokens to be staked
    * @param _data Optional data that can be used to request the activation of the transferred tokens
    */
    function stakeFor(address _to, uint256 _amount, bytes calldata _data) external isInitialized {
        _stake(msg.sender, _to, _amount, _data);
    }

    /**
    * @notice Unstake `@tokenAmount(self.token(), _amount)` for `_to` from the Court
    * @param _amount Amount of tokens to be unstaked
    * @param _data Optional data is never used by this function, only logged
    */
    function unstake(uint256 _amount, bytes calldata _data) external isInitialized {
        _unstake(msg.sender, _amount, _data);
    }

    /**
    * @notice Assign `@tokenAmount(self.token(), _amount)` to the available balance of `_juror`
    * @param _juror Juror to add an amount of tokens to
    * @param _amount Amount of tokens to be added to the available balance of a juror
    */
    function assignTokens(address _juror, uint256 _amount) external onlyOwner {
        _updateAvailableBalanceOf(_juror, _amount, true);
    }

    /**
    * @notice Burn `@tokenAmount(self.token(), _amount)`
    * @param _amount Amount of tokens to be burned
    */
    function burnTokens(uint256 _amount) external onlyOwner {
        _updateAvailableBalanceOf(BURN_ACCOUNT, _amount, true);
    }

    /**
    * @dev Draft a set of jurors based on given requirements for a term id
    * @param _params Array containing draft requirements:
    *        0. bytes32 Term randomness
    *        1. uint256 Dispute id
    *        2. uint64  Current term id
    *        3. uint256 Number of seats already filled
    *        4. uint256 Number of seats left to be filled
    *        5. uint64  Number of jurors required for the draft
    *        6. uint16  Per ten thousand of the minimum active balance to be locked for the draft
    *
    * @return jurors List of jurors selected for the draft
    * @return weights List of weights corresponding to each juror
    * @return length Size of the list of the draft result
    */
    function draft(uint256[7] calldata _params) external onlyOwner returns (address[] memory jurors, uint64[] memory weights, uint256 length) {
        uint256 batchRequestedJurors = _params[4];
        jurors = new address[](batchRequestedJurors);
        weights = new uint64[](batchRequestedJurors);
        DraftParams memory draftParams = _buildDraftParams(_params);
        length = _draft(draftParams, jurors, weights);
    }

    /**
    * @dev Slash a set of jurors based on their votes compared to the winning ruling. This function will unlock the
    *      corresponding locked balances of those jurors that are set to be slashed.
    * @param _termId Current term id
    * @param _jurors List of juror addresses to be slashed
    * @param _lockedAmounts List of amounts locked for each corresponding juror that will be either slashed or returned
    * @param _rewardedJurors List of booleans to tell whether a juror's active balance has to be slashed or not
    * @return Total amount of slashed tokens
    */
    function slashOrUnlock(uint64 _termId, address[] calldata _jurors, uint256[] calldata _lockedAmounts, bool[] calldata _rewardedJurors)
        external
        onlyOwner
        returns (uint256)
    {
        require(_jurors.length == _lockedAmounts.length, ERROR_INVALID_LOCKED_AMOUNTS_LENGTH);
        require(_jurors.length == _rewardedJurors.length, ERROR_INVALID_REWARDED_JURORS_LENGTH);

        uint64 nextTermId = _termId + 1;
        uint256 collectedTokens;

        for (uint256 i = 0; i < _jurors.length; i++) {
            uint256 lockedAmount = _lockedAmounts[i];
            Juror storage juror = jurorsByAddress[_jurors[i]];
            juror.lockedBalance = juror.lockedBalance.sub(lockedAmount);

            // Slash juror if requested. Note that there's no need to check if there was a deactivation
            // request since we're working with already locked balances
            if (!_rewardedJurors[i]) {
                collectedTokens = collectedTokens.add(lockedAmount);
                tree.update(juror.id, nextTermId, lockedAmount, false);
            }
        }

        return collectedTokens;
    }

    /**
    * @notice Try to collect `@tokenAmount(self.token(), _amount)` from `_juror` for the term #`_termId + 1`.
    * @dev This function tries to decrease the active balance of a juror for the next term based on the requested
    *      amount. It can be seen as a way to early-slash a juror's active balance.
    * @param _juror Juror to collect the tokens from
    * @param _amount Amount of tokens to be collected from the given juror and for the requested term id
    * @param _termId Current term id
    * @return True if the juror has enough unlocked tokens to be collected for the requested term, false otherwise
    */
    function collectTokens(address _juror, uint256 _amount, uint64 _termId) external onlyOwner returns (bool) {
        if (_amount == 0) {
            return true;
        }

        uint64 nextTermId = _termId + 1;
        Juror storage juror = jurorsByAddress[_juror];
        uint256 unlockedActiveBalance = _unlockedActiveBalanceOf(juror);
        uint256 nextTermDeactivationRequestAmount = _deactivationRequestedAmountForTerm(juror, nextTermId);

        // Check if the juror has enough unlocked tokens to collect the requested amount
        // Note that we're also considering the deactivation request if there is any
        uint256 totalUnlockedActiveBalance = unlockedActiveBalance.add(nextTermDeactivationRequestAmount);
        if (_amount > totalUnlockedActiveBalance) {
            return false;
        }

        // Check if the amount of active tokens is enough to collect the requested amount, otherwise reduce the requested deactivation amount of
        // the next term. Note that this behaviour is different to the one when drafting jurors since this function is called as a side effect
        // of a juror deliberately voting in a final round, while drafts occur randomly.
        if (_amount > unlockedActiveBalance) {
            // No need for SafeMath: amounts were already checked above
            uint256 amountToReduce = _amount - unlockedActiveBalance;
            _reduceDeactivationRequest(_juror, amountToReduce, _termId);
            tree.set(juror.id, nextTermId, 0);
        } else {
            tree.update(juror.id, nextTermId, _amount, false);
        }

        emit JurorTokensCollected(_juror, _amount, nextTermId);
        return true;
    }

    /**
    * @dev ERC900 - Tell the address of the token used for staking
    * @return Address of the token used for staking
    */
    function token() external view returns (address) {
        return address(jurorsToken);
    }

    /**
    * @dev ERC900 - Tell if the current registry supports historic information or not
    * @return Always false
    */
    function supportsHistory() external pure returns (bool) {
        return false;
    }

    /**
    * @dev ERC900 - Tell the total amount of juror tokens held by the registry contract
    * @return Amount of juror tokens held by the registry contract
    */
    function totalStaked() external view returns (uint256) {
        return jurorsToken.balanceOf(address(this));
    }

    /**
    * @dev Tell the total amount of active juror tokens
    * @return Total amount of active juror tokens
    */
    function totalActiveBalance() external view returns (uint256) {
        return tree.getTotal();
    }

    /**
    * @dev Tell the total amount of active juror tokens at the given term id
    * @param _termId Term id querying the total active balance for
    * @return Total amount of active juror tokens at the given term id
    */
    function totalActiveBalanceAt(uint64 _termId) external view returns (uint256) {
        return _totalActiveBalanceAt(_termId);
    }

    /**
    * @dev Tell the active balance of a juror for a given term id
    * @param _juror Address of the juror querying the active balance of
    * @param _termId Term id querying the active balance for
    * @return Amount of active tokens for juror in the requested past term id
    */
    function activeBalanceOfAt(address _juror, uint64 _termId) external view returns (uint256) {
        return _activeBalanceOfAt(_juror, _termId);
    }

    /**
    * @dev Tell the minimum amount of tokens jurors have to activate to participate in the Court
    * @return Minimum amount of tokens jurors hav to activate to participate in the Court
    */
    function minJurorsActiveBalance() external view returns (uint256) {
        return minActiveBalance;
    }

    /**
    * @dev Tell the identification number associated to a juror address
    * @param _juror Address of the juror querying the identification number of
    * @return Identification number associated to a juror address, zero in case it wasn't registered yet
    */
    function getJurorId(address _juror) external view returns (uint256) {
        return jurorsByAddress[_juror].id;
    }

    /**
    * @dev Calculate the number of times that the total active balance contains the min active balance.
    *      Used to calculate the jurors number for final rounds at the current term.
    * @param _termId Term querying that multiple
    * @param _precision Multiplier to mitigate division rounding errors
    * @return The number of times that the total active balance contains the min active balance.
    *         Equals Jurors number for final rounds for the given term.
    */
    function getTotalMinActiveBalanceShares(uint64 _termId, uint256 _precision) external view returns (uint256) {
        // Total active balance is guaranteed to never be greater than
        // `2^64 * minActiveBalance / FINAL_ROUND_WEIGHT_PRECISION`. Thus, the
        // jurors number for a final round will always fit in `uint64`
        return _precision.mul(_totalActiveBalanceAt(_termId)) / minActiveBalance;
    }

    /**
    * @dev Calculate a juror's active balance and the number of times that it contains the min active balance.
    *      Used to get the juror weight for the final round. Note that for the final round the weight of
    *      each juror is equal to the number of times the min active balance the juror has, multiplied by a precision
    *      factor to deal with division rounding.
    * @param _juror Address of the juror to calculate the balance info
    * @param _termId Term querying the balance info
    * @param _precision Multiplier to mitigate division rounding errors
    * @return Weight of the requested juror for the final round of the given dispute
    */
    function getActiveBalanceInfo(address _juror, uint64 _termId, uint256 _precision)
        external view returns (uint256 activeBalance, uint256 shares)
    {
        activeBalance = _activeBalanceOfAt(_juror, _termId);

        // Note that jurors may not reach the minimum active balance since some might have been slashed. If that occurs,
        // these jurors cannot vote in the final round.
        if (activeBalance < minActiveBalance) {
            return (activeBalance, 0);
        }

        // Otherwise, return the times the active balance of the juror fits in the min active balance, multiplying
        // it by a round factor to ensure a better precision rounding.
        shares = _precision.mul(activeBalance) / minActiveBalance;
    }

    /**
    * @dev Callback of approveAndCall, allows staking directly with a transaction to the token contract.
    * @param _from Address making the transfer
    * @param _amount Amount of tokens to transfer
    * @param _token Address of the token
    * @param _data Optional data that can be used to request the activation of the transferred tokens
    */
    function receiveApproval(address _from, uint256 _amount, address _token, bytes memory _data) public {
        require(msg.sender == _token && _token == address(jurorsToken), ERROR_TOKEN_APPROVE_NOT_ALLOWED);
        _stake(_from, _from, _amount, _data);
    }

    /**
    * @dev Tell the balance information of a juror
    * @param _juror Address of the juror querying the balance information of
    * @return active Amount of active tokens of a juror
    * @return available Amount of available tokens of a juror
    * @return locked Amount of active tokens that are locked due to ongoing disputes
    * @return pendingDeactivation Amount of active tokens that were requested for deactivation
    */
    function balanceOf(address _juror) public view returns (uint256 active, uint256 available, uint256 locked, uint256 pendingDeactivation) {
        Juror storage juror = jurorsByAddress[_juror];

        active = _existsJuror(juror) ? tree.getItem(juror.id) : 0;
        (available, locked, pendingDeactivation) = _getBalances(juror);
    }

    /**
    * @dev Tell the balance information of a juror, fecthing tree one at a given term
    * @param _juror Address of the juror querying the balance information of
    * @param _termId Term id querying the active balance for
    * @return active Amount of active tokens of a juror
    * @return available Amount of available tokens of a juror
    * @return locked Amount of active tokens that are locked due to ongoing disputes
    * @return pendingDeactivation Amount of active tokens that were requested for deactivation
    */
    function balanceOfAt(address _juror, uint64 _termId)
        public view returns (uint256 active, uint256 available, uint256 locked, uint256 pendingDeactivation)
    {
        Juror storage juror = jurorsByAddress[_juror];

        active = _existsJuror(juror) ? tree.getItemAt(juror.id, _termId) : 0;
        (available, locked, pendingDeactivation) = _getBalances(juror);
    }

    /**
    * @dev ERC900 - Tell the total amount of tokens of juror. This includes the active balance, the available
    *      balances, and the pending balance for deactivation. Note that we don't have to include the locked
    *      balances since these represent the amount of active tokens that are locked for drafts, i.e. these
    *      are included in the active balance of the juror.
    * @return Total amount of tokens of a juror
    */
    function totalStakedFor(address _juror) public view returns (uint256) {
        (uint256 active, uint256 available, , uint256 pendingDeactivation) = balanceOf(_juror);
        return available.add(active).add(pendingDeactivation);
    }

    /**
    * @dev Tell the amount of active tokens of a juror that are not locked due to ongoing disputes
    * @param _juror Address of the juror querying the unlocked balance of
    * @return Amount of active tokens of a juror that are not locked due to ongoing disputes
    */
    function unlockedActiveBalanceOf(address _juror) public view returns (uint256) {
        Juror storage juror = jurorsByAddress[_juror];
        return _unlockedActiveBalanceOf(juror);
    }

    /**
    * @dev Internal function to activate a given amount of tokens for a juror.
    *      This function assumes that the given term is the current term and has already been ensured.
    * @param _juror Address of the juror to activate tokens
    * @param _termId Current term id
    * @param _amount Amount of juror tokens to be activated
    */
    function _activateTokens(address _juror, uint64 _termId, uint256 _amount) internal {
        uint64 nextTermId = _termId + 1;
        _checkTotalActiveBalance(nextTermId, _amount);
        Juror storage juror = jurorsByAddress[_juror];

        if (_existsJuror(juror)) {
            // Even though we are adding amounts, let's check the new active balance is greater than or equal to the
            // minimum active amount. Note that the juror might have been slashed.
            uint256 activeBalance = tree.getItem(juror.id);
            require(activeBalance.add(_amount) >= minActiveBalance, ERROR_ACTIVE_BALANCE_BELOW_MIN);
            tree.update(juror.id, nextTermId, _amount, true);
        } else {
            require(_amount >= minActiveBalance, ERROR_ACTIVE_BALANCE_BELOW_MIN);
            juror.id = tree.insert(nextTermId, _amount);
            jurorsAddressById[juror.id] = _juror;
        }

        _updateAvailableBalanceOf(_juror, _amount, false);
        emit JurorActivated(_juror, nextTermId, _amount);
    }

    /**
    * @dev Internal function to create a token deactivation request for a juror. Jurors will be allowed
    *      to process a deactivation request from the next term. This function assumes that the given
    *      term is the current term and has already been ensured.
    * @param _juror Address of the juror to create a token deactivation request for
    * @param _termId Current term id
    * @param _amount Amount of juror tokens requested for deactivation
    */
    function _createDeactivationRequest(address _juror, uint64 _termId, uint256 _amount) internal {
        // Try to clean a previous deactivation request if possible
        _processDeactivationRequest(_juror, _termId);

        uint64 nextTermId = _termId + 1;
        Juror storage juror = jurorsByAddress[_juror];
        DeactivationRequest storage request = juror.deactivationRequest;
        request.amount = request.amount.add(_amount);
        request.availableTermId = nextTermId;
        tree.update(juror.id, nextTermId, _amount, false);

        emit JurorDeactivationRequested(_juror, nextTermId, _amount);
    }

    /**
    * @dev Internal function to process a token deactivation requested by a juror. It will move the requested amount
    *      to the available balance of the juror if the term when the deactivation was requested has already finished.
    * @param _juror Address of the juror to process the deactivation request of
    * @param _termId Current term id
    */
    function _processDeactivationRequest(address _juror, uint64 _termId) internal {
        Juror storage juror = jurorsByAddress[_juror];
        DeactivationRequest storage request = juror.deactivationRequest;
        uint64 deactivationAvailableTermId = request.availableTermId;

        // If there is a deactivation request, ensure that the deactivation term has been reached
        if (deactivationAvailableTermId == uint64(0) || _termId < deactivationAvailableTermId) {
            return;
        }

        uint256 deactivationAmount = request.amount;
        // Note that we can use a zeroed term id to denote void here since we are storing
        // the minimum allowed term to deactivate tokens which will always be at least 1
        request.availableTermId = uint64(0);
        request.amount = 0;
        _updateAvailableBalanceOf(_juror, deactivationAmount, true);

        emit JurorDeactivationProcessed(_juror, deactivationAvailableTermId, deactivationAmount, _termId);
    }

    /**
    * @dev Internal function to reduce a token deactivation requested by a juror. It assumes the deactivation request
    *      cannot be processed for the given term yet.
    * @param _juror Address of the juror to reduce the deactivation request of
    * @param _amount Amount to be reduced from the current deactivation request
    * @param _termId Term id in which the deactivation request is being reduced
    */
    function _reduceDeactivationRequest(address _juror, uint256 _amount, uint64 _termId) internal {
        Juror storage juror = jurorsByAddress[_juror];
        DeactivationRequest storage request = juror.deactivationRequest;
        uint256 currentRequestAmount = request.amount;
        require(currentRequestAmount >= _amount, ERROR_CANNOT_REDUCE_DEACTIVATION_REQUEST);

        // No need for SafeMath: we already checked values above
        uint256 newRequestAmount = currentRequestAmount - _amount;
        request.amount = newRequestAmount;
        emit JurorDeactivationUpdated(_juror, request.availableTermId, newRequestAmount, _termId);
    }

    /**
    * @dev Internal function to stake an amount of tokens for a juror
    * @param _from Address sending the amount of tokens to be deposited
    * @param _juror Address of the juror to deposit the tokens to
    * @param _amount Amount of tokens to be deposited
    * @param _data Optional data that can be used to request the activation of the deposited tokens
    */
    function _stake(address _from, address _juror, uint256 _amount, bytes memory _data) internal {
        _deposit(_from, _juror, _amount, _data);
        emit Staked(_juror, _amount, totalStakedFor(_juror), _data);
    }

    /**
    * @dev Internal function to unstake an amount of tokens of a juror
    * @param _juror Address of the juror to to unstake the tokens of
    * @param _amount Amount of tokens to be unstaked
    * @param _data Optional data is never used by this function, only logged
    */
    function _unstake(address _juror, uint256 _amount, bytes memory _data) internal {
        _withdraw(_juror, _amount);
        emit Unstaked(_juror, _amount, totalStakedFor(_juror), _data);
    }

    /**
    * @dev Internal function to deposit an amount of available tokens for a juror
    * @param _from Address sending the amount of tokens to be deposited
    * @param _juror Address of the juror to deposit the tokens to
    * @param _amount Amount of available tokens to be withdrawn
    * @param _data Optional data that can be used to request the activation of the deposited tokens
    */
    function _deposit(address _from, address _juror, uint256 _amount, bytes memory _data) internal {
        require(_amount > 0, ERROR_INVALID_ZERO_AMOUNT);
        _updateAvailableBalanceOf(_juror, _amount, true);

        // Activate tokens if it was requested and the address depositing tokens is the juror. Note that there's
        // no need to check the activation amount since we have just added it to the available balance of the juror
        if (_from == _juror && _data.toBytes4() == JurorsRegistry(this).activate.selector) {
            uint64 termId = owner.ensureAndGetTermId();
            _activateTokens(_juror, termId, _amount);
        }

        require(jurorsToken.safeTransferFrom(_from, address(this), _amount), ERROR_TOKEN_TRANSFER_FAILED);
    }

    /**
    * @dev Internal function to withdraw an amount of available tokens from a juror
    * @param _juror Address of the juror to withdraw the tokens from
    * @param _amount Amount of available tokens to be withdrawn
    */
    function _withdraw(address _juror, uint256 _amount) internal {
        require(_amount > 0, ERROR_INVALID_ZERO_AMOUNT);

        // Try to process a deactivation request for the current term if there is one. Note that we don't need to ensure
        // the current term this time since deactivation requests always work with future terms, which means that if
        // the current term is outdated, it will never match the deactivation term id. We avoid ensuring the term here
        // to avoid forcing jurors to do that in order to withdraw their available balance.
        _processDeactivationRequest(_juror, owner.getLastEnsuredTermId());

        _updateAvailableBalanceOf(_juror, _amount, false);
        require(jurorsToken.safeTransfer(_juror, _amount), ERROR_TOKEN_TRANSFER_FAILED);
    }

    /**
    * @dev Internal function to update the available balance of a juror
    * @param _juror Juror to update the available balance of
    * @param _amount Amount of tokens to be added to or removed from the available balance of a juror
    * @param _positive True if the given amount should be added, or false to remove it from the available balance
    */
    function _updateAvailableBalanceOf(address _juror, uint256 _amount, bool _positive) internal {
        // We are not using a require here to avoid reverting in case any of the accounting maths reaches this point
        // with a zeroed amount value. Instead, we are doing this validation in the external entry points such as
        // stake, unstake, activate, deactivate, among others.
        if (_amount == 0) {
            return;
        }

        Juror storage juror = jurorsByAddress[_juror];
        if (_positive) {
            juror.availableBalance = juror.availableBalance.add(_amount);
        } else {
            require(_amount <= juror.availableBalance, ERROR_NOT_ENOUGH_AVAILABLE_BALANCE);
            // No need for SafeMath: we already checked values right above
            juror.availableBalance -= _amount;
        }
        emit JurorAvailableBalanceChanged(_juror, _amount, _positive);
    }

    /**
    * @dev Internal function to draft a set of jurors based on a given set of params
    * @param _draftParams Params to be used for the jurors draft
    * @param _jurors List of unique jurors selected for the draft
    * @param _weights List of weights corresponding to each juror selected for the draft
    * @return Number of unique jurors selected for the draft. Note that this value may differ from the number of requested jurors
    */
    function _draft(DraftParams memory _draftParams, address[] memory _jurors, uint64[] memory _weights) internal returns (uint256) {
        uint256 outputLength = 0;
        uint256 requestedJurors = _draftParams.batchRequestedJurors;
        // Jurors returned by the tree multi-sortition may not have enough unlocked active balance to be drafted. Thus,
        // we compute several sortitions until all the requested jurors are selected. To guarantee a different set of
        // jurors on each sortition, the iteration number will be part of the random seed to be used in the sortition.
        // Note that this loop could end with an OOG error.
        for (_draftParams.sortitionIteration = 0; requestedJurors > 0; _draftParams.sortitionIteration++) {
            (uint256[] memory jurorIds, uint256[] memory activeBalances) = _treeSearch(_draftParams);

            for (uint256 i = 0; i < jurorIds.length && requestedJurors > 0; i++) {
                // We assume the selected jurors are registered in the registry, we are not checking their addresses exist
                address juror = jurorsAddressById[jurorIds[i]];
                Juror storage _juror = jurorsByAddress[juror];

                // Compute new locked balance for a juror based on the penalty applied when being drafted
                uint256 newLockedBalance = _juror.lockedBalance.add(_draftParams.draftLockAmount);

                // Check if there is any deactivation requests for the next term. Drafts are always computed for the current term
                // but we have to make sure we are locking an amount that will exist in the next term.
                uint256 nextTermDeactivationRequestAmount = _deactivationRequestedAmountForTerm(_juror, _draftParams.termId + 1);

                // Check if juror has enough active tokens to lock the requested amount for the draft, skip it otherwise.
                if (activeBalances[i].sub(nextTermDeactivationRequestAmount) >= newLockedBalance) {
                    _juror.lockedBalance = newLockedBalance;

                    // Check repeated juror, we assume jurors come ordered from tree search. Note that since the tree
                    // search can be called more than once, if some juror doesn't have enough balance, the final
                    // result of this function may not be ordered and contain repeated entries.
                    if (outputLength > 0 && _jurors[outputLength - 1] == juror) {
                        _weights[outputLength - 1]++;
                    } else {
                        _jurors[outputLength] = juror;
                        _weights[outputLength]++;
                        outputLength++;
                    }
                    requestedJurors--;
                    emit JurorDrafted(_draftParams.disputeId, juror);
                }
            }
        }
        return outputLength;
    }

    /**
    * @dev Tell the active balance of a juror for a given term id
    * @param _juror Address of the juror querying the active balance of
    * @param _termId Term id querying the active balance for
    * @return Amount of active tokens for juror in the requested past term id
    */
    function _activeBalanceOfAt(address _juror, uint64 _termId) internal view returns (uint256) {
        Juror storage juror = jurorsByAddress[_juror];
        return _existsJuror(juror) ? tree.getItemAt(juror.id, _termId) : 0;
    }

    /**
    * @dev Internal function to get the amount of active tokens of a juror that are not locked due to ongoing disputes
    * @param _juror Juror querying the unlocked active balance of
    * @return Amount of active tokens of a juror that are not locked due to ongoing disputes
    */
    function _unlockedActiveBalanceOf(Juror storage _juror) internal view returns (uint256) {
        return _existsJuror(_juror) ? tree.getItem(_juror.id).sub(_juror.lockedBalance) : 0;
    }

    /**
    * @dev Internal function to check if a juror was already registered
    * @param _juror Juror to be checked
    * @return True if the given juror was already registered, false otherwise
    */
    function _existsJuror(Juror storage _juror) internal view returns (bool) {
        return _juror.id != 0;
    }

    /**
    * @dev Internal function to get the amount of a deactivation request for a given term id
    * @param _juror Juror to query the deactivation request amount of
    * @param _termId Term id of the deactivation request to be queried
    * @return Amount of the deactivation request for the given term, 0 otherwise
    */
    function _deactivationRequestedAmountForTerm(Juror storage _juror, uint64 _termId) internal view returns (uint256) {
        DeactivationRequest storage request = _juror.deactivationRequest;
        return request.availableTermId == _termId ? request.amount : 0;
    }

    /**
    * @dev Internal function to tell the total amount of active juror tokens at the given term id
    * @param _termId Term id querying the total active balance for
    * @return Total amount of active juror tokens at the given term id
    */
    function _totalActiveBalanceAt(uint64 _termId) internal view returns (uint256) {
        // This function will return always the same values, the only difference remains on gas costs. The
        // function `totalSumAt` will perform a backwards linear search from the last checkpoint or a binary search
        // depending on whether the given checkpoint is considered to be recent or not. In this case, we consider
        // current or future terms as recent ones.
        bool recent = _termId >= owner.getLastEnsuredTermId();
        return recent ? tree.getRecentTotalAt(_termId) : tree.getTotalAt(_termId);
    }

    /**
    * @dev Internal function to check if its possible to add a given new amount to the registry or not
    * @param _termId Term id when the new amount will be added
    * @param _amount Amount of tokens willing to be added to the registry
    */
    function _checkTotalActiveBalance(uint64 _termId, uint256 _amount) internal view {
        uint256 currentTotalActiveBalance = _totalActiveBalanceAt(_termId);
        uint256 newTotalActiveBalance = currentTotalActiveBalance.add(_amount);
        require(newTotalActiveBalance <= totalActiveBalanceLimit, ERROR_TOTAL_ACTIVE_BALANCE_EXCEEDED);
    }

    /**
    * @dev Tell the local balance information of a juror (that is not on the tree)
    * @param _juror Address of the juror querying the balance information of
    * @return available Amount of available tokens of a juror
    * @return locked Amount of active tokens that are locked due to ongoing disputes
    * @return pendingDeactivation Amount of active tokens that were requested for deactivation
    */
    function _getBalances(Juror storage _juror) internal view returns (uint256 available, uint256 locked, uint256 pendingDeactivation) {
        available = _juror.availableBalance;
        locked = _juror.lockedBalance;
        pendingDeactivation = _juror.deactivationRequest.amount;
    }

    /**
    * @dev Internal function to search jurors in the tree based on certain search restrictions
    * @param _params Draft params to be used for the jurors search
    * @return ids List of juror ids obtained based on the requested search
    * @return activeBalances List of active balances for each juror obtained based on the requested search
    */
    function _treeSearch(DraftParams memory _params) internal view returns (uint256[] memory ids, uint256[] memory activeBalances) {
        (ids, activeBalances) = tree.batchedRandomSearch(
            _params.termRandomness,
            _params.disputeId,
            _params.termId,
            _params.selectedJurors,
            _params.batchRequestedJurors,
            _params.roundRequestedJurors,
            _params.sortitionIteration
        );
    }

    /**
    * @dev Private function to parse a certain set given of draft params
    * @param _params Array containing draft requirements:
    *        0. bytes32 Term randomness
    *        1. uint256 Dispute id
    *        2. uint64  Current term id
    *        3. uint256 Number of seats already filled
    *        4. uint256 Number of seats left to be filled
    *        5. uint64  Number of jurors required for the draft
    *        6. uint16  Per ten thousand of the minimum active balance to be locked for the draft
    *
    * @return Draft params object parsed
    */
    function _buildDraftParams(uint256[7] memory _params) private view returns (DraftParams memory) {
        return DraftParams({
            termRandomness: bytes32(_params[0]),
            disputeId: _params[1],
            termId: uint64(_params[2]),
            selectedJurors: _params[3],
            batchRequestedJurors: _params[4],
            roundRequestedJurors: _params[5],
            draftLockAmount: minActiveBalance.pct(uint16(_params[6])),
            sortitionIteration: 0
        });
    }
}
