pragma solidity ^0.4.24; // TODO: pin solc

import "./standards/voting/ICRVoting.sol";
import "./standards/voting/ICRVotingOwner.sol";


// TODO: Aragon App? CREATE_VOTE role?
contract CRVoting is ICRVoting {
    string internal constant ERROR_NOT_OWNER = "CRV_NOT_OWNER";
    string internal constant ERROR_NOT_ALLOWED_BY_OWNER = "CRV_NOT_ALLOWED_BY__OWNER";
    string internal constant ERROR_ALREADY_VOTED = "CRV_ALREADY_VOTED";
    string internal constant ERROR_INVALID_VOTE = "CRV_INVALID_VOTE";
    string internal constant ERROR_FAILURE_COMMITMENT_CHECK = "CRV_FAILURE_COMMITMENT_CHECK";

    struct CastVote {
        bytes32 commitment;
        uint8 ruling;
        bool rewarded; // TODO!
    }

    struct Vote {
        uint8 possibleRulings;      // number of possible rulings that can be voted
        uint8 winningRuling;
        mapping (bytes32 => CastVote) castVotes;
        mapping (uint256 => uint256) rulingVotes;
    }

    // TODO: repeated in Court.sol
    enum Ruling {
        Missing,
        RefusedRuling
        // ruling options are dispute specific
    }

    ICRVotingOwner owner;
    mapping (uint256 => Vote) votes;
    uint256 votesLength;

    event VoteCommitted(uint256 indexed voteId, address indexed voter, bytes32 commitment);
    event VoteRevealed(uint256 indexed voteId, address indexed voter, uint8 ruling);
    event VoteLeaked(uint256 indexed voteId, address indexed voter, address leaker);

    modifier onlyOwner {
        require(msg.sender == address(owner), ERROR_NOT_OWNER);
        _;
    }

    // TODO: initial setup? what do we deploy first? court? this? CREATE2? Use init function?
    constructor() public {
        owner = ICRVotingOwner(msg.sender);
    }

    function setOwner(ICRVotingOwner _owner) onlyOwner external {
        owner = _owner;
    }

    function createVote(uint8 _possibleRulings) onlyOwner external returns(uint256 voteId) {
        votes[votesLength].possibleRulings = _possibleRulings;
        voteId = votesLength;
        votesLength++;
    }

    /**
     * @notice Commit juror vote for vote #`_voteId`
     */
    function commitVote(uint256 _voteId, uint256 _draftId, bytes32 _commitment) external {
        require(owner.canCommit(_voteId, msg.sender, _draftId), ERROR_NOT_ALLOWED_BY_OWNER);
        CastVote storage castVote = votes[_voteId].castVotes[_getSlotId(msg.sender, _draftId)];
        require(castVote.commitment == bytes32(0) && castVote.ruling == uint8(Ruling.Missing), ERROR_ALREADY_VOTED);

        castVote.commitment = _commitment;

        emit VoteCommitted(_voteId, msg.sender, _commitment);
    }

    /**
     * @notice Leak vote for `_voter` in vote #`_voteId`
     */
    function leakVote(uint256 _voteId, address _voter, uint256 _draftId, uint8 _leakedRuling, bytes32 _salt) external {
        require(owner.canCommit(_voteId, _voter, _draftId), ERROR_NOT_ALLOWED_BY_OWNER);

        uint8 ruling = uint8(Ruling.RefusedRuling);
        CastVote storage castVote = votes[_voteId].castVotes[_getSlotId(_voter, _draftId)];
        castVote.ruling = ruling;

        _checkVote(castVote, _leakedRuling, _salt);

        // TODO: slash juror

        _updateTally(_voteId, ruling);

        emit VoteLeaked(_voteId, _voter, msg.sender);
        emit VoteRevealed(_voteId, _voter, ruling);
    }

    /**
     * @notice Reveal juror `_ruling` vote in dispute #`_disputeId` (round #`_roundId`)
     */
    function revealVote(uint256 _voteId, uint256 _draftId, uint8 _ruling, bytes32 _salt) external {
        require(owner.canReveal(_voteId, msg.sender, _draftId), ERROR_NOT_ALLOWED_BY_OWNER);

        Vote storage vote = votes[_voteId];
        CastVote storage castVote = vote.castVotes[_getSlotId(msg.sender, _draftId)];

        _checkVote(castVote, _ruling, _salt);

        require(_ruling > uint8(Ruling.Missing) && _ruling <= vote.possibleRulings + 1, ERROR_INVALID_VOTE);

        castVote.ruling = _ruling;
        _updateTally(_voteId, _ruling);

        emit VoteRevealed(_voteId, msg.sender, _ruling);
    }

    function getVote(uint256 _voteId) external view returns (uint8 ruling, uint256 winningVoters) {
        Vote storage vote = votes[_voteId];
        ruling = vote.winningRuling;
        if (Ruling(ruling) == Ruling.Missing) {
            ruling = uint8(Ruling.RefusedRuling);
        }
        winningVoters = vote.rulingVotes[ruling];
    }

    function getCastVote(uint256 _voteId, address _voter, uint256 _draftId) external view returns (uint8) {
        return votes[_voteId].castVotes[_getSlotId(_voter, _draftId)].ruling;
    }

    function getRulingVotes(uint256 _voteId, uint8 _ruling) external view returns (uint256) {
        return votes[_voteId].rulingVotes[_ruling];
    }

    function encryptVote(uint8 _ruling, bytes32 _salt) public view returns (bytes32) {
        return keccak256(abi.encodePacked(_ruling, _salt));
    }

    function _getSlotId(address _voter, uint256 _draftId) internal view returns (bytes32 slotId) {
        slotId = keccak256(abi.encodePacked(_voter, _draftId));
    }

    function _checkVote(CastVote storage _castVote, uint8 _ruling, bytes32 _salt) internal {
        require(_castVote.commitment == encryptVote(_ruling, _salt), ERROR_FAILURE_COMMITMENT_CHECK);
        require(_castVote.ruling == uint8(Ruling.Missing), ERROR_ALREADY_VOTED);
    }

    function _updateTally(uint256 _voteId, uint8 _ruling) internal {
        Vote storage vote = votes[_voteId];

        uint256 rulingVotes = vote.rulingVotes[_ruling] + 1;
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
