pragma solidity ^0.4.24;

import "../standards/voting/ICRVotingOwner.sol";
import "../standards/voting/ICRVoting.sol";


contract VotingOwnerMock is ICRVotingOwner {
    uint256 response;

    event VoteCreated(uint256 voteId);

    function setResponse(uint256 _response) external {
        response = _response;
    }

    function createVote(ICRVoting _voting, uint8 _ruling) external {
        uint256 voteId = _voting.createVote(_ruling);
        emit VoteCreated(voteId);
    }

    function canCommit(uint256 voteId, address voter) external returns (uint256) {
        return response;
    }

    function canReveal(uint256 voteId, address voter) external returns (uint256) {
        return response;
    }
}
