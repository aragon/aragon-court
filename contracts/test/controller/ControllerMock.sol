pragma solidity ^0.5.8;

import "../lib/TimeHelpersMock.sol";
import "../../controller/Controller.sol";


contract ControllerMock is Controller, TimeHelpersMock {
    uint64 internal mockedTermId;
    bytes32 internal mockedTermRandomness;

    constructor(
        uint64 _termDuration,
        uint64 _firstTermStartTime,
        address[3] memory _governors,
        ERC20 _feeToken,
        uint256[3] memory _fees,
        uint64[4] memory _roundStateDurations,
        uint16[2] memory _pcts,
        uint64[3] memory _roundParams,
        uint256[2] memory _appealCollateralParams
    )
        Controller(
            _termDuration,
            _firstTermStartTime,
            _governors,
            _feeToken,
            _fees,
            _roundStateDurations,
            _pcts,
            _roundParams,
            _appealCollateralParams
        )
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

    function setTreasury(address _addr) external {
        _setModule(TREASURY, _addr);
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
        (, uint64 currentTermId) = _ensureCurrentTerm();
        return currentTermId;
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
        return _computeTermRandomness(terms[_termId]);
    }
}
