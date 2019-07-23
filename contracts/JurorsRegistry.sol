pragma solidity ^0.4.24;

import "./Court.sol";
import "./lib/HexSumTree.sol";
import "./standards/sumtree/ISumTree.sol";
import "@aragon/os/contracts/common/IsContract.sol";
import "@aragon/os/contracts/lib/token/ERC20.sol";
import "@aragon/os/contracts/common/SafeERC20.sol";
import "@aragon/os/contracts/lib/math/SafeMath.sol";


contract JurorsRegistry is IsContract {
    using SafeMath for uint256;
    using SafeERC20 for ERC20;
    using HexSumTree for HexSumTree.Tree;

    string internal constant ERROR_OWNER_ALREADY_SET = "SUMTREE_OWNER_ALREADY_SET";
    string internal constant ERROR_TREE_ALREADY_INITIALIZED = "SUMTREE_TREE_ALREADY_INITIALIZED";

    struct Juror {
        uint256 id;                // key in the sum tree used for sortition
        uint256 balance;           // amount of tokens staked in the tree
        uint256 atStakeTokens;     // maximum amount of juror tokens that the juror could be slashed given their drafts
        uint64 deactivationTermId; // ?
    }

    Court public court;
    ERC20 public jurorToken;
    uint256 public jurorMinStake;

    HexSumTree.Tree private tree;
    mapping (address => Juror) internal jurorsByAddress;
    mapping (uint256 => address) internal jurorsById;

    /**
     * @dev This can be frontrunned, and ownership stolen, but the Court will notice,
     *      because its call to this function will revert
     */
    function init(Court _court, ERC20 _jurorToken, uint256 _jurorMinStake) external {
        require(tree.rootDepth == 0, ERROR_TREE_ALREADY_INITIALIZED);

        court = _court;
        _setJurorToken(_jurorToken);
        jurorMinStake = _jurorMinStake;

        tree.init();
        assert(tree.insert(0, 0) == 0); // first tree item is an empty juror
    }

    /**
     * @notice Become an active juror on next term
     */
    function activate(address _juror, uint256 _amount) external {
        uint64 termId = owner.getEnsuredTermId();
        uint256 balance = juror.balance + _amount;
        Juror storage juror = jurorsByAddress[_juror];

        require(_amount > 0, ERROR_ZERO_TRANSFER);
        require(balance >= jurorMinStake, ERROR_TOKENS_BELOW_MIN_STAKE);
        require(juror.deactivationTermId <= termId, ERROR_INVALID_ACCOUNT_STATE);

        uint256 id = juror.id;
        if (id == 0) {
            id = tree.insert(termId, 0); // Always > 0 (as constructor inserts the first item)
            juror.id = id;
            jurorsById[id] = _juror;
        }

        uint64 fromTermId = termId + 1;
        tree.update(id, fromTermId, balance, true);
        juror.deactivationTermId = MAX_UINT64;
        juror.balance = balance; // tokens are in the tree (present or future)

        require(jurorToken.safeTransferFrom(_juror, this, _amount), ERROR_DEPOSIT_FAILED);
        emit JurorActivated(_juror, fromTermId);
    }

    /**
     * @notice Stop being an active juror on next term
     */
    function deactivate(address _juror, uint256 _amount) external {
        uint64 termId = owner.getEnsuredTermId();
        uint256 balance = juror.balance - _amount;
        Juror storage juror = jurorsByAddress[_juror];

        require(_amount > 0, ERROR_ZERO_TRANSFER);
        require(balance >= jurorMinStake, ERROR_TOKENS_BELOW_MIN_STAKE);
        require(_amount <= getJurorUnlockedBalance(_from), ERROR_JUROR_TOKENS_AT_STAKE);
        require(juror.deactivationTermId == MAX_UINT64, ERROR_INVALID_ACCOUNT_STATE);

        uint64 lastTermId = termId + 1;
        tree.set(juror.id, lastTermId, balance);
        juror.deactivationTermId = lastTermId;
        account.balance = balance;

        require(jurorToken.safeTransfer(_juror, _amount), ERROR_TOKEN_TRANSFER_FAILED);
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
    function draft(uint256[7] _params) external only(owner) returns (address[] jurors, uint64[] weights, uint256 jurorsLength, uint64 filledSeats){
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
                    jurorsByAddress[juror].atStakeTokens = newAtStake;
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

    function slash(uint64 _termId, address[] _jurors, uint256[] _penalties, uint8[] _castVotes, uint8 _winningRuling) external returns (uint256) {
        // we assume this: require(_jurors.length == _penalties.length);
        // we assume this: require(_jurors.length == _castVotes.length);
        uint256 collectedTokens;
        for (uint256 i = 0; i < _jurors.length; i++) {
            // TODO: stack too deep address juror = _jurors[i];
            uint256 weightedPenalty = _penalties[i];
            Juror storage juror = jurorsByAddress[_jurors[i]];
            juror.atStakeTokens -= weightedPenalty;

            // If the juror didn't vote for the final winning ruling
            if (_castVotes[i] != _winningRuling) {
                collectedTokens += weightedPenalty;

                if (account.deactivationTermId <= _termId + 1) {
                    // Slash from balance if the account already deactivated
                    // _removeTokens(jurorToken, _jurors[i], weightedPenalty);
                    // TODO: where does this go?
                } else {
                    // account.sumTreeId always > 0: as the juror has activated (and gots its sumTreeId)
                    tree.update(account.sumTreeId, _termId + 1, weightedPenalty, false);
                }
            }
        }
        return collectedTokens;
    }

    function getJurorId(address _juror) external view returns (uint256) {
        return jurorsByAddress[_juror].id;
    }

    function getJurorBalanceAt(address _juror, uint64 _termId) external returns (uint256) {
        Juror storage juror = jurorsByAddress[_juror];
        return tree.getItemPast(juror.id, _termId);
    }

    /**
     * @dev Assumes that it is always called ensuring the term
     */
    function getJurorUnlockedBalance(address _juror) public view returns (uint256) {
        Juror storage juror = jurorsByAddress[_juror];
        return juror.balance.sub(account.atStakeTokens);
    }

    function getTotalBalance() external view returns (uint256) {
        return jurorToken.balanceOf(this);
    }

    function getTotalPastBalanceAt(uint64 _termId) external view returns (uint256) {
        return tree.totalSumPast(_termId);
    }

    function getTotalPresentBalanceAt(uint64 _termId) external view returns (uint256) {
        return tree.totalSumPresent(_termId);
    }

    function _setJurorToken(ERC20 _jurorToken) internal {
        require(isContract(_jurorToken), ERROR_NOT_CONTRACT);
        jurorToken = _jurorToken;
    }

    function _multiSortition(
        bytes32 _termRandomness,
        uint256 _disputeId,
        uint64 _time,
        bool _past,
        uint256 _filledSeats,
        uint256 _jurorsRequested,
        uint256 _jurorNumber,
        uint256 _sortitionIteration
    )
        internal
        view
        returns (uint256[] keys, uint256[] nodeValues)
    {
        uint256[] memory values = _getOrderedValues(
            _termRandomness,
            _disputeId,
            _time,
            _filledSeats,
            _jurorsRequested,
            _jurorNumber,
            _sortitionIteration
        );
        return tree.multiSortition(values, _time, _past);
    }

    function _getStakeBounds(
        uint64 _time,
        uint256 _filledSeats,
        uint256 _jurorsRequested,
        uint256 _jurorNumber
    )
        internal
        view
        returns (uint256 stakeFrom, uint256 stakeTo)
    {
        uint256 totalSum = tree.totalSumPresent(_time);
        uint256 ratio = totalSum / _jurorNumber;
        // TODO: roundings?
        stakeFrom = _filledSeats * ratio;
        uint256 newFilledSeats = _filledSeats + _jurorsRequested;
        // TODO: this should never happen
        /*
        if (newFilledSeats > _jurorNumber) {
            newFilledSeats = _jurorNumber;
        }
        */
        stakeTo = newFilledSeats * ratio;
    }

    function _getOrderedValues(
        bytes32 _termRandomness,
        uint256 _disputeId,
        uint64 _time,
        uint256 _filledSeats,
        uint256 _jurorsRequested,
        uint256 _jurorNumber,
        uint256 _sortitionIteration
    )
        private
        view
        returns (uint256[] values)
    {
        values = new uint256[](_jurorsRequested);

        (uint256 stakeFrom, uint256 stakeTo) = _getStakeBounds(_time, _filledSeats, _jurorsRequested, _jurorNumber);
        uint256 stakeInterval = stakeTo - stakeFrom;
        for (uint256 i = 0; i < _jurorsRequested; i++) {
            bytes32 seed = keccak256(abi.encodePacked(_termRandomness, _disputeId, i, _sortitionIteration));
            uint256 value = stakeFrom + uint256(seed) % stakeInterval;
            values[i] = value;
            // make sure it's ordered
            uint256 j = i;
            while (j > 0 && values[j] < values[j - 1]) {
                // flip them
                uint256 tmp = values[j - 1];
                values[j - 1] = values[j];
                values[j] = tmp;
                j--;
            }
        }
    }
}
