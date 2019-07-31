pragma solidity ^0.4.24;

import "../CourtStaking.sol";


contract CourtStakingMock is CourtStaking {
    uint64 internal mockTime = 0;
    bool internal treeSearchHijacked = false;

    function mock_setTime(uint64 time) external {
        mockTime = time;
    }

    function mock_timeTravel(uint64 time) external {
        mockTime += time;
    }

    function mock_hijackTreeSearch() external {
        treeSearchHijacked = true;
    }

    function updateTreeBalance(address _juror, uint64 _termId, uint256 _delta, bool _positive) external {
        sumTree.update(accounts[_juror].sumTreeId, _termId, _delta, _positive);
    }

    function _treeSearch(uint256[7] _params)
        internal
        view
        returns (uint256[] keys, uint256[] nodeValues)
    {
        if (!treeSearchHijacked) {
            return super._treeSearch(_params);
        }

        uint256 _jurorsRequested = _params[4];

        keys = new uint256[](_jurorsRequested);
        nodeValues = new uint256[](_jurorsRequested);
        for (uint256 i = 0; i < _jurorsRequested; i++) {
            uint256 key = i % (sumTree.getNextKey() - 1) + 1; // loop, and avoid 0
            keys[i] = key;
            nodeValues[i] = sumTree.getItem(key);
        }
    }

    function mock_sortition(uint256 v) public view returns (address) {
        (uint256 k, ) = sumTree.sortition(v, _time(), false);
        return jurorsByTreeId[k];
    }

    function mock_treeTotalSum() public view returns (uint256) {
        return sumTree.totalSumPresent(_time());
    }

    function _time() internal view returns (uint64) {
        return mockTime;
    }
}
