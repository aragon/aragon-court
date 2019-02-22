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
        address _governor,
        uint64 _firstTermStartTime,
        uint256 _jurorActivationDust,
        uint64 _jurorCooldownTerms
    ) Court(
        _termDuration,
        _jurorToken,
        _feeToken,
        _jurorFee,
        _heartbeatFee,
        _governor,
        _firstTermStartTime,
        _jurorActivationDust,
        _jurorCooldownTerms
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

    function time() internal view returns (uint64) {
        return mockTime;
    }

    function blockNumber() internal view returns (uint64) {
        return mockBn;
    }
}