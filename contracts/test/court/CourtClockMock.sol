pragma solidity ^0.5.8;

import "../../court/CourtClock.sol";
import "../lib/TimeHelpersMock.sol";


contract CourtClockMock is CourtClock, TimeHelpersMock {
    uint64 internal mockedTermId;
    bytes32 internal mockedTermRandomness;

    constructor(Controller _controller, uint64 _termDuration, uint64 _firstTermStartTime)
        CourtClock(_controller, _termDuration, _firstTermStartTime)
        public
    {}

    function mockIncreaseTerm() external {
        if (mockedTermId != 0) mockedTermId = mockedTermId + 1;
        else mockedTermId = termId + 1;
    }

    function mockIncreaseTerms(uint64 _terms) external {
        if (mockedTermId != 0) mockedTermId = mockedTermId + _terms;
        else mockedTermId = termId + _terms;
    }

    function mockSetTerm(uint64 _termId) external {
        mockedTermId = _termId;
    }

    function mockSetTermRandomness(bytes32 _termRandomness) external {
        mockedTermRandomness = _termRandomness;
    }

    function ensureTermId() external returns (uint64) {
        if (mockedTermId != 0) return mockedTermId;
        return _ensureTermId();
    }

    function getCurrentTermId() external view returns (uint64) {
        if (mockedTermId != 0) return mockedTermId;
        return _currentTermId();
    }

    function getLastEnsuredTermId() external view returns (uint64) {
        if (mockedTermId != 0) return mockedTermId;
        return termId;
    }

    function getTermRandomness(uint64 _termId) external view returns (bytes32) {
        if (mockedTermRandomness != bytes32(0)) return mockedTermRandomness;
        return _getTermRandomness(terms[_termId]);
    }
}
