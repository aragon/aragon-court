pragma solidity ^0.4.24;

import "../Court.sol";


contract CourtMock is Court {
    uint64 internal mockTime = 0;
    uint64 internal mockBn = 0;
    bool internal treeSearchHijacked = false;

    constructor(
        uint64 _termDuration,
        ERC20 _jurorToken,
        ERC20 _feeToken,
        uint256 _jurorFee,
        uint256 _heartbeatFee,
        uint256 _draftFee,
        uint256 _settleFee,
        uint16 _governanceShare,
        address _governor,
        uint64 _firstTermStartTime,
        uint256 _jurorMinStake,
        uint64[3] _roundStateDurations,
        uint16 _penaltyPct
    ) Court(
        _termDuration,
        _jurorToken,
        _feeToken,
        _jurorFee,
        _heartbeatFee,
        _draftFee,
        _settleFee,
        _governanceShare,
        _governor,
        _firstTermStartTime,
        _jurorMinStake,
        _roundStateDurations,
        _penaltyPct
    ) public {}

    function mock_setTime(uint64 time) external {
        mockTime = time;
    }

    function mock_timeTravel(uint64 time) external {
        mockTime += time;
    }

    function mock_setBlockNumber(uint64 bn) external {
        mockBn = bn;
    }

    function mock_blockTravel(uint64 inc) external {
        mockBn += inc;
    }

    function mock_hijackTreeSearch() external {
        treeSearchHijacked = true;
    }

    function _treeSearch(bytes32 _termRandomness, uint256 _disputeId, uint256 _iteration) internal view returns (uint256 key, uint256 value) {
        if (!treeSearchHijacked) {
            return super._treeSearch(_termRandomness, _disputeId, _iteration);
        }

        key = _iteration % sumTree.nextKey; // loop
        return (key, sumTree.getItem(key));
    }

    function mock_sortition(uint256 v) public view returns (address) {
        var (k, ) = sumTree.sortition(v, 0);
        return jurorsByTreeId[k];
    }

    function mock_treeTotalSum() public view returns (uint256) {
        return sumTree.totalSum();
    }

    function _time() internal view returns (uint64) {
        return mockTime;
    }

    function _blockNumber() internal view returns (uint64) {
        return mockBn;
    }
}
