pragma solidity ^0.4.24;

import "@aragon/os/contracts/common/IsContract.sol";
import "@aragon/os/contracts/common/Initializable.sol";
import "@aragon/os/contracts/lib/token/ERC20.sol";
import "@aragon/os/contracts/common/SafeERC20.sol";
import "@aragon/os/contracts/lib/math/SafeMath.sol";
import { ApproveAndCallFallBack } from "@aragon/apps-shared-minime/contracts/MiniMeToken.sol";

import "./lib/BytesHelpers.sol";
import "./lib/HexSumTree.sol";
import "./standards/erc900/ERC900.sol";
import "./standards/erc900/IStakingOwner.sol";


contract JurorsRegistry is Initializable, IsContract, ERC900, ApproveAndCallFallBack {
    using SafeERC20 for ERC20;
    using SafeMath for uint256;
    using BytesHelpers for bytes;
    using HexSumTree for HexSumTree.Tree;

    string internal constant ERROR_NOT_CONTRACT = "REGISTRY_NOT_CONTRACT";
    string internal constant ERROR_SENDER_NOT_OWNER = "REGISTRY_SENDER_NOT_OWNER";
    string internal constant ERROR_INVALID_ZERO_AMOUNT = "REGISTRY_INVALID_ZERO_AMOUNT";
    string internal constant ERROR_INVALID_ACTIVATION_AMOUNT = "REGISTRY_INVALID_ACTIVATION_AMOUNT";
    string internal constant ERROR_INVALID_DEACTIVATION_AMOUNT = "REGISTRY_INVALID_DEACTIVATION_AMOUNT";
    string internal constant ERROR_NOT_ENOUGH_BALANCE = "REGISTRY_NOT_ENOUGH_BALANCE";
    string internal constant ERROR_TOKEN_TRANSFER_FAILED = "REGISTRY_TOKEN_TRANSFER_FAILED";
    string internal constant ERROR_TOKENS_BELOW_MIN_STAKE = "REGISTRY_TOKENS_BELOW_MIN_STAKE";
    string internal constant ERROR_SORTITION_LENGTHS_MISMATCH = "REGISTRY_SORTITION_LENGTHS_MISMATCH";

    uint64 internal constant MAX_UINT64 = uint64(-1);
    uint256 internal constant PCT_BASE = 10000; // %
    address internal constant BURN_ACCOUNT = 0xdead;

    /*
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

    /*
    * @dev Given that the jurors balances cannot be affected during a Court term, if jurors want to deactivate some
    *      of their tokens, the tree will always be updated for the following term, and they won't be able to
    *      withdraw the requested amount until the current term has finished. Thus, we need to keep track the term
    *      when a token deactivation was requested and its corresponding amount.
    */
    struct DeactivationRequest {
        uint256 amount;             // amount requested for deactivation
        uint64 availableTermId;     // id of the term when jurors can withdraw their requested deactivation tokens
    }

    // Jurors registry owner address
    IStakingOwner public owner;

    // Minimum amount of tokens jurors can activate to participate in the Court
    uint256 public minActiveTokens;

    // Juror ERC20 token
    ERC20 internal jurorsToken;

    // Mapping of juror data indexed by address
    mapping (address => Juror) internal jurorsByAddress;

    // Mapping of juror addresses indexed by id
    mapping (uint256 => address) internal jurorsAddressById;

    // Tree to store jurors active balance by term for the drafting process
    HexSumTree.Tree private tree;

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
    * @notice Initialize jurors registry with a minimum active amount of `@tokenAmount(_token, _minActiveTokens)`.
    * @param _owner Address to be set as the owner of the jurors registry
    * @param _jurorToken Address of the ERC20 token to be used as juror token for the registry
    * @param _minActiveTokens Minimum amount of juror tokens that can be activated
    */
    function init(IStakingOwner _owner, ERC20 _jurorToken, uint256 _minActiveTokens) external {
        require(isContract(_owner), ERROR_NOT_CONTRACT);
        require(isContract(_jurorToken), ERROR_NOT_CONTRACT);

        initialized();
        owner = _owner;
        jurorsToken = _jurorToken;
        minActiveTokens = _minActiveTokens;

        tree.init();
        assert(tree.insert(0, 0) == 0); // first tree item is an empty juror
    }

    /**
    * @notice Activate `@tokenAmount(self.token(), _amount)` for the next term
    * @param _amount Amount of juror tokens to be activated for the next term
    */
    function activate(uint256 _amount) external isInitialized {
        uint64 termId = owner.ensureAndGetTermId();

        _processDeactivationRequest(msg.sender, termId);

        uint256 availableBalance = jurorsByAddress[msg.sender].availableBalance;
        uint256 amountToActivate = _amount == uint256(0) ? availableBalance : _amount;
        require(amountToActivate > 0, ERROR_INVALID_ZERO_AMOUNT);
        require(amountToActivate <= availableBalance, ERROR_INVALID_ACTIVATION_AMOUNT);

        _activateTokens(msg.sender, termId, amountToActivate);
    }

    /**
    * @notice Deactivate `@tokenAmount(self.token(), _amount)` for the next term
    * @param _amount Amount of juror tokens to be deactivated for the next term
    */
    function deactivate(uint256 _amount) external isInitialized {
        uint64 termId = owner.ensureAndGetTermId();

        require(_amount > 0, ERROR_INVALID_ZERO_AMOUNT);
        uint256 unlockedBalance = unlockedBalanceOf(msg.sender);
        require(_amount <= unlockedBalance, ERROR_INVALID_DEACTIVATION_AMOUNT);
        uint256 futureActiveBalance = unlockedBalance.sub(_amount);
        require(futureActiveBalance == uint256(0) || futureActiveBalance >= minActiveTokens, ERROR_INVALID_DEACTIVATION_AMOUNT);

        _createDeactivationRequest(msg.sender, termId, _amount);
    }

    /**
    * @notice Stake `@tokenAmount(self.token(), _amount)` for the sender to the Court
    * @param _amount Amount of tokens to be staked
    * @param _data Optional data that can be used to request the activation of the transferred tokens
    */
    function stake(uint256 _amount, bytes _data) external isInitialized {
        _stake(msg.sender, msg.sender, _amount, _data);
    }

    /**
    * @notice Stake `@tokenAmount(self.token(), _amount)` for `_to` to the Court
    * @param _to Address to stake an amount of tokens to
    * @param _amount Amount of tokens to be staked
    * @param _data Optional data that can be used to request the activation of the transferred tokens
    */
    function stakeFor(address _to, uint256 _amount, bytes _data) external isInitialized {
        _stake(msg.sender, _to, _amount, _data);
    }

    /**
    * @notice Unstake `@tokenAmount(self.token(), _amount)` for `_to` from the Court
    * @param _amount Amount of tokens to be unstaked
    * @param _data Optional data is never used by this function, only logged
    */
    function unstake(uint256 _amount, bytes _data) external isInitialized {
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
    *        6. uint16  Percentage of the minimum active balance to be locked for the draft
    *
    * @return jurors List of jurors selected for the draft
    * @return weights List of weights corresponding to each juror
    * @return jurorsLength Number of jurors selected for the draft // TODO: shouldn't this be eq to jurors.length?
    * @return filledSeats Number of seats filled for the draft
    */
    function draft(uint256[7] _params) external onlyOwner
        returns (address[] jurors, uint64[] weights, uint256 jurorsLength, uint64 filledSeats)
    {
        uint256 roundSeatsLeft = _params[4]; // _jurorsRequested
        jurors = new address[](roundSeatsLeft);
        weights = new uint64[](roundSeatsLeft);
        filledSeats = uint64(_params[3]); // _filledSeats

        // to add "randomness" to sortition call in order to avoid getting stuck by
        // getting the same overleveraged juror over and over
        uint256 sortitionIteration = 0;

        while (roundSeatsLeft > 0) {
            uint256[7] memory treeSearchParams = [
                _params[0], // _randomness
                _params[1], // _disputeId
                _params[2], // _termId
                filledSeats,
                roundSeatsLeft,
                _params[5], // _jurorNumber
                sortitionIteration
            ];

            (uint256[] memory jurorIds, uint256[] memory stakes) = _treeSearch(treeSearchParams);
            require(jurorIds.length == stakes.length, ERROR_SORTITION_LENGTHS_MISMATCH);
            require(jurorIds.length == roundSeatsLeft, ERROR_SORTITION_LENGTHS_MISMATCH);

            for (uint256 i = 0; i < jurorIds.length; i++) {
                address juror = jurorsAddressById[jurorIds[i]];
                Juror storage _juror = jurorsByAddress[juror];
                uint256 newLockedBalance = _juror.lockedBalance.add(_draftLockAmount(uint16(_params[6]))); // _penaltyPct

                // Check if juror has enough active tokens to lock the requested amount for the draft, skip it
                // otherwise. Note that there's no need to check deactivation requests since these always apply
                // for the next term, while drafts are always computed for the current term with the active balances
                // which always remain constant for the current term.
                if(stakes[i] >= newLockedBalance) {
                    _juror.lockedBalance = newLockedBalance;

                    // Check repeated juror, we assume jurors come ordered from tree search
                    if (jurorsLength > 0 && jurors[jurorsLength - 1] == juror) {
                        weights[jurorsLength - 1]++;
                    } else {
                        jurors[jurorsLength] = juror;
                        weights[jurorsLength]++;
                        jurorsLength++;
                    }
                    filledSeats++;

                    //                _disputeId
                    emit JurorDrafted(_params[1], juror);
                    roundSeatsLeft--;
                }
            }
            sortitionIteration++;
        }
    }

    /**
    * @dev Slash a set of jurors based on their votes compared to the winning ruling
    * @param _termId Current term id
    * @param _jurors List of juror addresses to be slashed
    * @param _penalties List of amount of tokens to be slashed for each corresponding juror
    * @param _castVotes List of outcomes voted for each corresponding juror
    * @param _winningRuling Winning ruling to compare the vote of each juror to be slashed
    * @return Total amount of slashed tokens
    */
    function slash(uint64 _termId, address[] _jurors, uint256[] _penalties, uint8[] _castVotes, uint8 _winningRuling)
        external
        onlyOwner
        returns (uint256)
    {
        // TODO: should we add validations for this?
        // we assume this: require(_jurors.length == _penalties.length);
        // we assume this: require(_jurors.length == _castVotes.length);

        uint64 nextTermId = _termId + 1;
        uint256 collectedTokens;

        for (uint256 i = 0; i < _jurors.length; i++) {
            uint256 penalty = _penalties[i];
            Juror storage juror = jurorsByAddress[_jurors[i]];
            juror.lockedBalance = juror.lockedBalance.sub(penalty);

            // Slash jurors that didn't vote for the winning ruling. Note that there's no need to check if there
            // was a deactivation request since we're working with already locked balances
            if (_castVotes[i] != _winningRuling) {
                collectedTokens = collectedTokens.add(penalty);
                tree.update(juror.id, nextTermId, penalty, false);
            }
        }

        return collectedTokens;
    }

    /**
    * @notice Try to collect `@tokenAmount(self.token(), _amount)` from `_juror` for the term #`_termId + 1`.
    * @param _juror Juror to collect the tokens from
    * @param _amount Amount of tokens to be collected from the given juror and for the requested term id
    * @param _termId Current term id
    * @return True if the juror has enough unlocked tokens to be collected for the requested term, false otherwise
    */
    function collectTokens(address _juror, uint256 _amount, uint64 _termId) external onlyOwner returns (bool) {
        uint64 nextTermId = _termId + 1;

        // TODO: does it make sense to validate this scenario?
        if (_amount == uint256(0)) {
            emit JurorTokensCollected(_juror, _amount, nextTermId);
            return true;
        }

        Juror storage juror = jurorsByAddress[_juror];
        uint256 unlockedBalance = _unlockedBalanceOf(juror);
        uint256 nextTermDeactivationRequestAmount = _deactivationRequestedAmountForTerm(juror, nextTermId);

        // Check if the juror has enough unlocked tokens to collect the requested amount
        // Note that we're also considering the deactivation request if there is any
        uint256 totalUnlockedBalance = unlockedBalance.add(nextTermDeactivationRequestAmount);
        if (_amount > totalUnlockedBalance) {
            return false;
        }

        // Check if the amount of active tokens is enough to collect the requested amount,
        // otherwise reduce the requested deactivation amount of the next term
        if (_amount > unlockedBalance) {
            // Note there's no need to use SafeMath here, amounts were already checked above
            uint256 amountToReduce = _amount - unlockedBalance;
            _reduceDeactivationRequest(_juror, amountToReduce, _termId);
            tree.set(juror.id, nextTermId, uint256(0));
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
        return jurorsToken.balanceOf(this);
    }

    /**
    * @dev Tell the identification number associated to a juror address
    * @param _juror Address of the juror querying the identification number of
    * @return Identification number associated to a juror address, zero in case it wasn't registered yet
    */
    function jurorId(address _juror) external view returns (uint256) {
        return jurorsByAddress[_juror].id;
    }

    /**
    * @dev Callback of approveAndCall, allows staking directly with a transaction to the token contract.
    * @param _from The address making the transfer
    * @param _amount Amount of tokens to transfer
    * @param _token Address of the token
    * @param _data Optional data that can be used to request the activation of the transferred tokens
    */
    function receiveApproval(address _from, uint256 _amount, address _token, bytes _data) public {
        if (msg.sender == _token && _token == address(jurorsToken)) {
            _stake(_from, _from, _amount, _data);
        }
    }

    /**
    * @dev Tell the balance information of a juror
    * @param _juror Address of the juror querying the balance information of
    * @return active Amount of active tokens of a juror
    * @return available Amount of available tokens of a juror
    * @return locked Amount of active tokens that are locked due to ongoing disputes
    */
    function balanceOf(address _juror) public view returns (uint256 active, uint256 available, uint256 locked, uint256 pendingDeactivation) {
        Juror storage juror = jurorsByAddress[_juror];

        active = _existsJuror(juror) ? tree.getItem(juror.id) : uint256(0);
        available = juror.availableBalance;
        locked = juror.lockedBalance;
        pendingDeactivation = juror.deactivationRequest.amount;
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
    function unlockedBalanceOf(address _juror) public view returns (uint256) {
        Juror storage juror = jurorsByAddress[_juror];
        return _unlockedBalanceOf(juror);
    }

    /**
    * @dev Tell the active balance of a juror for a given past term id
    * @param _juror Address of the juror querying the active balance of
    * @param _termId Past term id querying the active balance for
    * @return Amount of active tokens for juror in the requested past term id
    */
    function pastActiveBalanceOf(address _juror, uint64 _termId) public view returns (uint256) {
        // TODO: should we check that the juror exists?
        return tree.getItemPast(jurorsByAddress[_juror].id, _termId);
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
        Juror storage juror = jurorsByAddress[_juror];

        if (_existsJuror(juror)) {
            // Even though we are adding amounts, let's check the new active balance is greater than or equal to the
            // minimum active amount. Note that the juror might have been slashed.
            uint256 activeBalance = tree.getItem(juror.id);
            require(activeBalance.add(_amount) >= minActiveTokens, ERROR_TOKENS_BELOW_MIN_STAKE);
            tree.update(juror.id, nextTermId, _amount, true);
        } else {
            require(_amount >= minActiveTokens, ERROR_TOKENS_BELOW_MIN_STAKE);
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
        request.amount = uint256(0);
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
        uint256 newRequestAmount = request.amount.sub(_amount);
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
        // Try to process a deactivation request for the current term if there is one. Note that we don't need to ensure
        // the current term this time since deactivation requests always work with future terms, which means that if
        // the current term is outdated, it will never match the deactivation term id. We avoid ensuring the term here
        // to avoid forcing jurors to do that in order to withdraw their available balance.
        _processDeactivationRequest(_juror, owner.getTermId());

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
        require(_amount > 0, ERROR_INVALID_ZERO_AMOUNT);
        Juror storage juror = jurorsByAddress[_juror];

        if (_positive) {
            juror.availableBalance = juror.availableBalance.add(_amount);
        } else {
            require(_amount <= juror.availableBalance, ERROR_NOT_ENOUGH_BALANCE);
            juror.availableBalance = juror.availableBalance.sub(_amount);
        }

        emit JurorAvailableBalanceChanged(_juror, _amount, _positive);
    }

    /**
    * @dev Internal function to get the amount of active tokens of a juror that are not locked due to ongoing disputes
    * @param _juror Juror querying the unlocked active balance of
    * @return Amount of active tokens of a juror that are not locked due to ongoing disputes
    */
    function _unlockedBalanceOf(Juror storage _juror) internal view returns (uint256) {
        return _existsJuror(_juror) ? tree.getItem(_juror.id).sub(_juror.lockedBalance) : uint256(0);
    }

    /**
    * @dev Internal function to check if a juror was already registered
    * @param _juror Juror to be checked
    * @return True if the given juror was already registered, false otherwise
    */
    function _existsJuror(Juror storage _juror) internal view returns (bool) {
        return _juror.id != uint256(0);
    }

    /**
    * @dev Internal function to get the amount of a deactivation request for a given term id
    * @param _juror Juror to query the deactivation request amount of
    * @param _termId Term id of the deactivation request to be queried
    * @return Amount of the deactivation request for the given term, 0 otherwise
    */
    function _deactivationRequestedAmountForTerm(Juror storage _juror, uint64 _termId) internal view returns (uint256) {
        DeactivationRequest storage request = _juror.deactivationRequest;
        return request.availableTermId == _termId ? request.amount : uint256(0);
    }

    /**
    * @dev Internal function to tell the fraction of minimum active tokens that must be locked for a draft
    * @param _pct Percentage of the minimum active balance to be locked for a draft
    * @return The fraction of minimum active tokens that must be locked for a draft
    */
    function _draftLockAmount(uint16 _pct) internal view returns (uint256) {
        return minActiveTokens * uint256(_pct) / PCT_BASE;
    }

    /**
    * @dev Internal function to search jurors in the tree based on certain search restrictions
    * @param _treeSearchParams Array containing the search restrictions:
    *        0. bytes32 Term randomness
    *        1. uint256 Dispute id
    *        2. uint64  Current term id
    *        3. uint256 Number of seats already filled
    *        4. uint256 Number of seats left to be filled
    *        5. uint256 Number of jurors to be drafted
    *        6. uint256 Sortition iteration number
    *
    * @return ids List of juror ids obtained based on the requested search
    * @return stakes List of active balances for each juror obtained based on the requested search
    */
    function _treeSearch(uint256[7] _treeSearchParams) internal view returns (uint256[] ids, uint256[] stakes) {
        (ids, stakes) = tree.multiSortition(
            bytes32(_treeSearchParams[0]),  // _termRandomness,
            _treeSearchParams[1],           // _disputeId
            uint64(_treeSearchParams[2]),   // _termId
            false,                          // _past
            _treeSearchParams[3],           // _filledSeats
            _treeSearchParams[4],           // _jurorsRequested
            _treeSearchParams[5],           // _jurorNumber
            _treeSearchParams[6]            // _sortitionIteration
        );
    }
}
