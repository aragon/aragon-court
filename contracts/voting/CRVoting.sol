pragma solidity ^0.5.8;

import "@aragon/os/contracts/lib/math/SafeMath.sol";
import "@aragon/os/contracts/common/Initializable.sol";

import "./ICRVoting.sol";
import "./ICRVotingOwner.sol";


contract CRVoting is Initializable, ICRVoting {
    using SafeMath for uint256;

    string internal constant ERROR_NOT_OWNER = "CRV_SENDER_NOT_OWNER";
    string internal constant ERROR_OWNER_NOT_CONTRACT = "CRV_OWNER_NOT_CONTRACT";
    string internal constant ERROR_COMMIT_DENIED_BY_OWNER = "CRV_COMMIT_DENIED_BY_OWNER";
    string internal constant ERROR_REVEAL_DENIED_BY_OWNER = "CRV_REVEAL_DENIED_BY_OWNER";
    string internal constant ERROR_VOTE_ALREADY_EXISTS = "CRV_VOTE_ALREADY_EXISTS";
    string internal constant ERROR_VOTE_DOES_NOT_EXIST = "CRV_VOTE_DOES_NOT_EXIST";
    string internal constant ERROR_VOTE_ALREADY_COMMITTED = "CRV_VOTE_ALREADY_COMMITTED";
    string internal constant ERROR_VOTE_ALREADY_REVEALED = "CRV_VOTE_ALREADY_REVEALED";
    string internal constant ERROR_INVALID_OUTCOME = "CRV_INVALID_OUTCOME";
    string internal constant ERROR_INVALID_OUTCOMES_AMOUNT = "CRV_INVALID_OUTCOMES_AMOUNT";
    string internal constant ERROR_INVALID_COMMITMENT_SALT = "CRV_INVALID_COMMITMENT_SALT";

    // Outcome nr. 0 is used to denote a missing vote (default)
    uint8 internal constant OUTCOME_MISSING = uint8(0);
    // Outcome nr. 1 is used to denote a leaked vote
    uint8 internal constant OUTCOME_LEAKED = uint8(1);
    // Outcome nr. 2 is used to denote a refused vote
    uint8 internal constant OUTCOME_REFUSED = uint8(2);
    // Besides the options listed above, every vote instance must provide at least 2 outcomes
    uint8 internal constant MIN_POSSIBLE_OUTCOMES = uint8(2);
    // Max number of outcomes excluding the default ones
    uint8 internal constant MAX_POSSIBLE_OUTCOMES = uint8(-1) - OUTCOME_REFUSED;

    struct CastVote {
        bytes32 commitment;     // hash of the outcome casted by the voter
        uint8 outcome;          // outcome submitted by the voter
    }

    struct Vote {
        uint8 winningOutcome;                       // outcome winner of a vote instance
        uint8 maxAllowedOutcome;                    // highest outcome allowed for the vote instance
        mapping (address => CastVote) votes;        // mapping of voters addresses to their casted votes
        mapping (uint8 => uint256) outcomesTally;   // tally for each of the possible outcomes
    }

    // CRVoting owner address
    ICRVotingOwner private owner;

    // Vote records indexed by their ID
    mapping (uint256 => Vote) internal voteRecords;

    event VotingCreated(uint256 indexed voteId, uint8 possibleOutcomes);
    event VoteCommitted(uint256 indexed voteId, address indexed voter, bytes32 commitment);
    event VoteRevealed(uint256 indexed voteId, address indexed voter, uint8 outcome);
    event VoteLeaked(uint256 indexed voteId, address indexed voter, uint8 outcome, address leaker);

    modifier onlyOwner {
        require(msg.sender == address(owner), ERROR_NOT_OWNER);
        _;
    }

    modifier voteExists(uint256 _voteId) {
        Vote storage vote = voteRecords[_voteId];
        require(_existsVote(vote), ERROR_VOTE_DOES_NOT_EXIST);
        _;
    }

    /**
    * @notice Initialize a CRVoting instance
    * @param _owner Address to be set as the owner of the CRVoting instance
    */
    function init(ICRVotingOwner _owner) external {
        // TODO: cannot check the given owner is a contract cause the Court set this up in the constructor, move to a factory
        // require(isContract(_owner), ERROR_OWNER_NOT_CONTRACT);

        initialized();
        owner = _owner;
    }

    /**
    * @notice Create a new vote instance with ID #`_voteId` and `_possibleOutcomes` possible outcomes
    * @dev This function can only be called by the CRVoting owner
    * @param _voteId ID of the new vote instance to be created
    * @param _possibleOutcomes Number of possible outcomes for the new vote instance to be created
    */
    function create(uint256 _voteId, uint8 _possibleOutcomes) external onlyOwner {
        require(_possibleOutcomes >= MIN_POSSIBLE_OUTCOMES && _possibleOutcomes <= MAX_POSSIBLE_OUTCOMES, ERROR_INVALID_OUTCOMES_AMOUNT);

        Vote storage vote = voteRecords[_voteId];
        require(!_existsVote(vote), ERROR_VOTE_ALREADY_EXISTS);

        // Note that there is no need to use SafeMath here, we already checked the number of outcomes above
        vote.maxAllowedOutcome = OUTCOME_REFUSED + _possibleOutcomes;
        emit VotingCreated(_voteId, _possibleOutcomes);
    }

    /**
    * @notice Commit a vote for vote #`_voteId`
    * @param _voteId ID of the vote instance to commit a vote to
    * @param _commitment Encrypted outcome to be stored for future reveal
    */
    function commit(uint256 _voteId, bytes32 _commitment) external voteExists(_voteId) {
        _ensureVoterWeightToCommit(_voteId, msg.sender);

        CastVote storage castVote = voteRecords[_voteId].votes[msg.sender];
        require(castVote.commitment == bytes32(0), ERROR_VOTE_ALREADY_COMMITTED);

        castVote.commitment = _commitment;
        emit VoteCommitted(_voteId, msg.sender, _commitment);
    }

    /**
    * @notice Leak `_outcome` vote of `_voter` for vote #`_voteId`
    * @param _voteId ID of the vote instance to leak a vote of
    * @param _voter Address of the voter to leak a vote of
    * @param _outcome Outcome leaked for the voter
    * @param _salt Salt to decrypt and validate the committed vote of the voter
    */
    function leak(uint256 _voteId, address _voter, uint8 _outcome, bytes32 _salt) external voteExists(_voteId) {
        _ensureVoterWeightToCommit(_voteId, _voter);

        CastVote storage castVote = voteRecords[_voteId].votes[_voter];
        _ensureCanReveal(castVote, _outcome, _salt);

        // There is no need to check if an outcome is valid if it was leaked.
        // Additionally, leaked votes are not considered for the tally.
        castVote.outcome = OUTCOME_LEAKED;
        emit VoteLeaked(_voteId, _voter, _outcome, msg.sender);
    }

    /**
    * @notice Reveal `_outcome` vote of `_voter` for vote #`_voteId`
    * @param _voteId ID of the vote instance to reveal a vote of
    * @param _outcome Outcome revealed by the voter
    * @param _salt Salt to decrypt and validate the committed vote of the voter
    */
    function reveal(uint256 _voteId, uint8 _outcome, bytes32 _salt) external voteExists(_voteId) {
        uint256 weight = _ensureVoterWeightToReveal(_voteId, msg.sender);

        Vote storage vote = voteRecords[_voteId];
        CastVote storage castVote = vote.votes[msg.sender];
        _ensureCanReveal(castVote, _outcome, _salt);
        require(_isValidOutcome(vote, _outcome), ERROR_INVALID_OUTCOME);

        castVote.outcome = _outcome;
        _updateTally(vote, _outcome, weight);
        emit VoteRevealed(_voteId, msg.sender, _outcome);
    }

    /**
    * @dev Get the address of the CRVoting owner
    * @return Address of the CRVoting owner
    */
    function getOwner() external view returns (address) {
        return address(owner);
    }

    /**
    * @dev Get the maximum allowed outcome for a given vote instance
    * @param _voteId ID of the vote instance querying the max allowed outcome of
    * @return Max allowed outcome for the given vote instance
    */
    function getMaxAllowedOutcome(uint256 _voteId) external voteExists(_voteId) view returns (uint8) {
        Vote storage vote = voteRecords[_voteId];
        return vote.maxAllowedOutcome;
    }

    /**
    * @dev Get the winning outcome of a vote instance. If the winning outcome is missing, which means no one voted in
    *      the given vote instance, it will be considered refused.
    * @param _voteId ID of the vote instance querying the winning outcome of
    * @return Winning outcome of the given vote instance or refused in case it's missing
    */
    function getWinningOutcome(uint256 _voteId) external voteExists(_voteId) view returns (uint8) {
        Vote storage vote = voteRecords[_voteId];
        uint8 winningOutcome = vote.winningOutcome;
        return winningOutcome == OUTCOME_MISSING ? OUTCOME_REFUSED : winningOutcome;
    }

    /**
    * @dev Get the tally of the winning outcome for a certain vote instance
    * @param _voteId ID of the vote instance querying the tally of
    * @return Tally of the winning outcome being queried for the given vote instance
    */
    function getWinningOutcomeTally(uint256 _voteId) external voteExists(_voteId) view returns (uint256) {
        Vote storage vote = voteRecords[_voteId];
        return vote.outcomesTally[vote.winningOutcome];
    }

    /**
    * @dev Get the tally of an outcome for a certain vote instance
    * @param _voteId ID of the vote instance querying the tally of
    * @param _outcome Outcome querying the tally of
    * @return Tally of the outcome being queried for the given vote instance
    */
    function getOutcomeTally(uint256 _voteId, uint8 _outcome) external voteExists(_voteId) view returns (uint256) {
        Vote storage vote = voteRecords[_voteId];
        return vote.outcomesTally[_outcome];
    }

    /**
    * @dev Tell whether an outcome is valid for a given vote instance or not. Missing and leaked outcomes are not considered
    *      valid. The only valid outcomes are refused or any of the custom outcomes of the given vote instance.
    * @param _voteId ID of the vote instance to check the outcome of
    * @param _outcome Outcome to check if valid or not
    * @return True if the given outcome is valid for the requested vote instance, false otherwise.
    */
    function isValidOutcome(uint256 _voteId, uint8 _outcome) external voteExists(_voteId) view returns (bool) {
        Vote storage vote = voteRecords[_voteId];
        return _isValidOutcome(vote, _outcome);
    }

    /**
    * @dev Get the outcome voted by a voter for a certain vote instance
    * @param _voteId ID of the vote instance querying the outcome of
    * @param _voter Address of the voter querying the outcome of
    * @return Outcome of the voter for the given vote instance
    */
    function getVoterOutcome(uint256 _voteId, address _voter) external voteExists(_voteId) view returns (uint8) {
        Vote storage vote = voteRecords[_voteId];
        return vote.votes[_voter].outcome;
    }

    /**
    * @dev Tell whether a voter voted in favor of a certain outcome in a vote instance or not. If there was no winning
    *      outcome, it means that no one voted in favor of any of the possible outcomes.
    * @param _voteId ID of the vote instance to query if a voter voted in favor of a certain outcome
    * @param _outcome Outcome to query if the given voter voted in favor of
    * @param _voter Address of the voter to query if voted in favor of the given outcome
    * @return True if the given voter voted in favor of the given outcome, false otherwise
    */
    function hasVotedInFavorOf(uint256 _voteId, uint8 _outcome, address _voter) external voteExists(_voteId) view returns (bool) {
        Vote storage vote = voteRecords[_voteId];
        return vote.winningOutcome != OUTCOME_MISSING && _outcome != OUTCOME_MISSING && vote.votes[_voter].outcome == _outcome;
    }

    /**
    * @dev Filter a list of voters based on whether they voted in favor of a certain outcome in a vote instance or not.
    *      Note that if there was no winning outcome, it means that no one voted, then all voters will be considered
    *      voting against any of the given outcomes.
    * @param _voteId ID of the vote instance to be checked
    * @param _outcome Outcome to filter the list of voters of
    * @param _voters List of addresses of the voters to be filtered
    * @return List of results to tell whether a voter voted in favor of the given outcome or not
    */
    function getVotersInFavorOf(uint256 _voteId, uint8 _outcome, address[] calldata _voters) external voteExists(_voteId) view
        returns (bool[] memory)
    {
        Vote storage vote = voteRecords[_voteId];
        uint8 winningOutcome = vote.winningOutcome;
        bool[] memory votersInFavor = new bool[](_voters.length);

        // If there is no winning outcome (if no valid votes were tallied), no one will be marked as voting in favor of any given outcome.
        if (winningOutcome == OUTCOME_MISSING || _outcome == OUTCOME_MISSING) {
            return votersInFavor;
        }

        // If there was a winning outcome, filter those voters that voted in favor of the given outcome.
        for (uint256 i = 0; i < _voters.length; i++) {
            votersInFavor[i] = _outcome == vote.votes[_voters[i]].outcome;
        }
        return votersInFavor;
    }

    /**
    * @dev Encrypt a vote outcome using a given salt
    * @param _outcome Outcome to be encrypted
    * @param _salt Encryption salt
    * @return Encrypted outcome
    */
    function encryptVote(uint8 _outcome, bytes32 _salt) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(_outcome, _salt));
    }

    /**
    * @dev Internal function to fetch and ensure the weight of voter willing to commit a vote for a given vote instance
    * @param _voteId ID of the vote instance to check the voter's weight of
    * @param _voter Address of the voter willing to commit a vote
    * @return Weight of the voter willing to commit a vote
    */
    function _ensureVoterWeightToCommit(uint256 _voteId, address _voter) internal returns (uint256) {
        uint256 weight = uint256(owner.getVoterWeightToCommit(_voteId, _voter));
        require(weight > 0, ERROR_COMMIT_DENIED_BY_OWNER);
        return weight;
    }

    /**
    * @dev Internal function to fetch and ensure the weight of voter willing to reveal a vote for a given vote instance
    * @param _voteId ID of the vote instance to check the voter's weight of
    * @param _voter Address of the voter willing to reveal a vote
    * @return Weight of the voter willing to reveal a vote
    */
    function _ensureVoterWeightToReveal(uint256 _voteId, address _voter) internal returns (uint256) {
        uint256 weight = uint256(owner.getVoterWeightToReveal(_voteId, _voter));
        require(weight > 0, ERROR_REVEAL_DENIED_BY_OWNER);
        return weight;
    }

    /**
    * @dev Internal function to check if a vote can be revealed for the given outcome and salt
    * @param _castVote Cast vote to be revealed
    * @param _outcome Outcome of the cast vote to be proved
    * @param _salt Salt to decrypt and validate the provided outcome for a cast vote
    */
    function _ensureCanReveal(CastVote storage _castVote, uint8 _outcome, bytes32 _salt) internal view {
        require(_castVote.outcome == OUTCOME_MISSING, ERROR_VOTE_ALREADY_REVEALED);
        require(_castVote.commitment == encryptVote(_outcome, _salt), ERROR_INVALID_COMMITMENT_SALT);
    }

    /**
    * @dev Internal function to tell whether a certain outcome is valid for a given vote instance or not. Note that
    *      the missing and leaked outcomes are not considered valid. The only outcomes considered valid are refused
    *      or any of the possible outcomes of the given vote instance. This function assumes the given vote exists.
    * @param _vote Vote instance to check the outcome of
    * @param _outcome Outcome to check if valid or not
    * @return True if the given outcome is valid for the requested vote instance, false otherwise.
    */
    function _isValidOutcome(Vote storage _vote, uint8 _outcome) internal view returns (bool) {
        return _outcome >= OUTCOME_REFUSED && _outcome <= _vote.maxAllowedOutcome;
    }

    /**
    * @dev Internal function to check if a vote instance was already created
    * @param _vote Vote instance to be checked
    * @return True if the given vote instance was already created, false otherwise
    */
    function _existsVote(Vote storage _vote) internal view returns (bool) {
        return _vote.maxAllowedOutcome != OUTCOME_MISSING;
    }

    /**
    * @dev Private function to update the tally of a given vote instance based on a new weight in favor of an outcome.
    *      This function assumes the vote instance exists.
    * @param _vote Vote instance to update the tally of
    * @param _outcome Outcome of the vote instance to update the tally of
    * @param _weight Weight to be added to the given outcome of the vote instance
    */
    function _updateTally(Vote storage _vote, uint8 _outcome, uint256 _weight) private {
        // Check if the given outcome is valid. Missing and leaked votes are ignored for the tally.
        if (!_isValidOutcome(_vote, _outcome)) {
            return;
        }

        uint256 newOutcomeTally = _vote.outcomesTally[_outcome].add(_weight);
        _vote.outcomesTally[_outcome] = newOutcomeTally;

        // Update the winning outcome only if its support was passed or if the given outcome represents a lowest
        // option than the winning outcome in case of a tie
        uint8 winningOutcome = _vote.winningOutcome;
        uint256 winningOutcomeTally = _vote.outcomesTally[winningOutcome];
        if (newOutcomeTally > winningOutcomeTally || (newOutcomeTally == winningOutcomeTally && _outcome < winningOutcome)) {
            _vote.winningOutcome = _outcome;
        }
    }
}
