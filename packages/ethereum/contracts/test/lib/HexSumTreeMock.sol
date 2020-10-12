pragma solidity ^0.5.8;

import "../../lib/HexSumTree.sol";


contract HexSumTreeMock {
    using HexSumTree for HexSumTree.Tree;

    HexSumTree.Tree internal tree;

    function init() external {
        tree.init();
    }

    function insert(uint64 _time, uint256 _value) external returns (uint256) {
        return tree.insert(_time, _value);
    }

    function set(uint256 _key, uint64 _time, uint256 _value) external {
        tree.set(_key, _time, _value);
    }

    function update(uint256 _key, uint64 _time, uint256 _delta, bool _positive) external {
        tree.update(_key, _time, _delta, _positive);
    }

    function nextKey() external view returns (uint256) {
        return tree.nextKey;
    }

    function total() external view returns (uint256) {
        return tree.getTotal();
    }

    function totalAt(uint64 _time) external view returns (uint256) {
        return tree.getTotalAt(_time);
    }

    function node(uint256 _level, uint256 _key) external view returns (uint256) {
        return tree.getNode(_level, _key);
    }

    function nodeAt(uint256 _level, uint256 _key, uint64 _time) external view returns (uint256) {
        return tree.getNodeAt(_level, _key, _time);
    }

    function item(uint256 _key) external view returns (uint256) {
        return tree.getItem(_key);
    }

    function itemAt(uint256 _key, uint64 _time) external view returns (uint256) {
        return tree.getItemAt(_key, _time);
    }

    function height() external view returns (uint256) {
        return tree.getHeight();
    }

    function heightAt(uint64 _time) external view returns (uint256) {
        return tree.getRecentHeightAt(_time);
    }

    function search(uint256[] calldata _values, uint64 _time) external view returns (uint256[] memory keys, uint256[] memory values) {
        return tree.search(_values, _time);
    }
}
