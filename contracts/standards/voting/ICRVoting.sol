pragma solidity ^0.4.24;


interface ICRVoting {
    function createVote(uint8 possibleRulings) external returns(uint256 voteId);
    function getVote(uint256 voteId) external view returns (uint8, uint256);
    function getCastVote(uint256 voteId, address voter) external view returns (uint8);
    function getRulingVotes(uint256 voteId, uint8 ruling) external view returns (uint256);
}
