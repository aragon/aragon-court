pragma solidity ^0.4.24; // TODO: pin solc


interface ISubscriptionOwner {
    function getCurrentTermId() external returns (uint64);
    function getTermRandomness(uint64 _termId) external returns (bytes32);
    function getAccountSumTreeId(address _juror) external returns (uint256);
    function getGovernor() external returns (address);
}
