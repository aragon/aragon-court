pragma solidity ^0.4.24;

import "../lib/TimeHelpersMock.sol";
import "../../lib/HexSumTree.sol";


contract CheckpointedHexSumTreeMock is TimeHelpersMock {
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

    function nextKey() public view returns (uint256) {
        return tree.nextKey;
    }

    function item(uint256 _key) public view returns (uint256) {
        return tree.getItem(_key);
    }

    function itemAt(uint256 _key, uint64 _time) public view returns (uint256) {
        return tree.getItemPast(_key, _time);
    }

    function height() public view returns (uint256) {
        return tree.getRootDepth();
    }

    function heightAt(uint64 _time) public view returns (uint256) {
        return tree.getRootDepthAt(_time, true);
    }

    function total() public view returns (uint256) {
        return tree.totalSum();
    }

    function totalAt(uint64 _time) public view returns (uint256) {
        return tree.totalSumPast(_time);
    }

    function getLast(uint256 _level, uint256 _key) public view returns (uint256) {
        return tree.get(_level, _key);
    }

    function getAt(uint256 _level, uint256 _key, uint64 _time) public view returns (uint256) {
        return tree.getPast(_level, _key, _time);
    }
}
