pragma solidity ^0.5.8;


interface ISubscriptionsOwner {
    function getCurrentTermId() external view returns (uint64);
    function getTermRandomness(uint64 _termId) external view returns (bytes32);
}
