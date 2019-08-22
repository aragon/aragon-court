pragma solidity ^0.4.24;

import "../../JurorsRegistry.sol";
import "../lib/TimeHelpersMock.sol";


contract JurorsRegistryMock is JurorsRegistry, TimeHelpersMock {
    bool internal treeSearchHijacked;

    function mock_hijackTreeSearch() external {
        treeSearchHijacked = true;
    }

    function sortition(uint256 value) public view returns (address) {
        uint256[] memory values = new uint256[](1);
        values[0] = value;
        (uint256[] memory jurorsIds,) = tree.multiSortition(values, getTimestamp64());
        return jurorsAddressById[jurorsIds[0]];
    }

    function _treeSearch(uint256[7] _params) internal view returns (uint256[] keys, uint256[] nodeValues) {
        if (!treeSearchHijacked) {
            return super._treeSearch(_params);
        }

        uint256 _jurorsRequested = _params[4];

        keys = new uint256[](_jurorsRequested);
        nodeValues = new uint256[](_jurorsRequested);
        for (uint256 i = 0; i < _jurorsRequested; i++) {
            uint256 key = i % (tree.nextKey - 1) + 1; // loop, and avoid 0
            keys[i] = key;
            nodeValues[i] = tree.getItem(key);
        }
    }
}
