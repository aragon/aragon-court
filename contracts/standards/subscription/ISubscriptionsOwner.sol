pragma solidity ^0.4.24; // TODO: pin solc


interface ISubscriptionsOwner {
    function getCurrentTermId() external view returns (uint64);
    function getTermRandomness(uint64 _termId) external view returns (bytes32);
    function getGovernor() external view returns (address);
}
