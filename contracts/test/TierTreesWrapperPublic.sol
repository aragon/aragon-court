pragma solidity ^0.4.24;

import "../lib/TierTreesWrapper.sol";


contract TierTreesWrapperPublic {
    using TierTreesWrapper for TierTreesWrapper.TierTrees;

    // This must match the one in HexSumTree !
    uint256 private constant BITS_IN_NIBBLE = 4;

    TierTreesWrapper.TierTrees tierTrees;

    event LogKey(bytes32 k);
    event LogRemove(bytes32 k);
    event GasConsumed(uint256 gas);

    modifier profileGas {
        uint256 initialGas = gasleft();
        _;
        emit GasConsumed(initialGas - gasleft());
    }


    function init(uint256[] _thresholds) public {
        tierTrees.init(_thresholds);
    }

    function insert(uint256 v) external profileGas {
        emit LogKey(bytes32(tierTrees.insert(v)));
    }

    function insertNoLog(uint256 v) external profileGas {
        tierTrees.insert(v);
    }

    function insertMultiple(uint256 v, uint256 number) external profileGas {
        for (uint256 i = 0; i < number; i++) {
            tierTrees.insert(v);
        }
    }

    function set(uint256 key, uint256 value) external profileGas {
        tierTrees.set(key, value);
    }

    function remove(uint256 key) external profileGas {
        tierTrees.set(key, 0);
        emit LogKey(bytes32(key));
    }

    function removeNoLog(uint256 key) external profileGas {
        tierTrees.set(key, 0);
    }

    function removeMultiple(uint256 key, uint256 number) external profileGas {
        for (uint256 i = 0; i < number; i++) {
            tierTrees.set(key + i, 0);
        }
    }

    function setNextKey(uint256 key) external {
        (uint256 treeId, uint256 treeKey) = tierTrees.decodeKey(key);
        tierTrees.trees[treeId].nextKey = treeKey;
        // adjust depth
        uint256 rootDepth = 0;
        uint256 tmpKey = key;
        while (tmpKey > 0) {
            rootDepth++;
            tmpKey = tmpKey >> BITS_IN_NIBBLE;
        }
        tierTrees.trees[treeId].rootDepth = rootDepth;
    }

    function sortition(uint256 v) external profileGas returns (uint256) {
        var (k,) = tierTrees.sortition(v);
        return uint256(k);
    }

    function multiRandomSortition(uint256 number) external profileGas {
        for (uint256 i = 0; i < number; i++) {
            bytes32 seed = keccak256(abi.encodePacked(block.number, i));
            tierTrees.randomSortition(uint256(seed));
        }
    }

    function multiRandomSortitionWithMin(uint256 number, uint256 minTreeId) external profileGas {
        for (uint256 i = 0; i < number; i++) {
            bytes32 seed = keccak256(abi.encodePacked(block.number, i));
            tierTrees.randomSortition(uint256(seed), minTreeId);
        }
    }

    function get(uint256 l, uint256 key) external view returns (uint256) {
        return tierTrees.get(l, key);
    }

    function getSubTreeSum(uint256 treeId) external view returns (uint256) {
        return tierTrees.getTreeSum(treeId);
    }

    function totalSum() external view returns (uint256) {
        return tierTrees.totalSum();
    }

    function getState(uint256 treeId) external view returns (uint256, uint256) {
        return (tierTrees.trees[treeId].rootDepth, tierTrees.trees[treeId].nextKey);
    }
}
