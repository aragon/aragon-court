pragma solidity ^0.4.24;

import "../lib/HexSumTree.sol";


contract HexSumTreePublic {
    using HexSumTree for HexSumTree.Tree;

    // This must match the one in HexSumTree !
    uint256 private constant BITS_IN_NIBBLE = 4;

    HexSumTree.Tree tree;

    uint64 blockNumber;

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
        // adjust depth
        uint256 rootDepth = 0;
        uint256 tmpKey = key;
        while (tmpKey > 0) {
            rootDepth++;
            tmpKey = tmpKey >> BITS_IN_NIBBLE;
        }
        tree.rootDepth = rootDepth;
    }

    function sortition(uint256 value, uint64 checkpointTime) external profileGas returns (uint256) {
        (uint256 k,) = tree.sortition(value, checkpointTime);
        return k;
    }

    function multiRandomSortition(uint256 number, uint64 checkpointTime) external profileGas {
        for (uint256 i = 0; i < number; i++) {
            bytes32 seed = keccak256(abi.encodePacked(checkpointTime, i));
            tree.randomSortition(uint256(seed), checkpointTime);
        }
    }

    function get(uint256 l, uint256 key) external view returns (uint256) {
        return tree.get(l, key);
    }

    function getPast(uint256 l, uint256 key, uint64 checkpointTime) external view returns (uint256) {
        return tree.getPast(l, key, checkpointTime);
    }

    function getPastItem(uint256 key, uint64 checkpointTime) external view returns (uint256) {
        return tree.getPastItem(key, checkpointTime);
    }

    function totalSum() external view returns (uint256) {
        return tree.totalSum();
    }

    function getState() external view returns (uint256, uint256) {
        return (tree.rootDepth, tree.nextKey);
    }

    function advanceTime(uint64 blocks) public {
        blockNumber += blocks;
    }

    function getBlockNumber64() public view returns (uint64) {
        //return uint64(block.number);
        return blockNumber;
    }

    function getCheckpointTime() public view returns (uint64) {
        return getBlockNumber64() / 256;
    }
}
