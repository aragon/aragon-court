pragma solidity ^0.4.24;


interface IStakingOwner {
    function getEnsuredTermId() external view returns (uint64);
}
