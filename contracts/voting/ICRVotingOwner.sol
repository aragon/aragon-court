pragma solidity ^0.5.8;


interface ICRVotingOwner {
    function getVoterWeightToCommit(uint256 _voteId, address _voter) external returns (uint64);
    function getVoterWeightToReveal(uint256 _voteId, address _voter) external returns (uint64);
}
