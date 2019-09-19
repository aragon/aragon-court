pragma solidity ^0.5.8;

import "../../lib/HexSumTree.sol";
import "../lib/TimeHelpersMock.sol";


contract HexSumTreeGasProfiler is TimeHelpersMock {
    using HexSumTree for HexSumTree.Tree;
    using Checkpointing for Checkpointing.History;

    uint256 private constant BASE_KEY = 0;
    uint256 private constant CHILDREN = 16;
    uint256 private constant ITEMS_LEVEL = 0;
    uint256 private constant BITS_IN_NIBBLE = 4;

    HexSumTree.Tree internal tree;

    event GasConsumed(uint256 gas);

    modifier profileGas {
        uint256 initialGas = gasleft();
        _;
        emit GasConsumed(initialGas - gasleft());
    }

    function init() external {
        tree.init();
    }

    function insert(uint64 _time, uint256 _value) external profileGas {
        tree.insert(_time, _value);
    }

    function set(uint256 _key, uint64 _time, uint256 _value) external profileGas {
        tree.set(_key, _time, _value);
    }

    function update(uint256 _key, uint64 _time, uint256 _delta, bool _positive) external profileGas {
        tree.update(_key, _time, _delta, _positive);
    }

    function search(uint256[] calldata _values, uint64 _time) external profileGas {
        tree.search(_values, _time);
    }

    function mockNextKey(uint64 _time, uint256 _nextKey) external {
        // Compute new height
        uint256 newHeight = 0;
        for (uint256 key = _nextKey; key > 0; newHeight++) {
            key = key >> BITS_IN_NIBBLE;
        }

        // Update fake values
        tree.nextKey = _nextKey;
        tree.height.add(_time, newHeight);
    }

    function nextKey() external view returns (uint256) {
        return tree.nextKey;
    }

    function height() external view returns (uint256) {
        return tree.getHeight();
    }

    function total() public view returns (uint256) {
        return tree.getTotal();
    }
}
