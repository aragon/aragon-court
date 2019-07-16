pragma solidity ^0.4.24;

import "./ICRVotingOwner.sol";


interface ICRVoting {
    function setOwner(ICRVotingOwner _owner) external;
    function createVote(uint256 voteId, uint8 possibleRulings) external;
    function getOwner() external view returns (address);
    function getWinningRuling(uint256 voteId) external view returns (uint8);
    function getCastVote(uint256 voteId, address voter) external view returns (uint8);
    function getCastVotes(uint256 _voteId, address[] _voters) external view returns (uint8[]);
    function getRulingVotes(uint256 voteId, uint8 ruling) external view returns (uint256);
}
