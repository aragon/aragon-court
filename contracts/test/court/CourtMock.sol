pragma solidity ^0.5.8;

import "../../court/Court.sol";
import "../lib/TimeHelpersMock.sol";


contract CourtMock is Court, TimeHelpersMock {
    uint64 internal mockedTermId;
    bytes32 internal mockedTermRandomness;

    constructor(
        uint64[2] memory _termParams,
        address[3] memory _governors,
        ERC20 _feeToken,
        uint256[3] memory _fees,
        uint64[4] memory _roundStateDurations,
        uint16[2] memory _pcts,
        uint64[4] memory _roundParams,
        uint256[2] memory _appealCollateralParams,
        uint256 _minActiveBalance
    )
        Court(
            _termParams,
            _governors,
            _feeToken,
            _fees,
            _roundStateDurations,
            _pcts,
            _roundParams,
            _appealCollateralParams,
            _minActiveBalance
        )
        public
    {}

    function setDisputesManager(address _addr) external {
        _setModule(DISPUTES_MANAGER, _addr);
    }

    function setDisputesManagerMock(address _addr) external {
        // This function allows setting any address as the DisputesManager module
        modules[DISPUTES_MANAGER] = _addr;
        emit ModuleSet(DISPUTES_MANAGER, _addr);
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
        else mockedTermId = _lastEnsuredTermId() + 1;
    }

    function mockIncreaseTerms(uint64 _terms) external {
        if (mockedTermId != 0) mockedTermId = mockedTermId + _terms;
        else mockedTermId = _lastEnsuredTermId() + _terms;
    }

    function mockSetTerm(uint64 _termId) external {
        mockedTermId = _termId;
    }

    function mockSetTermRandomness(bytes32 _termRandomness) external {
        mockedTermRandomness = _termRandomness;
    }

    function ensureCurrentTerm() external returns (uint64) {
        if (mockedTermId != 0) return mockedTermId;
        return super._ensureCurrentTerm();
    }

    function getCurrentTermId() external view returns (uint64) {
        if (mockedTermId != 0) return mockedTermId;
        return super._currentTermId();
    }

    function getLastEnsuredTermId() external view returns (uint64) {
        if (mockedTermId != 0) return mockedTermId;
        return super._lastEnsuredTermId();
    }

    function getTermRandomness(uint64 _termId) external view returns (bytes32) {
        if (mockedTermRandomness != bytes32(0)) return mockedTermRandomness;
        return super._computeTermRandomness(_termId);
    }

    function _computeTermRandomness(uint64 _termId) internal view returns (bytes32) {
        if (mockedTermRandomness != bytes32(0)) return mockedTermRandomness;
        return super._computeTermRandomness(_termId);
    }
}
