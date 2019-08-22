pragma solidity ^0.4.24;

import "../lib/HexSumTree.sol";
import "./lib/TimeHelpersMock.sol";


contract HexSumTreeMock is TimeHelpersMock {
    using HexSumTree for HexSumTree.Tree;
    using Checkpointing for Checkpointing.History;

    HexSumTree.Tree internal tree;

    event LogKey(bytes32 k);
    event LogRemove(bytes32 k);
    event GasConsumed(uint256 gas);

    modifier profileGas {
        uint256 initialGas = gasleft();
        _;
        emit GasConsumed(initialGas - gasleft());
    }

    function init() public {
        tree.init();
    }

    function insert(uint256 v) external profileGas {
        emit LogKey(bytes32(tree.insert(getCheckpointTime(), v)));
    }

    function insertNoLog(uint256 v) external profileGas {
        tree.insert(getCheckpointTime(), v);
    }

    function insertMultiple(uint256 v, uint256 number) external profileGas {
        for (uint256 i = 0; i < number; i++) {
            tree.insert(getCheckpointTime(), v);
        }
    }

    function insertAt(uint64 time, uint256 value) external {
        tree.insert(time, value);
    }

    function set(uint256 key, uint256 value) external profileGas {
        tree.set(key, getCheckpointTime(), value);
    }

    function update(uint256 key, uint256 delta, bool positive) external profileGas {
        tree.update(key, getCheckpointTime(), delta, positive);
    }

    function remove(uint256 key) external profileGas {
        tree.set(key, getCheckpointTime(), 0);
        emit LogKey(bytes32(key));
    }

    function removeNoLog(uint256 key) external profileGas {
        tree.set(key, getCheckpointTime(), 0);
    }

    function removeMultiple(uint256 key, uint256 number) external profileGas {
        for (uint256 i = 0; i < number; i++) {
            tree.set(key + i, getCheckpointTime(), 0);
        }
    }

    function setNextKey(uint256 key) external {
        tree.nextKey = key;
        // adjust height
        uint256 height = 0;
        uint256 tmpKey = key;
        while (tmpKey > 0) {
            height++;
            tmpKey = tmpKey >> tree.getBitsInNibble();
        }
        tree.height.add(uint64(getCheckpointTime()), height);
    }

    function sortition(uint256 value, uint64 time) external profileGas returns (uint256) {
        uint256[] memory values = new uint256[](1);
        values[0] = value;
        (uint256[] memory keys, ) = multiSortition(values, time);
        return keys[0];
    }

    function multiSortition(uint256[] values, uint64 time) public view returns (uint256[], uint256[]) {
        return tree.multiSortition(values, time);
    }

    function multiSortitionFor(
        bytes32 _termRandomness,
        uint256 _disputeId,
        uint64 _time,
        uint256 _filledSeats,
        uint256 _jurorsRequested,
        uint256 _jurorNumber,
        uint256 _sortitionIteration
    )
        external
        view
        returns (uint256[] keys, uint256[] nodeValues)
    {
        return tree.multiSortition(_termRandomness, _disputeId, _time, _filledSeats, _jurorsRequested, _jurorNumber, _sortitionIteration);
    }

    function get(uint256 _level, uint256 _key) external view returns (uint256) {
        return tree.getNode(_level, _key);
    }

    function getItemAt(uint256 _key, uint64 _time) external profileGas returns (uint256) {
        return tree.getItemAt(_key, _time);
    }

    function getTotal() external view returns (uint256) {
        return tree.getTotal();
    }

    function getTotalAt(uint64 _time) external profileGas returns (uint256) {
        return tree.getTotalAt(_time, true);
    }

    function getState() external view returns (uint256, uint256) {
        return (tree.getHeight(), tree.nextKey);
    }

    // TODO: use a more accurate way of testing timestamps for chekpointing
    function getCheckpointTime() public view returns (uint64) {
        return getBlockNumber64() / 256;
    }

    function getChildren() public view returns (uint256) {
        return tree.getChildren();
    }
}
