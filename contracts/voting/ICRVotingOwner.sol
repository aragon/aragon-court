pragma solidity ^0.5.8;


interface ICRVotingOwner {
    function ensureTermAndGetVoterWeightToCommit(uint256 _voteId, address _voter) external returns (uint64);
    function ensureTermToLeak(uint256 _voteId) external;
    function ensureTermAndGetVoterWeightToReveal(uint256 _voteId, address _voter) external returns (uint64);
}
