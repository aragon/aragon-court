pragma solidity ^0.4.24;

import "../lib/HexSumTree.sol";


contract HexSumTreePublic {
    using HexSumTree for HexSumTree.Tree;

    HexSumTree.Tree tree;

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
        emit LogKey(bytes32(tree.insert(v)));
    }

    function insertNoLog(uint256 v) external profileGas {
        tree.insert(v);
    }

    function insertMultiple(uint256 v, uint256 number) external profileGas {
        for (uint256 i = 0; i < number; i++) {
            tree.insert(v);
        }
    }

    function set(uint256 key, uint256 value) external profileGas {
        tree.set(key, value);
    }

    function update(uint256 key, uint256 delta, bool positive) external profileGas {
        tree.update(key, delta, positive);
    }

    function remove(uint256 key) external profileGas {
        tree.set(key, 0);
        emit LogKey(bytes32(key));
    }

    function removeNoLog(uint256 key) external profileGas {
        tree.set(key, 0);
    }

    function removeMultiple(uint256 key, uint256 number) external profileGas {
        for (uint256 i = 0; i < number; i++) {
            tree.set(key + i, 0);
        }
    }

    function setNextKey(uint256 key) external {
        tree.nextKey = key;
    }

    function sortition(uint256 v, uint256 bn) external profileGas returns (uint256) {
        var (k,) = tree.sortition(v, bn);
        return uint256(k);
    }

    function multiRandomSortition(uint256 number, uint256 blockNumber) external profileGas {
        for (uint256 i = 0; i < number; i++) {
            bytes32 seed = keccak256(abi.encodePacked(blockNumber, i));
            tree.randomSortition(uint256(seed), blockNumber);
        }
    }

    function get(uint256 l, uint256 key) external view returns (uint256) {
        return tree.get(l, key);
    }

    function getPastItem(uint256 key, uint64 blockNumber) public view returns (uint256) {
        return tree.getPastItem(key, blockNumber);
    }

    function totalSum() external view returns (uint256) {
        return tree.totalSum();
    }

    function getState() external view returns (uint256, uint256) {
        return (tree.rootDepth, tree.nextKey);
    }
}
