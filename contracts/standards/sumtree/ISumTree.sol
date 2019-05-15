pragma solidity ^0.4.24;


interface ISumTree {
    function init() public;

    function insert(uint64 _checkpointTime, uint256 _value) external returns (uint256);

    function set(uint256 _key, uint64 _checkpointTime, uint256 _value) external;

    function update(uint256 _key, uint64 _checkpointTime, uint256 _delta, bool _positive) external;

    function getItem(uint256 _key) external view returns (uint256);

    function totalSumPresent(uint64 _checkpointTime) external view returns (uint256);

    function sortition(uint256 value, uint64 time, bool past) external view returns (uint256 key, uint256 nodeValue);

    function multiSortition(
        bytes32 _termRandomness,
        uint256 _disputeId,
        uint64 _time,
        bool _past,
        uint256 _nextJurorToDraft,
        uint256 _jurorsRequested,
        uint256 _jurorNumber
    )
        external
        view
        returns (uint256[] keys, uint256[] nodeValues);

    function getNextKey() external view returns (uint256);
}
