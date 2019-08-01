pragma solidity ^0.4.24;


interface IStakingOwner {
    function ensureAndGetTerm() external returns (uint64);
}
