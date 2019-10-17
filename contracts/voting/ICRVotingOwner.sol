pragma solidity ^0.5.8;


interface ICRVotingOwner {
    function ensureVoterWeightToCommit(uint256 _voteId, address _voter) external returns (uint64);
    function ensureVoterWeightToReveal(uint256 _voteId, address _voter) external returns (uint64);
}
