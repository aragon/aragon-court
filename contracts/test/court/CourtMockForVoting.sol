pragma solidity ^0.5.8;

import "../../voting/ICRVoting.sol";
import "../../voting/ICRVotingOwner.sol";
import "../../controller/Controller.sol";
import "../../controller/Controlled.sol";


contract CourtMockForVoting is ICRVotingOwner, Controlled {
    string private constant ERROR_VOTER_WEIGHT_ZERO = "CT_VOTER_WEIGHT_ZERO";
    string private constant ERROR_OWNER_MOCK_COMMIT_CHECK_REVERTED = "CRV_OWNER_MOCK_COMMIT_CHECK_REVERTED";
    string private constant ERROR_OWNER_MOCK_REVEAL_CHECK_REVERTED = "CRV_OWNER_MOCK_REVEAL_CHECK_REVERTED";

    bool internal failing;
    mapping (address => uint64) internal weights;

    constructor(Controller _controller) Controlled(_controller) public {}

    function mockChecksFailing(bool _failing) external {
        failing = _failing;
    }

    function mockVoterWeight(address _voter, uint64 _weight) external {
        weights[_voter] = _weight;
    }

    function create(uint256 _voteId, uint8 _ruling) external {
        _voting().create(_voteId, _ruling);
    }

    function ensureCanCommit(uint256 /* _voteId */) external {
        require(!failing, ERROR_OWNER_MOCK_COMMIT_CHECK_REVERTED);
    }

    function ensureCanCommit(uint256 /* _voteId */, address _voter) external {
        require(!failing, ERROR_OWNER_MOCK_COMMIT_CHECK_REVERTED);
        require(weights[_voter] > 0, ERROR_VOTER_WEIGHT_ZERO);
    }

    function ensureCanReveal(uint256 /* _voteId */, address _voter) external returns (uint64) {
        require(!failing, ERROR_OWNER_MOCK_REVEAL_CHECK_REVERTED);
        return weights[_voter];
    }
}
