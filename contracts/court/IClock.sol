pragma solidity ^0.5.8;


interface IClock {
    function ensureCurrentTerm() external returns (uint64);

    function heartbeat(uint64 _maxRequestedTransitions) external returns (uint64, uint64);

    function ensureTermRandomness(uint64 _termId) external returns (bytes32);

    function getLastEnsuredTermId() external view returns (uint64);

    function getCurrentTermId() external view returns (uint64);

    function getNeededTermTransitions() external view returns (uint64);

    function getTerm(uint64 _termId) external view returns (uint64 startTime, uint64 randomnessBN, bytes32 randomness);

    function getTermRandomness(uint64 _termId) external view returns (bytes32);
}
