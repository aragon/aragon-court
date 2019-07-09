pragma solidity ^0.4.24;

import "../standards/voting/ICRVotingOwner.sol";
import "../standards/voting/ICRVoting.sol";


contract VotingOwnerMock is ICRVotingOwner {
    uint256 response;

    event VoteCreated(uint256 voteId);

    function setResponse(uint256 _response) external {
        response = _response;
    }

    function createVote(ICRVoting _voting, uint256 _voteId, uint8 _ruling) external {
        _voting.createVote(_voteId, _ruling);
        emit VoteCreated(_voteId);
    }

    function canCommit(uint256, address) external returns (uint256) {
        return response;
    }

    function canReveal(uint256, address) external returns (uint256) {
        return response;
    }
}
