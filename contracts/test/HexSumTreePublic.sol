pragma solidity ^0.4.24;

import "../HexSumTree.sol";


contract HexSumTreePublic {
    using HexSumTree for HexSumTree.Tree;

    HexSumTree.Tree tree;

    event LogKey(bytes32 k);
    event LogRemove(bytes32 k);

    function init() public {
        tree.init();
    }

    function insert(uint256 v) public {
        emit LogKey(bytes32(tree.insert(v)));
    }

    function insertMultiple(uint256 v, uint256 number) public {
        for (uint256 i = 0; i < number; i++) {
            tree.insert(v);
        }
    }

    function remove(uint256 key) public {
        tree.set(key, 0);
        emit LogKey(bytes32(key));
    }

    function removeMultiple(uint256 key, uint256 number) public {
        for (uint256 i = 0; i < number; i++) {
            tree.set(key + i, 0);
        }
    }

    function sortition(uint256 v) public view returns (uint256) {
        return uint256(tree.sortition(v));
    }

    function get(uint256 l, uint256 key) public view returns (uint256) {
        return tree.get(l, key);
    }

    function totalSum() public view returns (uint256) {
        return tree.totalSum();
    }

    function getState() public view returns (uint256, uint256) {
        return (tree.rootDepth, tree.nextKey);
    }
}
