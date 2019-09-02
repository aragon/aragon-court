pragma solidity ^0.5.8;


interface IJurorsRegistryOwner {
    function ensureAndGetTermId() external returns (uint64);
    function getLastEnsuredTermId() external view returns (uint64);
}
