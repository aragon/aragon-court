pragma solidity ^0.4.24;

import "./ICRVotingOwner.sol";


interface ICRVoting {
    function setOwner(ICRVotingOwner _owner, bytes32 _initCode) external;
    function createVote(uint8 possibleRulings) external returns(uint256 voteId);
    function getOwner() external view returns (address);
    function getVote(uint256 voteId) external view returns (uint8);
    function getCastVote(uint256 voteId, address voter) external view returns (uint8);
    function getRulingVotes(uint256 voteId, uint8 ruling) external view returns (uint256);
}
