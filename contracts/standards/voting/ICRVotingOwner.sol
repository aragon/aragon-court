pragma solidity ^0.4.24;


interface ICRVotingOwner {
    function getVoterWeightToCommit(uint256 _votingId, address _voter) external returns (uint256);
    function getVoterWeightToReveal(uint256 _votingId, address _voter) external returns (uint256);
}
