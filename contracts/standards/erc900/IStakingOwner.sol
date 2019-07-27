pragma solidity ^0.4.24;


interface IStakingOwner {
    function getTermId() external view returns (uint64);
    function ensureAndGetTermId() external returns (uint64);
}
