pragma solidity ^0.4.24;

import "../lib/TierTreesWrapper.sol";


contract TierTreesWrapperPublic {
    using TierTreesWrapper for TierTreesWrapper.TierTrees;

    TierTreesWrapper.TierTrees tierTrees;

    event LogKey(bytes32 k);
    event LogRemove(bytes32 k);

    function init(uint256[] _thresholds) public {
        tierTrees.init(_thresholds);
    }

    function insert(uint256 v) public {
        emit LogKey(bytes32(tierTrees.insert(v)));
    }

    function insertNoLog(uint256 v) public {
        tierTrees.insert(v);
    }

    function insertMultiple(uint256 v, uint256 number) public {
        for (uint256 i = 0; i < number; i++) {
            tierTrees.insert(v);
        }
    }

    function set(uint256 key, uint256 value) public {
        tierTrees.set(key, value);
    }

    function remove(uint256 key) public {
        tierTrees.set(key, 0);
        emit LogKey(bytes32(key));
    }

    function removeNoLog(uint256 key) public {
        tierTrees.set(key, 0);
    }

    function removeMultiple(uint256 key, uint256 number) public {
        for (uint256 i = 0; i < number; i++) {
            tierTrees.set(key + i, 0);
        }
    }

    function setNextKey(uint256 key) public {
        (uint256 treeId, uint256 treeKey) = tierTrees.decodeKey(key);
        tierTrees.trees[treeId].nextKey = treeKey;
    }

    function sortition(uint256 v) public view returns (uint256) {
        var (k,) = tierTrees.sortition(v);
        return uint256(k);
    }

    function multiRandomSortition(uint256 number) public {
        for (uint256 i = 0; i < number; i++) {
            bytes32 seed = keccak256(abi.encodePacked(block.number, i));
            tierTrees.randomSortition(uint256(seed));
        }
    }

    function get(uint256 l, uint256 key) public view returns (uint256) {
        return tierTrees.get(l, key);
    }

    function totalSum() public view returns (uint256) {
        return tierTrees.totalSum();
    }

    function getState() public view returns (uint256, uint256) {
        //TODO
        //return (tierTrees.rootDepth, tierTrees.nextKey);
        return (0, 0);
    }
}
