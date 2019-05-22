pragma solidity ^0.4.24; // TODO: pin solc

import "./standards/voting/ICRVoting.sol";
import "./standards/voting/ICRVotingOwner.sol";


// TODO: Aragon App? CREATE_VOTE role?
contract CRVoting is ICRVoting {
    string internal constant ERROR_NOT_OWNER = "CRV_NOT_OWNER";
    string internal constant ERROR_WRONG_INIT_CODE = "CRV_WRONG_INIT_CODE";
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
        RefusedRuling
        // ruling options are dispute specific
    }

    ICRVotingOwner private owner;
    mapping (uint256 => Vote) internal votes;
    uint256 public votesLength;

    event VoteCommitted(uint256 indexed voteId, address indexed voter, bytes32 commitment);
    event VoteRevealed(uint256 indexed voteId, address indexed voter, uint8 ruling);
    event VoteLeaked(uint256 indexed voteId, address indexed voter, address leaker);

    modifier onlyOwner {
        require(msg.sender == address(owner), ERROR_NOT_OWNER);
        _;
    }

    constructor(address _preOwner) public {
        owner = ICRVotingOwner(_preOwner);
    }

    function setOwner(ICRVotingOwner _owner, bytes32 _initCode) external {
        require(address(owner) == address(keccak256(abi.encodePacked(_initCode))), ERROR_WRONG_INIT_CODE);
        owner = _owner;
    }

    function createVote(uint8 _possibleRulings) external onlyOwner returns(uint256 voteId) {
        votes[votesLength].possibleRulings = _possibleRulings;
        voteId = votesLength;
        votesLength++;
    }

    /**
     * @notice Commit juror vote for vote #`_voteId`
     */
    function commitVote(uint256 _voteId, bytes32 _commitment) external {
        require(_voteId < votesLength, ERROR_OUT_OF_BOUNDS);
        require(owner.canCommit(_voteId, msg.sender) > 0, ERROR_NOT_ALLOWED_BY_OWNER);
        CastVote storage castVote = votes[_voteId].castVotes[msg.sender];
        require(castVote.commitment == bytes32(0) && castVote.ruling == uint8(Ruling.Missing), ERROR_ALREADY_VOTED);

        castVote.commitment = _commitment;

        emit VoteCommitted(_voteId, msg.sender, _commitment);
    }

    /**
     * @notice Leak vote for `_voter` in vote #`_voteId`
     */
    function leakVote(uint256 _voteId, address _voter, uint8 _leakedRuling, bytes32 _salt) external {
        require(_voteId < votesLength, ERROR_OUT_OF_BOUNDS);
        uint256 weight = owner.canCommit(_voteId, _voter);
        require(weight > 0, ERROR_NOT_ALLOWED_BY_OWNER);

        uint8 ruling = uint8(Ruling.RefusedRuling);
        CastVote storage castVote = votes[_voteId].castVotes[_voter];

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
        require(_voteId < votesLength, ERROR_OUT_OF_BOUNDS);
        uint256 weight = owner.canReveal(_voteId, msg.sender);
        require(weight > 0, ERROR_NOT_ALLOWED_BY_OWNER);

        Vote storage vote = votes[_voteId];
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

    function getVote(uint256 _voteId) external view returns (uint8 winningRuling) {
        require(_voteId < votesLength, ERROR_OUT_OF_BOUNDS);

        Vote storage vote = votes[_voteId];

        winningRuling = vote.winningRuling;

        if (Ruling(winningRuling) == Ruling.Missing) {
            winningRuling = uint8(Ruling.RefusedRuling);
        }
    }

    function getCastVote(uint256 _voteId, address _voter) external view returns (uint8) {
        require(_voteId < votesLength, ERROR_OUT_OF_BOUNDS);

        return votes[_voteId].castVotes[_voter].ruling;
    }

    function getRulingVotes(uint256 _voteId, uint8 _ruling) external view returns (uint256) {
        require(_voteId < votesLength, ERROR_OUT_OF_BOUNDS);

        return votes[_voteId].rulingVotes[_ruling];
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
