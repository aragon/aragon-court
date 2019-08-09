pragma solidity ^0.4.24; // TODO: pin solc

import "./standards/voting/ICRVoting.sol";
import "./standards/voting/ICRVotingOwner.sol";


// TODO: Aragon App? CREATE_VOTE role?
contract CRVoting is ICRVoting {
    string internal constant ERROR_NOT_OWNER = "CRV_NOT_OWNER";
    string internal constant ERROR_OWNER_ALREADY_SET = "CRV_OWNER_ALREADY_SET";
    string internal constant ERROR_ZERO_RULINGS = "CRV_ZERO_RULINGS";
    string internal constant ERROR_VOTING_ALREADY_EXISTS = "CRV_VOTING_ALREADY_EXISTS";
    string internal constant ERROR_NOT_ALLOWED_BY_OWNER = "CRV_NOT_ALLOWED_BY_OWNER";
    string internal constant ERROR_ALREADY_VOTED = "CRV_ALREADY_VOTED";
    string internal constant ERROR_INVALID_VOTE = "CRV_INVALID_VOTE";
    string internal constant ERROR_FAILURE_COMMITMENT_CHECK = "CRV_FAILURE_COMMITMENT_CHECK";
    string internal constant ERROR_OUT_OF_BOUNDS = "CRV_OUT_OF_BOUNDS";

    struct CastVote {
        bytes32 commitment;
        uint8 ruling;
    }

    struct Vote {
        uint8 possibleRulings;      // number of possible rulings that can be voted
        uint8 winningRuling;
        mapping (address => CastVote) castVotes;
        mapping (uint256 => uint256) rulingVotes;
    }

    enum Ruling {
        Missing,
        Refused
        // ruling options are dispute specific
    }

    ICRVotingOwner private owner;
    mapping (uint256 => Vote) internal votes;

    event VoteCommitted(uint256 indexed voteId, address indexed voter, bytes32 commitment);
    event VoteRevealed(uint256 indexed voteId, address indexed voter, uint8 ruling);
    event VoteLeaked(uint256 indexed voteId, address indexed voter, address leaker);

    modifier onlyOwner {
        require(msg.sender == address(owner), ERROR_NOT_OWNER);
        _;
    }

    /**
     * @dev This can be frontrunned, and ownership stolen, but the Court will notice,
     *      because its call to this function will revert
     */
    function setOwner(ICRVotingOwner _owner) external {
        require(address(owner) == address(0), ERROR_OWNER_ALREADY_SET);
        owner = _owner;
    }

    function createVote(uint256 _voteId, uint8 _possibleRulings) external onlyOwner {
        require(_possibleRulings > 0, ERROR_ZERO_RULINGS);
        Vote storage vote = votes[_voteId];
        require(vote.possibleRulings == 0, ERROR_VOTING_ALREADY_EXISTS);

        vote.possibleRulings = _possibleRulings;
    }

    /**
     * @notice Commit juror vote for vote #`_voteId`
     */
    function commitVote(uint256 _voteId, bytes32 _commitment) external {
        Vote storage vote = votes[_voteId];
        require(vote.possibleRulings > 0, ERROR_OUT_OF_BOUNDS);
        require(owner.canCommit(_voteId, msg.sender) > 0, ERROR_NOT_ALLOWED_BY_OWNER);
        CastVote storage castVote = vote.castVotes[msg.sender];
        require(castVote.commitment == bytes32(0) && castVote.ruling == uint8(Ruling.Missing), ERROR_ALREADY_VOTED);

        castVote.commitment = _commitment;

        emit VoteCommitted(_voteId, msg.sender, _commitment);
    }

    /**
     * @notice Leak vote for `_voter` in vote #`_voteId`
     */
    function leakVote(uint256 _voteId, address _voter, uint8 _leakedRuling, bytes32 _salt) external {
        Vote storage vote = votes[_voteId];
        require(vote.possibleRulings > 0, ERROR_OUT_OF_BOUNDS);
        uint256 weight = owner.canCommit(_voteId, _voter);
        require(weight > 0, ERROR_NOT_ALLOWED_BY_OWNER);

        uint8 ruling = uint8(Ruling.Refused);
        CastVote storage castVote = vote.castVotes[_voter];

        _checkVote(castVote, _leakedRuling, _salt);

        castVote.ruling = ruling;

        // TODO: slash juror

        _updateTally(_voteId, ruling, weight);

        emit VoteLeaked(_voteId, _voter, msg.sender);
        emit VoteRevealed(_voteId, _voter, ruling);
    }

    /**
     * @notice Reveal juror `_ruling` vote in dispute #`_disputeId` (round #`_roundId`)
     */
    function revealVote(uint256 _voteId, uint8 _ruling, bytes32 _salt) external {
        Vote storage vote = votes[_voteId];
        require(vote.possibleRulings > 0, ERROR_OUT_OF_BOUNDS);
        uint256 weight = owner.canReveal(_voteId, msg.sender);
        require(weight > 0, ERROR_NOT_ALLOWED_BY_OWNER);

        CastVote storage castVote = vote.castVotes[msg.sender];

        _checkVote(castVote, _ruling, _salt);

        require(_ruling > uint8(Ruling.Missing) && _ruling <= vote.possibleRulings + 1, ERROR_INVALID_VOTE);

        castVote.ruling = _ruling;
        _updateTally(_voteId, _ruling, weight);

        emit VoteRevealed(_voteId, msg.sender, _ruling);
    }

    function getOwner() external view returns (address) {
        return address(owner);
    }

    function getWinningRuling(uint256 _voteId) external view returns (uint8 winningRuling) {
        Vote storage vote = votes[_voteId];
        require(vote.possibleRulings > 0, ERROR_OUT_OF_BOUNDS);

        winningRuling = vote.winningRuling;

        if (winningRuling == uint8(Ruling.Missing)) {
            winningRuling = uint8(Ruling.Refused);
        }
    }

    function getCastVote(uint256 _voteId, address _voter) external view returns (uint8) {
        Vote storage vote = votes[_voteId];
        require(vote.possibleRulings > 0, ERROR_OUT_OF_BOUNDS);

        return vote.castVotes[_voter].ruling;
    }

    function getCastVotes(uint256 _voteId, address[] _voters) external view returns (uint8[]) {
        Vote storage vote = votes[_voteId];
        require(vote.possibleRulings > 0, ERROR_OUT_OF_BOUNDS);

        uint8[] memory castVotes = new uint8[](_voters.length);
        for (uint256 i = 0; i < _voters.length; i++) {
            castVotes[i] = vote.castVotes[_voters[i]].ruling;
        }

        return castVotes;
    }

    function getRulingVotes(uint256 _voteId, uint8 _ruling) external view returns (uint256) {
        Vote storage vote = votes[_voteId];
        require(vote.possibleRulings > 0, ERROR_OUT_OF_BOUNDS);

        return vote.rulingVotes[_ruling];
    }

    function encryptVote(uint8 _ruling, bytes32 _salt) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(_ruling, _salt));
    }

    function _checkVote(CastVote storage _castVote, uint8 _ruling, bytes32 _salt) internal view {
        require(_castVote.commitment == encryptVote(_ruling, _salt), ERROR_FAILURE_COMMITMENT_CHECK);
        require(_castVote.ruling == uint8(Ruling.Missing), ERROR_ALREADY_VOTED);
    }

    function _updateTally(uint256 _voteId, uint8 _ruling, uint256 _weight) internal {
        Vote storage vote = votes[_voteId];

        uint256 rulingVotes = vote.rulingVotes[_ruling] + _weight; // TODO: safe math?
        vote.rulingVotes[_ruling] = rulingVotes;

        uint8 winningRuling = vote.winningRuling;
        uint256 winningSupport = vote.rulingVotes[winningRuling];

        // If it passes the currently winning option
        // Or if there is a tie, the lowest ruling option is set as the winning ruling
        if (rulingVotes > winningSupport || (rulingVotes == winningSupport && _ruling < winningRuling)) {
            vote.winningRuling = _ruling;
        }
    }
}
