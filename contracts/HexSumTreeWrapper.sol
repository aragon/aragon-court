pragma solidity ^0.4.24;

import "./lib/HexSumTree.sol";


contract HexSumTreeWrapper {
    using HexSumTree for HexSumTree.Tree;

    string internal constant ERROR_NOT_OWNER = "SUMTREE_NOT_OWNER";
    string internal constant ERROR_WRONG_INIT_CODE = "SUMTREE_WRONG_INIT_CODE";

    HexSumTree.Tree private tree;
    address private owner;

    modifier onlyOwner {
        require(msg.sender == address(owner), ERROR_NOT_OWNER);
        _;
    }

    constructor(address _preOwner) public {
        owner = address(_preOwner);
    }

    function init(address _owner, bytes32 _initCode) external {
        require(address(owner) == address(keccak256(abi.encodePacked(_initCode))),  ERROR_WRONG_INIT_CODE);
        owner = _owner;
        tree.init();
        assert(tree.insert(0, 0) == 0); // first tree item is an empty juror
    }

    function insert(uint64 _checkpointTime, uint256 _value) external onlyOwner returns (uint256) {
        return tree.insert(_checkpointTime, _value);
    }

    function set(uint256 _key, uint64 _checkpointTime, uint256 _value) external onlyOwner {
        tree.set(_key, _checkpointTime, _value);
    }

    function update(uint256 _key, uint64 _checkpointTime, uint256 _delta, bool _positive) external onlyOwner {
        tree.update(_key, _checkpointTime, _delta, _positive);
    }

    function getOwner() external view returns (address) {
        return owner;
    }

    function getItem(uint256 _key) external view returns (uint256) {
        return tree.getItem(_key);
    }

    function totalSumPresent(uint64 _checkpointTime) external view returns (uint256) {
        return tree.totalSumPresent(_checkpointTime);
    }

    function sortition(uint256 value, uint64 time, bool past) external view returns (uint256 key, uint256 nodeValue) {
        return tree.sortition(value, time, past);
    }

    function multiSortition(
        bytes32 _termRandomness,
        uint256 _disputeId,
        uint64 _time,
        bool _past,
        uint256 _filledSeats,
        uint256 _jurorsRequested,
        uint256 _jurorNumber,
        uint256 _sortitionIteration
    )
        external
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

    function getNextKey() external view returns (uint256) {
        return tree.nextKey;
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
