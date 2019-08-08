pragma solidity ^0.4.24;

import "../../standards/voting/ICRVoting.sol";
import "../../standards/voting/ICRVotingOwner.sol";


contract CRVotingOwnerMock is ICRVotingOwner {
    ICRVoting internal voting;
    mapping (address => uint256) internal weights;

    event VotingCreated(uint256 _votingId);

    constructor(ICRVoting _voting) public {
        voting = _voting;
    }

    function mockJurorWeight(address _juror, uint256 _weight) external {
        weights[_juror] = _weight;
    }

    function create(uint256 _votingId, uint8 _ruling) external {
        voting.create(_votingId, _ruling);
        emit VotingCreated(_votingId);
    }

    function getVoterWeightToCommit(uint256 /* _votingId */, address _juror) external returns (uint256) {
        return weights[_juror];
    }

    function getVoterWeightToReveal(uint256 /* _votingId */, address _juror) external returns (uint256) {
        return weights[_juror];
    }
}
