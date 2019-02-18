pragma solidity ^0.4.24;

import "../HexSumTree.sol";


contract HexSumTreePublic {
    using HexSumTree for HexSumTree.Tree;
    
    HexSumTree.Tree tree;

    event LogKey(bytes32 k);
    
    function init() public {
        tree.init();
    }

    function insert(uint256 v) public {
        emit LogKey(tree.insert(v));
    }

    function sortition(uint256 v) public view returns (uint256) {
        return uint256(tree.sortition(v));
    }

    function get(uint8 l, uint256 key) public view returns (uint256) {
        return tree.get(l, bytes32(key));
    }

    function totalSum() public view returns (uint256) {
        return tree.totalSum();
    }

    function getState() public view returns (uint8, bytes32, bytes32) {
        return (tree.rootDepth, tree.rootAncestor, tree.nextKey);
    }
}