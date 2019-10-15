pragma solidity ^0.5.8;

import "../../voting/ICRVoting.sol";
import "../../voting/ICRVotingOwner.sol";


contract CRVotingOwnerMock is ICRVotingOwner {
    string private constant ERROR_OWNER_MOCK_COMMIT_CHECK_REVERTED = "CRV_OWNER_MOCK_COMMIT_CHECK_REVERTED";
    string private constant ERROR_OWNER_MOCK_REVEAL_CHECK_REVERTED = "CRV_OWNER_MOCK_REVEAL_CHECK_REVERTED";
    string private constant ERROR_OWNER_MOCK_LEAK_CHECK_REVERTED = "CRV_OWNER_MOCK_LEAK_CHECK_REVERTED";

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

    function ensureTermAndGetVoterWeightToCommit(uint256 /* _voteId */, address _voter) external returns (uint64) {
        if (failing) {
            revert(ERROR_OWNER_MOCK_COMMIT_CHECK_REVERTED);
        }

        return weights[_voter];
    }

    function ensureTermToLeak(uint256 /* _voteId */) external {
        if (failing) {
            revert(ERROR_OWNER_MOCK_LEAK_CHECK_REVERTED);
        }
    }

    function ensureTermAndGetVoterWeightToReveal(uint256 /* _voteId */, address _voter) external returns (uint64) {
        if (failing) {
            revert(ERROR_OWNER_MOCK_REVEAL_CHECK_REVERTED);
        }

        return weights[_voter];
    }
}
