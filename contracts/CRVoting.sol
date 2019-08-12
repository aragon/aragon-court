pragma solidity ^0.4.24; // TODO: pin solc

import "@aragon/os/contracts/lib/math/SafeMath.sol";
import "@aragon/os/contracts/common/Initializable.sol";

import "./standards/voting/ICRVoting.sol";
import "./standards/voting/ICRVotingOwner.sol";


contract CRVoting is Initializable, ICRVoting {
    using SafeMath for uint256;

    string internal constant ERROR_NOT_OWNER = "CRV_SENDER_NOT_OWNER";
    string internal constant ERROR_OWNER_NOT_CONTRACT = "CRV_OWNER_NOT_CONTRACT";
    string internal constant ERROR_COMMIT_DENIED_BY_OWNER = "CRV_COMMIT_DENIED_BY_OWNER";
    string internal constant ERROR_REVEAL_DENIED_BY_OWNER = "CRV_REVEAL_DENIED_BY_OWNER";
    string internal constant ERROR_VOTING_ALREADY_EXISTS = "CRV_VOTING_ALREADY_EXISTS";
    string internal constant ERROR_VOTING_DOES_NOT_EXIST = "CRV_VOTING_DOES_NOT_EXIST";
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
    // Besides the options listed above, every voting must provide at least 2 outcomes
    uint8 internal constant MIN_POSSIBLE_OUTCOMES = uint8(2);
    // Max number of outcomes excluding the default ones
    uint8 internal constant MAX_POSSIBLE_OUTCOMES = uint8(-1) - OUTCOME_REFUSED;

    struct Vote {
        bytes32 commitment;     // hash of the outcome casted by the voter
        uint8 outcome;          // outcome submitted by the voter
    }

    struct Voting {
        uint8 winningOutcome;                       // outcome winner of a voting
        uint8 maxAllowedOutcome;                    // highest outcome allowed for the voting
        mapping (address => Vote) votes;            // mapping of voters addresses to their casted votes
        mapping (uint8 => uint256) outcomesTally;   // tally for each of the possible outcomes
    }

    // CRVoting owner address
    ICRVotingOwner private owner;

    // Voting records indexed by their ID
    mapping (uint256 => Voting) internal votingRecords;

    event VotingCreated(uint256 indexed votingId, uint8 possibleOutcomes);
    event VoteCommitted(uint256 indexed votingId, address indexed voter, bytes32 commitment);
    event VoteRevealed(uint256 indexed votingId, address indexed voter, uint8 outcome);
    event VoteLeaked(uint256 indexed votingId, address indexed voter, uint8 outcome, address leaker);

    modifier onlyOwner {
        require(msg.sender == address(owner), ERROR_NOT_OWNER);
        _;
    }

    modifier votingExists(uint256 _votingId) {
        Voting storage voting = votingRecords[_votingId];
        require(_existsVoting(voting), ERROR_VOTING_DOES_NOT_EXIST);
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
    * @notice Create a new voting with ID #`_votingId` and `_possibleOutcomes` possible outcomes
    * @dev This function can only be called by the CRVoting owner
    * @param _votingId ID of the new voting to be created
    * @param _possibleOutcomes Number of possible outcomes for the new voting to be created
    */
    function create(uint256 _votingId, uint8 _possibleOutcomes) external onlyOwner {
        require(_possibleOutcomes >= MIN_POSSIBLE_OUTCOMES && _possibleOutcomes <= MAX_POSSIBLE_OUTCOMES, ERROR_INVALID_OUTCOMES_AMOUNT);

        Voting storage voting = votingRecords[_votingId];
        require(!_existsVoting(voting), ERROR_VOTING_ALREADY_EXISTS);

        // Note that there is no need to use SafeMath here, we already checked the number of outcomes above
        voting.maxAllowedOutcome = OUTCOME_REFUSED + _possibleOutcomes;
        emit VotingCreated(_votingId, _possibleOutcomes);
    }

    /**
    * @notice Commit a vote for voting #`_votingId`
    * @param _votingId ID of the voting to commit a vote to
    * @param _commitment Encrypted outcome to be stored for future reveal
    */
    function commit(uint256 _votingId, bytes32 _commitment) external votingExists(_votingId) {
        _ensureVoterWeightToCommit(_votingId, msg.sender);

        Vote storage vote = votingRecords[_votingId].votes[msg.sender];
        require(vote.commitment == bytes32(0), ERROR_VOTE_ALREADY_COMMITTED);

        vote.commitment = _commitment;
        emit VoteCommitted(_votingId, msg.sender, _commitment);
    }

    /**
    * @notice Leak `_outcome` vote of `_voter` for voting #`_votingId`
    * @param _votingId ID of the voting to leak a vote of
    * @param _voter Address of the voter to leak a vote of
    * @param _outcome Outcome leaked for the voter
    * @param _salt Salt to decrypt and validate the committed vote of the voter
    */
    function leak(uint256 _votingId, address _voter, uint8 _outcome, bytes32 _salt) external votingExists(_votingId) {
        _ensureVoterWeightToCommit(_votingId, _voter);

        Vote storage vote = votingRecords[_votingId].votes[_voter];
        _ensureCanReveal(vote, _outcome, _salt);

        // There is no need to check if an outcome is valid if it was leaked.
        // Additionally, leaked votes are not considered for the tally.
        vote.outcome = OUTCOME_LEAKED;
        emit VoteLeaked(_votingId, _voter, _outcome, msg.sender);
    }

    /**
    * @notice Reveal `_outcome` vote of `_voter` for voting #`_votingId`
    * @param _votingId ID of the voting to reveal a vote of
    * @param _outcome Outcome revealed by the voter
    * @param _salt Salt to decrypt and validate the committed vote of the voter
    */
    function reveal(uint256 _votingId, uint8 _outcome, bytes32 _salt) external votingExists(_votingId) {
        uint256 weight = _ensureVoterWeightToReveal(_votingId, msg.sender);

        Voting storage voting = votingRecords[_votingId];
        Vote storage vote = voting.votes[msg.sender];
        _ensureCanReveal(vote, _outcome, _salt);
        require(_isValidOutcome(voting, _outcome), ERROR_INVALID_OUTCOME);

        vote.outcome = _outcome;
        _updateTally(voting, _outcome, weight);
        emit VoteRevealed(_votingId, msg.sender, _outcome);
    }

    /**
    * @dev Get the address of the CRVoting owner
    * @return Address of the CRVoting owner
    */
    function getOwner() external view returns (address) {
        return address(owner);
    }

    /**
    * @dev Get the maximum allowed outcome for a given voting
    * @param _votingId ID of the voting querying the max allowed outcome of
    * @return Max allowed outcome for the given voting
    */
    function getMaxAllowedOutcome(uint256 _votingId) external votingExists(_votingId) view returns (uint8) {
        Voting storage voting = votingRecords[_votingId];
        return voting.maxAllowedOutcome;
    }

    /**
    * @dev Get the winning outcome of a voting
    * @param _votingId ID of the voting querying the winning outcome of
    * @return Winning outcome of the given voting
    */
    function getWinningOutcome(uint256 _votingId) external votingExists(_votingId) view returns (uint8) {
        Voting storage voting = votingRecords[_votingId];
        return voting.winningOutcome;
    }

    /**
    * @dev Get the tally of the winning outcome for a certain voting
    * @param _votingId ID of the voting querying the tally of
    * @return Tally of the winning outcome being queried for the given voting
    */
    function getWinningOutcomeTally(uint256 _votingId) external votingExists(_votingId) view returns (uint256) {
        Voting storage voting = votingRecords[_votingId];
        return voting.outcomesTally[voting.winningOutcome];
    }

    /**
    * @dev Get the tally of an outcome for a certain voting
    * @param _votingId ID of the voting querying the tally of
    * @param _outcome Outcome querying the tally of
    * @return Tally of the outcome being queried for the given voting
    */
    function getOutcomeTally(uint256 _votingId, uint8 _outcome) external votingExists(_votingId) view returns (uint256) {
        Voting storage voting = votingRecords[_votingId];
        return voting.outcomesTally[_outcome];
    }

    /**
    * @dev Tell whether an outcome is valid for a given voting or not. Missing and leaked outcomes are not considered
    *      valid. The only outcomes considered valid are refused ones or any of the custom outcomes of the given voting.
    * @param _votingId ID of the voting to check the outcome of
    * @param _outcome Outcome to check if valid or not
    * @return True if the given outcome is valid for the requested voting, false otherwise.
    */
    function isValidOutcome(uint256 _votingId, uint8 _outcome) external votingExists(_votingId) view returns (bool) {
        Voting storage voting = votingRecords[_votingId];
        return _isValidOutcome(voting, _outcome);
    }

    /**
    * @dev Get the outcome voted by a voter for a certain voting
    * @param _votingId ID of the voting querying the outcome of
    * @param _voter Address of the voter querying the outcome of
    * @return Outcome of the voter for the given voting
    */
    function getVoterOutcome(uint256 _votingId, address _voter) external votingExists(_votingId) view returns (uint8) {
        Voting storage voting = votingRecords[_votingId];
        return voting.votes[_voter].outcome;
    }

    /**
    * @dev Tell whether a voter voted in favor of a certain outcome in a voting or not. If there was no winning
    *      outcome, it means that no one voted in favor of any of the possible outcomes.
    * @param _votingId ID of the voting to query if a voter voted in favor of a certain outcome
    * @param _outcome Outcome to query if the given voter voted in favor of
    * @param _voter Address of the voter to query if voted in favor of the given outcome
    * @return True if the given voter voted in favor of the given outcome, false otherwise
    */
    function hasVotedInFavorOf(uint256 _votingId, uint8 _outcome, address _voter) external votingExists(_votingId) view returns (bool) {
        Voting storage voting = votingRecords[_votingId];
        uint8 winningOutcome = voting.winningOutcome;
        return winningOutcome != OUTCOME_MISSING && voting.votes[_voter].outcome == _outcome;
    }

    /**
    * @dev Filter a list of voters based on whether they voted in favor of a certain outcome in a voting or not. Note
    *      that if there was no winning outcome, it means that no one voted, then all voters will be considered voting
    *      against any of the given outcomes.
    * @param _votingId ID of the voting to be checked
    * @param _outcome Outcome to filter the list of voters of
    * @param _voters List of addresses of the voters to be filtered
    * @return List of results to tell whether a voter voted in favor of the given outcome or not
    */
    function getVotersInFavorOf(uint256 _votingId, uint8 _outcome, address[] _voters) external votingExists(_votingId) view returns (bool[]) {
        Voting storage voting = votingRecords[_votingId];
        uint8 winningOutcome = voting.winningOutcome;
        bool[] memory votersInFavor = new bool[](_voters.length);

        // If there is no winning outcome (if no valid votes were tallied), no one will be marked as voting in favor of any given outcome.
        if (winningOutcome == OUTCOME_MISSING) {
            return votersInFavor;
        }

        // If there was a winning outcome, filter those voters that voted in favor of the given outcome.
        for (uint256 i = 0; i < _voters.length; i++) {
            votersInFavor[i] = _outcome == voting.votes[_voters[i]].outcome;
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
    * @dev Internal function to fetch and ensure the weight of voter willing to commit a vote for a certain voting
    * @param _votingId ID of the voting to check the voter's weight of
    * @param _voter Address of the voter willing to commit a vote
    * @return Weight of the voter willing to commit a vote
    */
    function _ensureVoterWeightToCommit(uint256 _votingId, address _voter) internal returns (uint256) {
        uint256 weight = owner.getVoterWeightToCommit(_votingId, _voter);
        require(weight > uint256(0), ERROR_COMMIT_DENIED_BY_OWNER);
        return weight;
    }

    /**
    * @dev Internal function to fetch and ensure the weight of voter willing to reveal a vote for a certain voting
    * @param _votingId ID of the voting to check the voter's weight of
    * @param _voter Address of the voter willing to reveal a vote
    * @return Weight of the voter willing to reveal a vote
    */
    function _ensureVoterWeightToReveal(uint256 _votingId, address _voter) internal returns (uint256) {
        uint256 weight = owner.getVoterWeightToReveal(_votingId, _voter);
        require(weight > uint256(0), ERROR_REVEAL_DENIED_BY_OWNER);
        return weight;
    }

    /**
    * @dev Internal function to check if a vote can be revealed for the given outcome and salt
    * @param _vote Vote to be revealed
    * @param _outcome Outcome of the vote to be proved
    * @param _salt Salt to decrypt and validate the provided outcome for a vote
    */
    function _ensureCanReveal(Vote storage _vote, uint8 _outcome, bytes32 _salt) internal view {
        require(_vote.outcome == OUTCOME_MISSING, ERROR_VOTE_ALREADY_REVEALED);
        require(_vote.commitment == encryptVote(_outcome, _salt), ERROR_INVALID_COMMITMENT_SALT);
    }

    /**
    * @dev Internal function to tell whether a certain outcome is valid for a given voting or not. Note that
    *      the missing and leaked outcomes are not considered valid. The only outcomes considered valid are
    *      refused or any of the possible outcomes of the given voting. This function assumes the given voting exists.
    * @param _voting Pointer to the voting to check the outcome of
    * @param _outcome Outcome to check if valid or not
    * @return True if the given outcome is valid for the requested voting, false otherwise.
    */
    function _isValidOutcome(Voting storage _voting, uint8 _outcome) internal view returns (bool) {
        return _outcome >= OUTCOME_REFUSED && _outcome <= _voting.maxAllowedOutcome;
    }

    /**
    * @dev Internal function to check if a voting was already created
    * @param _voting Voting to be checked
    * @return True if the given voting was already created, false otherwise
    */
    function _existsVoting(Voting storage _voting) internal view returns (bool) {
        return _voting.maxAllowedOutcome != OUTCOME_MISSING;
    }

    /**
    * @dev Private function to update the tally of a given voting based on a new weight in favor of an outcome.
    *      This function assumes the voting pointer exists.
    * @param _voting Pointer to the voting to update the tally of
    * @param _outcome Outcome of the voting to update the tally of
    * @param _weight Weight to be added to the given outcome of the voting
    */
    function _updateTally(Voting storage _voting, uint8 _outcome, uint256 _weight) private {
        // Check if the given outcome is valid. Missing and leaked votes are ignored for the tally.
        if (!_isValidOutcome(_voting, _outcome)) {
            return;
        }

        uint256 newOutcomeTally = _voting.outcomesTally[_outcome].add(_weight);
        _voting.outcomesTally[_outcome] = newOutcomeTally;

        // Update the winning outcome only if its support was passed or if the given outcome represents a lowest
        // option than the winning outcome in case of a tie
        uint8 winningOutcome = _voting.winningOutcome;
        uint256 winningOutcomeTally = _voting.outcomesTally[winningOutcome];
        if (newOutcomeTally > winningOutcomeTally || (newOutcomeTally == winningOutcomeTally && _outcome < winningOutcome)) {
            _voting.winningOutcome = _outcome;
        }
    }
}
