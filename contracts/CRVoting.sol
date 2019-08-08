pragma solidity ^0.4.24; // TODO: pin solc

import "@aragon/os/contracts/lib/math/SafeMath.sol";
import "@aragon/os/contracts/common/Initializable.sol";

import "./standards/voting/ICRVoting.sol";
import "./standards/voting/ICRVotingOwner.sol";


contract CRVoting is Initializable, ICRVoting {
    using SafeMath for uint256;

    string internal constant ERROR_NOT_OWNER = "CRV_NOT_OWNER";
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

    uint8 internal constant MIN_OUTCOMES_ALTERNATIVES = uint8(2);

    struct Vote {
        bytes32 commitment;     // hash of the outcome casted by the voter
        uint8 outcome;          // outcome revealed by the voter (or leaked)
        bool refused;           // whether the juror refused to vote or not
        bool leaked;            // whether the outcome casted was leaked or not
    }

    struct Voting {
        uint8 winningOutcome;                       // outcome winner of a voting
        uint8 possibleOutcomes;                     // number of possible outcomes that can be voted
        mapping (address => Vote) votes;            // mapping of voters addresses to their casted votes
        mapping (uint8 => uint256) outcomesTally;   // tally for each of the possible outcomes
    }

    // CRVoting owner address
    ICRVotingOwner private owner;

    // Voting records indexed by their ID
    mapping (uint256 => Voting) internal votingRecords;

    event VoteCommitted(uint256 indexed votingId, address indexed voter, bytes32 commitment);
    event VoteRevealed(uint256 indexed votingId, address indexed voter, uint8 outcome);
    event VoteLeaked(uint256 indexed votingId, address indexed voter, address leaker);

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
        require(_possibleOutcomes >= MIN_OUTCOMES_ALTERNATIVES, ERROR_INVALID_OUTCOMES_AMOUNT);

        Voting storage voting = votingRecords[_votingId];
        require(!_existsVoting(voting), ERROR_VOTING_ALREADY_EXISTS);

        voting.possibleOutcomes = _possibleOutcomes;
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
        uint256 weight = _ensureVoterWeightToCommit(_votingId, _voter);
        _reveal(_votingId, _voter, _outcome, _salt, weight);

        // TODO: slash juror
        votingRecords[_votingId].votes[_voter].leaked = true;
        emit VoteLeaked(_votingId, _voter, msg.sender);
    }

    /**
    * @notice Reveal `_outcome` vote of `_voter` for voting #`_votingId`
    * @param _votingId ID of the voting to reveal a vote of
    * @param _outcome Outcome revealed by the voter
    * @param _salt Salt to decrypt and validate the committed vote of the voter
    */
    function reveal(uint256 _votingId, uint8 _outcome, bytes32 _salt) external votingExists(_votingId) {
        uint256 weight = _ensureVoterWeightToReveal(_votingId, msg.sender);
        _reveal(_votingId, msg.sender, _outcome, _salt, weight);
    }

    /**
    * @dev Get the address of the CRVoting owner
    * @return Address of the CRVoting owner
    */
    function getOwner() external view returns (address) {
        return address(owner);
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
    * @dev Get the list of outcomes voted by a set of voters for a certain voting
    * @param _votingId ID of the voting querying the outcome of
    * @param _voters List of addresses of the voters querying the outcomes of
    * @return Outcomes of the requested voters for the given voting
    */
    function getVotersOutcome(uint256 _votingId, address[] _voters) external votingExists(_votingId) view returns (uint8[]) {
        Voting storage voting = votingRecords[_votingId];
        uint8[] memory votersOutcomes = new uint8[](_voters.length);
        for (uint256 i = 0; i < _voters.length; i++) {
            votersOutcomes[i] = voting.votes[_voters[i]].outcome;
        }
        return votersOutcomes;
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
    * @dev Tell whether an outcome is valid for a given voting or not
    * @param _votingId ID of the voting to check the outcome of
    * @param _outcome Outcome to check if valid or not
    * @return True if the given outcome is valid for the requested voting, false otherwise.
    */
    function isValidOutcome(uint256 _votingId, uint8 _outcome) external votingExists(_votingId) view returns (bool) {
        return _isValidOutcome(_votingId, _outcome);
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
    * @dev Internal function to reveal the vote of a voter for a certain voting. This function assumes the given
    *      voting exists and that the given outcome is valid.
    * @param _votingId ID of the voting to reveal a vote for
    * @param _voter Address of the voter willing to reveal a vote
    * @param _outcome Outcome being revealed by the voter
    * @param _salt Salt to decrypt and validate the committed vote of the voter
    * @param _weight Weight of the voter to be added to voting tally in favor of the given outcome
    */
    function _reveal(uint256 _votingId, address _voter, uint8 _outcome, bytes32 _salt, uint256 _weight) internal {
        require(_isValidOutcome(_votingId, _outcome), ERROR_INVALID_OUTCOME);

        Voting storage voting = votingRecords[_votingId];
        Vote storage vote = voting.votes[_voter];

        require(vote.outcome == uint8(0), ERROR_VOTE_ALREADY_REVEALED);
        require(vote.commitment == encryptVote(_outcome, _salt), ERROR_INVALID_COMMITMENT_SALT);

        vote.outcome = _outcome;
        _updateTally(voting, _outcome, _weight);
        emit VoteRevealed(_votingId, _voter, _outcome);
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
    * @dev Internal function to tell whether a certain outcome is valid for a given voting or not. Note that
    *      the outcome zero is not considered valid, it is used to denote absence. This function assumes
    *      the given voting exists.
    * @param _votingId ID of the voting to check the outcome of
    * @param _outcome Outcome to check if valid or not
    * @return True if the given outcome is valid for the requested voting, false otherwise.
    */
    function _isValidOutcome(uint256 _votingId, uint8 _outcome) internal view returns (bool) {
        Voting storage voting = votingRecords[_votingId];
        return _outcome > uint256(0) && _outcome <= voting.possibleOutcomes;
    }

    /**
    * @dev Internal function to check if a voting was already created
    * @param _voting Voting to be checked
    * @return True if the given voting was already created, false otherwise
    */
    function _existsVoting(Voting storage _voting) internal view returns (bool) {
        return _voting.possibleOutcomes != uint8(0);
    }

    /**
    * @dev Private function to update the tally of a given voting based on a new weight in favor of an outcome.
    *      This function assumes the voting pointer exists and that the given outcome is valid.
    * @param _voting Pointer to the voting to update the tally of
    * @param _outcome Outcome of the voting to update the tally of
    * @param _weight Weight to be added to the given outcome of the voting
    */
    function _updateTally(Voting storage _voting, uint8 _outcome, uint256 _weight) private {
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
