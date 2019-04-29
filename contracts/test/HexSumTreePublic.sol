pragma solidity ^0.4.24;

import "../lib/HexSumTree.sol";


contract HexSumTreePublic {
    using HexSumTree for HexSumTree.Tree;

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
            tmpKey = tmpKey >> tree.getBitsInNibble();
        }
        tree.rootDepth = rootDepth;
    }

    function sortition(uint256 value, uint64 checkpointTime) external profileGas returns (uint256) {
        (uint256 k,) = tree.sortition(value, checkpointTime);
        return k;
    }

    function sortitionSingleUsingMulti(uint256 value, uint64 checkpointTime) external profileGas returns (uint256) {
        uint256[] memory values = new uint256[](1);
        values[0] = value;
        uint256[] memory keys = tree.multiSortition(values, checkpointTime);

        return keys[0];
    }

    function multipleRandomSortition(uint256 number, uint64 checkpointTime) external profileGas {
        for (uint256 i = 0; i < number; i++) {
            bytes32 seed = keccak256(abi.encodePacked(checkpointTime, i));
            tree.randomSortition(uint256(seed), checkpointTime);
        }
    }

    function multipleRandomSortitionLast(uint256 number) external profileGas {
        uint64 checkpointTime = getCheckpointTime();
        for (uint256 i = 0; i < number; i++) {
            bytes32 seed = keccak256(abi.encodePacked(checkpointTime, i));
            tree.randomSortition(uint256(seed), checkpointTime);
        }
    }

    function _getOrderedValues(uint256 number, uint64 checkpointTime) private returns (uint256[] values) {
        values = new uint256[](number);
        uint256 sum = tree.totalSumPast(checkpointTime);

        for (uint256 i = 0; i < number; i++) {
            bytes32 seed = keccak256(abi.encodePacked(checkpointTime, i));
            uint256 value = uint256(seed) % sum;
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

    //event LogValues(uint64 checkpointTime, uint256[] values);
    //event LogKeys(uint64 checkpointTime, uint256[] keys);
    function multipleRandomMultiSortition(uint256 number, uint64 checkpointTime) external profileGas returns (uint256[]) {
        uint256[] memory values = _getOrderedValues(number, checkpointTime);
        //emit LogValues(checkpointTime, values);
        uint256[] memory keys = tree.multiSortition(values, checkpointTime);
        //emit LogKeys(checkpointTime, keys);
        return keys;
    }

    function multipleRandomMultiSortitionLast(uint256 number) external profileGas returns (uint256[]) {
        uint64 checkpointTime = getCheckpointTime();
        uint256[] memory values = _getOrderedValues(number, checkpointTime);
        uint256[] memory keys = tree.multiSortition(values, checkpointTime);
        return keys;
    }

    function multiSortition(uint256[] values, uint64 checkpointTime) external returns (uint256[]) {
        return tree.multiSortition(values, checkpointTime);
    }

    function get(uint256 l, uint256 key) external view returns (uint256) {
        return tree.get(l, key);
    }

    function getPast(uint256 l, uint256 key, uint64 checkpointTime) external view returns (uint256) {
        return tree.getPast(l, key, checkpointTime);
    }

    function getPastItem(uint256 key, uint64 checkpointTime) external profileGas returns (uint256) {
        return tree.getPastItem(key, checkpointTime);
    }

    function totalSum() external view returns (uint256) {
        return tree.totalSum();
    }

    function totalSumPast(uint64 checkpointTime) external profileGas returns (uint256) {
        return tree.totalSumPast(checkpointTime);
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

    function getChildren() public view returns (uint256) {
        return tree.getChildren();
    }

    function getBitsInNibble() public view returns (uint256) {
        return tree.getBitsInNibble();
    }
}
