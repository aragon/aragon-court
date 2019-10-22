pragma solidity ^0.5.8;

import "../lib/TimeHelpersMock.sol";
import "../../controller/Controller.sol";


contract ControllerMock is Controller, TimeHelpersMock {
    uint64 internal mockedTermId;
    bytes32 internal mockedTermRandomness;

    constructor(uint64 _termDuration, uint64 _firstTermStartTime)
        Controller(_termDuration, _firstTermStartTime, msg.sender, msg.sender, msg.sender)
        public
    {}

    function setCourt(address _addr) external {
        _setModule(COURT, _addr);
    }

    function setCourtMock(address _addr) external {
        // This function allows setting any address as the court module
        modules[COURT] = _addr;
        emit ModuleSet(COURT, _addr);
    }

    function setAccounting(address _addr) external {
        _setModule(ACCOUNTING, _addr);
    }

    function setVoting(address _addr) external {
        _setModule(VOTING, _addr);
    }

    function setJurorsRegistry(address _addr) external {
        _setModule(JURORS_REGISTRY, _addr);
    }

    function setSubscriptions(address _addr) external {
        _setModule(SUBSCRIPTIONS, _addr);
    }

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

    function ensureCurrentTerm() external returns (uint64) {
        if (mockedTermId != 0) return mockedTermId;
        return _ensureCurrentTerm();
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
