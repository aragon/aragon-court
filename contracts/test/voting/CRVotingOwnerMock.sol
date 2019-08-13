pragma solidity ^0.4.24;

import "../../standards/voting/ICRVoting.sol";
import "../../standards/voting/ICRVotingOwner.sol";


contract CRVotingOwnerMock is ICRVotingOwner {
    ICRVoting internal voting;
    bool internal failing;
    mapping (address => uint64) internal weights;

    constructor(ICRVoting _voting) public {
        voting = _voting;
    }

    function mockChecksFailing(bool _failing) external {
        failing = _failing;
    }

    function mockVoterWeight(address _voter, uint64 _weight) external {
        weights[_voter] = _weight;
    }

    function create(uint256 _voteId, uint8 _ruling) external {
        voting.create(_voteId, _ruling);
    }

    function getVoterWeightToCommit(uint256 /* _voteId */, address _voter) external returns (uint64) {
        if (failing) {
            revert('CRV_OWNER_MOCK_COMMIT_CHECK_REVERTED');
        }

        return weights[_voter];
    }

    function getVoterWeightToReveal(uint256 /* _voteId */, address _voter) external returns (uint64) {
        if (failing) {
            revert('CRV_OWNER_MOCK_REVEAL_CHECK_REVERTED');
        }

        return weights[_voter];
    }
}
