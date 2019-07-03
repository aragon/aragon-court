pragma solidity ^0.4.24; // TODO: pin solc


interface ISubscriptionOwner {
    function getCurrentTermId() external view returns (uint64);
    function getTermRandomness(uint64 _termId) external view returns (bytes32);
    function getAccountSumTreeId(address _juror) external view returns (uint256);
    function getGovernor() external view returns (address);
}
