pragma solidity ^0.4.24;

import "../Court.sol";


contract CourtMock is Court {
    uint64 internal mockTime = 0;
    uint64 internal mockBn = 0;

    constructor(
        uint64 _termDuration,
        ERC20 _jurorToken,
        ERC20 _feeToken,
        uint256 _jurorFee,
        uint256 _heartbeatFee,
        uint256 _draftFee,
        uint16 _governanceShare,
        address _governor,
        uint64 _firstTermStartTime,
        uint256 _jurorMinStake,
        uint64 _commitTerms,
        uint64 _revealTerms,
        uint64 _appealTerms,
        uint16 _penaltyPct
    ) Court(
        _termDuration,
        _jurorToken,
        _feeToken,
        _jurorFee,
        _heartbeatFee,
        _draftFee,
        _governanceShare,
        _governor,
        _firstTermStartTime,
        _jurorMinStake,
        _commitTerms,
        _revealTerms,
        _appealTerms,
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

    function sortition(uint256 v) public view returns (address) {
        var (k, ) = sumTree.sortition(v);
        return jurorsByTreeId[k];
    }

    function treeTotalSum() public view returns (uint256) {
        return sumTree.totalSum();
    }

    function time() internal view returns (uint64) {
        return mockTime;
    }

    function blockNumber() internal view returns (uint64) {
        return mockBn;
    }
}