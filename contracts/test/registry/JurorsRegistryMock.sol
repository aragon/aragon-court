pragma solidity ^0.4.24;

import "../../JurorsRegistry.sol";
import "../lib/TimeHelpersMock.sol";


contract JurorsRegistryMock is JurorsRegistry, TimeHelpersMock {
    bool internal treeSearchHijacked = false;

    function mock_hijackTreeSearch() external {
        treeSearchHijacked = true;
    }

    function mock_sortition(uint256 v) public view returns (address) {
        (uint256 k, ) = tree.sortition(v, getTimestamp64(), false);
        return jurorsAddressById[k];
    }

    function mock_treeTotalSum() public view returns (uint256) {
        return tree.totalSumPresent(getTimestamp64());
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
