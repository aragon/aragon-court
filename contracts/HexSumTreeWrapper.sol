pragma solidity ^0.4.24;

import "./lib/HexSumTree.sol";


contract HexSumTreeWrapper {
    using HexSumTree for HexSumTree.Tree;

    HexSumTree.Tree tree;

    function init() public {
        tree.init();
    }

    function insert(uint64 _checkpointTime, uint256 _value) external returns (uint256) {
        return tree.insert(_checkpointTime, _value);
    }

    function set(uint256 _key, uint64 _checkpointTime, uint256 _value) external {
        tree.set(_key, _checkpointTime, _value);
    }

    function update(uint256 _key, uint64 _checkpointTime, uint256 _delta, bool _positive) external {
        tree.update(_key, _checkpointTime, _delta, _positive);
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
        uint256 _nextJurorToDraft,
        uint256 _jurorNumber,
        uint256 _addedJurors,
        uint64 _time,
        bool _past,
        uint256 _maxJurorsPerBatch
    )
        external
        view
        returns (uint256[] keys, uint256[] nodeValues)
    {
        uint256[] memory values = _getOrderedValues(_termRandomness, _disputeId, _nextJurorToDraft, _jurorNumber, _addedJurors, _time, _maxJurorsPerBatch);
        return tree.multiSortition(values, _time, _past);
    }

    function getNextKey() external view returns (uint256) {
        return tree.nextKey;
    }

    function _getStakeBounds(uint256 _nextJurorToDraft, uint256 _jurorNumber, uint64 _time, uint256 _maxJurorsPerBatch) internal view returns (uint256 stakeFrom, uint256 stakeTo) {
        uint256 totalSum = tree.totalSumPresent(_time);
        uint256 ratio = totalSum / _jurorNumber;
        // TODO: roundings?
        stakeFrom = _nextJurorToDraft * ratio;
        uint256 newNextJurorToDraft = _nextJurorToDraft + _maxJurorsPerBatch;
        if (newNextJurorToDraft > _jurorNumber) {
            newNextJurorToDraft = _jurorNumber;
        }
        stakeTo = newNextJurorToDraft * ratio;
    }

    function _getOrderedValues(
        bytes32 _termRandomness,
        uint256 _disputeId,
        uint256 _nextJurorToDraft,
        uint256 _jurorNumber,
        uint256 _addedJurors,
        uint64 _time,
        uint256 _maxJurorsPerBatch
    )
        private
        returns (uint256[] values)
    {
        values = new uint256[](_jurorNumber);

        (uint256 stakeFrom, uint256 stakeTo) = _getStakeBounds(_nextJurorToDraft, _jurorNumber, _time, _maxJurorsPerBatch);
        // TODO: stack too deep: uint256 stakeSum = stakeTo - stakeFrom;
        uint256 jurorsToDraft = _jurorNumber - _addedJurors;
        for (uint256 i = 0; i < jurorsToDraft; i++) {
            bytes32 seed = keccak256(abi.encodePacked(_termRandomness, _disputeId, i));
            // TODO: stack too deep: uint256 value = stakeFrom + uint256(seed) % stakeSum;
            uint256 value = stakeFrom + uint256(seed) % (stakeTo - stakeFrom);
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
