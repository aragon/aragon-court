pragma solidity ^0.4.24;

import "@aragon/os/contracts/common/IsContract.sol";
import "@aragon/os/contracts/lib/token/ERC20.sol";
import "@aragon/os/contracts/common/SafeERC20.sol";
import "@aragon/os/contracts/lib/math/SafeMath.sol";
import { ApproveAndCallFallBack } from "@aragon/apps-shared-minime/contracts/MiniMeToken.sol";

import "./standards/sumtree/ISumTree.sol";
import "./standards/erc900/ERC900.sol";
import "./standards/erc900/IStaking.sol";


contract CourtStaking is IsContract, ERC900, ApproveAndCallFallBack, IStaking {
    using SafeERC20 for ERC20;
    using SafeMath for uint256;

    address internal constant BURN_ACCOUNT = 0xdead;
    uint64 internal constant MAX_UINT64 = uint64(-1);
    uint256 internal constant PCT_BASE = 10000; // ‱

    string internal constant ERROR_OWNER_ALREADY_SET = "STK_OWNER_ALREADY_SET";
    string internal constant ERROR_INVALID_ADDR = "STK_INVALID_ADDR";
    string internal constant ERROR_NOT_CONTRACT = "STK_NOT_CONTRACT";
    string internal constant ERROR_INVALID_ACCOUNT_STATE = "STK_INVALID_ACCOUNT_STATE";
    string internal constant ERROR_DEPOSIT_FAILED = "STK_DEPOSIT_FAILED";
    string internal constant ERROR_ZERO_TRANSFER = "STK_ZERO_TRANSFER";
    string internal constant ERROR_BALANCE_TOO_LOW = "STK_BALANCE_TOO_LOW";
    string internal constant ERROR_TOKENS_BELOW_MIN_STAKE = "STK_TOKENS_BELOW_MIN_STAKE";
    string internal constant ERROR_JUROR_TOKENS_AT_STAKE = "STK_JUROR_TOKENS_AT_STAKE";
    string internal constant ERROR_TOKEN_TRANSFER_FAILED = "STK_TOKEN_TRANSFER_FAILED";
    string internal constant ERROR_SORTITION_LENGTHS_MISMATCH = "STK_SORTITION_LENGTHS_MISMATCH";

    struct Account {
        mapping (address => uint256) balances; // token addr -> balance
        // when deactivating, balance becomes available on next term:
        uint64 deactivationTermId;
        uint256 atStakeTokens;   // maximum amount of juror tokens that the juror could be slashed given their drafts
        uint256 sumTreeId;       // key in the sum tree used for sortition
    }

    IStakingOwner owner;
    ERC20 jurorToken;
    ISumTree internal sumTree;
    // notice that for final round the max amount the tree can hold is 2^64 * jurorMinStake / FINAL_ROUND_WEIGHT_PRECISION
    // so make sure not to set this too low (as long as it's over the unit should be fine)
    uint256 public jurorMinStake;
    mapping (address => Account) internal accounts;
    mapping (uint256 => address) public jurorsByTreeId;

    event TokenBalanceChange(address indexed token, address indexed owner, uint256 amount, bool positive);
    event TokenWithdrawal(address indexed token, address indexed account, uint256 amount);
    event JurorActivated(address indexed juror, uint64 fromTermId);
    event JurorDeactivated(address indexed juror, uint64 lastTermId);
    event JurorDrafted(uint256 indexed disputeId, address juror);

    modifier only(address _addr) {
        require(msg.sender == _addr, ERROR_INVALID_ADDR);
        _;
    }

    /**
     * @dev This can be frontrunned, and ownership stolen, but the Court will notice,
     *      because its call to this function will revert
     * @param _jurorMinStake Minimum amount of juror tokens that can be activated
     */
    function init(
        IStakingOwner _owner,
        ISumTree _sumTree,
        ERC20 _jurorToken,
        uint256 _jurorMinStake
    )
        external
    {
        require(address(owner) == address(0), ERROR_OWNER_ALREADY_SET);

        owner = _owner;
        sumTree = _sumTree;
        sumTree.init(address(this));
        _setJurorToken(_jurorToken);
        jurorMinStake = _jurorMinStake;
    }

    /**
     * @notice Become an active juror on next term
     */
    function activate(address _juror, uint64 _termId) external only(owner) {
        Account storage account = accounts[_juror];
        uint256 balance = account.balances[jurorToken];

        require(account.deactivationTermId <= _termId, ERROR_INVALID_ACCOUNT_STATE);
        require(balance >= jurorMinStake, ERROR_TOKENS_BELOW_MIN_STAKE);

        uint256 sumTreeId = account.sumTreeId;
        if (sumTreeId == 0) {
            sumTreeId = sumTree.insert(_termId, 0); // Always > 0 (as constructor inserts the first item)
            account.sumTreeId = sumTreeId;
            jurorsByTreeId[sumTreeId] = _juror;
        }

        uint64 fromTermId = _termId + 1;
        sumTree.update(sumTreeId, fromTermId, balance, true);

        account.deactivationTermId = MAX_UINT64;
        account.balances[jurorToken] = 0; // tokens are in the tree (present or future)

        emit JurorActivated(_juror, fromTermId);
    }

    // TODO: Activate more tokens as a juror

    /**
     * @notice Stop being an active juror on next term
     */
    function deactivate(address _juror, uint64 _termId) external only(owner) {
        Account storage account = accounts[_juror];

        require(account.deactivationTermId == MAX_UINT64, ERROR_INVALID_ACCOUNT_STATE);

        // Always account.sumTreeId > 0, as juror has activated before
        uint256 treeBalance = sumTree.getItem(account.sumTreeId);
        account.balances[jurorToken] += treeBalance;

        uint64 lastTermId = _termId + 1;
        account.deactivationTermId = lastTermId;

        sumTree.set(account.sumTreeId, lastTermId, 0);

        emit JurorDeactivated(_juror, lastTermId);
    }

    /**
     * @param _params Array containing:
     *        bytes32 _randomness
     *        uint256 _disputeId
     *        uint64 _termId
     *        uint64 _filledSeats
     *        uint256 _jurorsRequested
     *        uint64 _jurorNumber
     *        uint16 _penaltyPct
     */
    function draft(uint256[7] _params)
        external
        only(owner)
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
            (uint256[] memory jurorKeys, uint256[] memory stakes) = _treeSearch(treeSearchParams);
            require(jurorKeys.length == stakes.length, ERROR_SORTITION_LENGTHS_MISMATCH);
            require(jurorKeys.length == roundSeatsLeft, ERROR_SORTITION_LENGTHS_MISMATCH);

            for (uint256 i = 0; i < jurorKeys.length; i++) {
                address juror = jurorsByTreeId[jurorKeys[i]];

                // Account storage jurorAccount = accounts[juror]; // Hitting stack too deep
                uint256 newAtStake = accounts[juror].atStakeTokens + _pct4(jurorMinStake, uint16(_params[6])); // _penaltyPct
                // Only select a juror if their stake is greater than or equal than the amount of tokens that they can lose, otherwise skip it
                if (stakes[i] >= newAtStake) {
                    accounts[juror].atStakeTokens = newAtStake;
                    // check repeated juror, we assume jurors come ordered from tree search
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

    function slash(
        uint64 _termId,
        address[] _jurors,
        uint256[] _penalties,
        bool[] _winningRulings
    )
        external
        only(owner)
        returns (uint256 collectedTokens)
    {
        // we assume this: require(jurors.length == penalties.length);
        for (uint256 i = 0; i < _jurors.length; i++) {
            address juror = _jurors[i];
            uint256 weightedPenalty = _penalties[i];
            Account storage account = accounts[juror];
            account.atStakeTokens -= weightedPenalty;

            // If the juror didn't vote for the final winning ruling
            if (!_winningRulings[i]) {
                collectedTokens += weightedPenalty;

                if (account.deactivationTermId <= _termId + 1) {
                    // Slash from balance if the account already deactivated
                    _removeTokens(jurorToken, juror, weightedPenalty);
                } else {
                    // account.sumTreeId always > 0: as the juror has activated (and gots its sumTreeId)
                    sumTree.update(account.sumTreeId, _termId + 1, weightedPenalty, false);
                }
            }
        }
    }

    /**
     * @notice Stake `@tokenAmount(self.jurorToken(), _amount)` to the Court
     */
    function stake(uint256 _amount, bytes) external {
        _stake(msg.sender, msg.sender, _amount);
    }

    /**
     * @notice Stake `@tokenAmount(self.jurorToken(), _amount)` for `_to` to the Court
     */
    function stakeFor(address _to, uint256 _amount, bytes) external {
        _stake(msg.sender, _to, _amount);
    }

    /**
     * @notice Unstake `@tokenAmount(self.jurorToken(), _amount)` for `_to` from the Court
     * @dev This is done this way to conform to ERC900 interface
     */
    function unstake(uint256 _amount, bytes) external {
        uint64 termId = owner.getEnsuredTermId();
        return _withdraw(msg.sender, jurorToken, _amount, termId); // withdraw() ensures the correct term
    }

    /**
     * @notice Withdraw `@tokenAmount(_token, _amount)` from the Court
     */
    function withdraw(address _from, ERC20 _token, uint256 _amount, uint64 _termId) external only(owner) {
        _withdraw(_from, _token, _amount, _termId);
    }

    function assignTokens(ERC20 _token, address _to, uint256 _amount) external only(owner) {
        _assignTokens(_token, _to, _amount);
    }

    function assignJurorTokens(address _to, uint256 _amount) external only(owner) {
        _assignTokens(jurorToken, _to, _amount);
    }

    function removeTokens(ERC20 _token, address _from, uint256 _amount) external only(owner) {
        _removeTokens(_token, _from, _amount);
    }

    function burnJurorTokens(uint256 _amount) external only(owner) {
        _assignTokens(jurorToken, BURN_ACCOUNT, _amount);
    }

    function collectTokens(uint64 _termId, address _juror, uint256 _amount) external only(owner) returns (bool) {
        Account storage account = accounts[_juror];

        uint64 slashingUpdateTermId = _termId + 1;
        // Slash from balance if the account already deactivated
        if (account.deactivationTermId <= slashingUpdateTermId) {
            if (_amount > unlockedBalanceOf(_juror)) {
                return false;
            }
            _removeTokens(jurorToken, _juror, _amount);
        } else {
            // account.sumTreeId always > 0: as the juror has activated (and got its sumTreeId)
            uint256 treeUnlockedBalance = sumTree.getItem(account.sumTreeId).sub(account.atStakeTokens);
            if (_amount > treeUnlockedBalance) {
                return false;
            }
            sumTree.update(account.sumTreeId, slashingUpdateTermId, _amount, false);
        }

        return true;
    }

    /**
     * @dev Callback of approveAndCall, allows staking directly with a transaction to the token contract.
     * @param _from The address making the transfer.
     * @param _amount Amount of tokens to transfer to Kleros (in basic units).
     * @param _token Token address
     */
    function receiveApproval(address _from, uint256 _amount, address _token, bytes)
        public
        only(_token)
    {
        if (_token == address(jurorToken)) {
            _stake(_from, _from, _amount);
            // TODO: Activate depending on data
        }
    }

    function getAccountSumTreeId(address _juror) external view returns (uint256) {
        return accounts[_juror].sumTreeId;
    }

    function getAccountPastTreeStake(address _juror, uint64 _termId) external returns (uint256) {
        return sumTree.getItemPast(accounts[_juror].sumTreeId, _termId);
    }

    function totalStaked() external view returns (uint256) {
        return jurorToken.balanceOf(this);
    }

    function token() external view returns (address) {
        return address(jurorToken);
    }

    function supportsHistory() external pure returns (bool) {
        return false;
    }

    function totalStakedFor(address _addr) public view returns (uint256) {
        Account storage account = accounts[_addr];
        uint256 sumTreeId = account.sumTreeId;
        uint256 activeTokens = sumTreeId > 0 ? sumTree.getItem(sumTreeId) : 0;

        return account.balances[jurorToken] + activeTokens;
    }

    /**
     * @dev Assumes that it is always called ensuring the term
     */
    function unlockedBalanceOf(address _addr) public view returns (uint256) {
        Account storage account = accounts[_addr];
        return account.balances[jurorToken].sub(account.atStakeTokens);
    }

    function _treeSearch(uint256[7] _treeSearchParams)
        internal
        view
        returns (uint256[] keys, uint256[] stakes)
    {
        (keys, stakes) = sumTree.multiSortition(
            bytes32(_treeSearchParams[0]), // _termRandomness,
            _treeSearchParams[1], // _disputeId
            uint64(_treeSearchParams[2]), // _termId
            false, // _past
            _treeSearchParams[3], // _filledSeats
            _treeSearchParams[4], // _jurorsRequested
            _treeSearchParams[5], // _jurorNumber
            _treeSearchParams[6]  // _sortitionIteration
        );
    }

    function _stake(address _from, address _to, uint256 _amount) internal {
        require(_amount > 0, ERROR_ZERO_TRANSFER);

        _assignTokens(jurorToken, _to, _amount);
        require(jurorToken.safeTransferFrom(_from, this, _amount), ERROR_DEPOSIT_FAILED);

        emit Staked(_to, _amount, totalStakedFor(_to), "");
    }

    function _withdraw(address _from, ERC20 _token, uint256 _amount, uint64 _termId) internal {
        require(_amount > 0, ERROR_ZERO_TRANSFER);

        Account storage account = accounts[_from];
        uint256 balance = account.balances[_token];
        require(balance >= _amount, ERROR_BALANCE_TOO_LOW);

        if (_token == jurorToken) {
            // Make sure deactivation has finished before withdrawing
            require(account.deactivationTermId <= _termId, ERROR_INVALID_ACCOUNT_STATE);
            require(_amount <= unlockedBalanceOf(_from), ERROR_JUROR_TOKENS_AT_STAKE);

            emit Unstaked(_from, _amount, totalStakedFor(_from), "");
        }

        _removeTokens(_token, _from, _amount);
        require(_token.safeTransfer(_from, _amount), ERROR_TOKEN_TRANSFER_FAILED);

        emit TokenWithdrawal(_token, _from, _amount);
    }

    function _assignTokens(ERC20 _token, address _to, uint256 _amount) internal {
        Account storage account = accounts[_to];
        account.balances[_token] = account.balances[_token].add(_amount);

        emit TokenBalanceChange(_token, _to, _amount, true);
    }

    function _removeTokens(ERC20 _token, address _from, uint256 _amount) internal {
        Account storage account = accounts[_from];
        account.balances[_token] = account.balances[_token].sub(_amount);

        emit TokenBalanceChange(_token, _from, _amount, false);
    }

    function _setJurorToken(ERC20 _jurorToken) internal {
        require(isContract(_jurorToken), ERROR_NOT_CONTRACT);
        jurorToken = _jurorToken;
    }

    function _pct4(uint256 _number, uint16 _pct) internal pure returns (uint256) {
        return _number * uint256(_pct) / PCT_BASE;
    }
}
