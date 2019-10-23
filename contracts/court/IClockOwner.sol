pragma solidity ^0.5.8;


interface IClockOwner {
    function heartbeat(uint64 _maxRequestedTransitions) external;
    function ensureCurrentTerm(address _recipient) external returns (uint64);
}
