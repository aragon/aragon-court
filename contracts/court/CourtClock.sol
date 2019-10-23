pragma solidity ^0.5.8;

import "@aragon/os/contracts/common/TimeHelpers.sol";

import "./IClock.sol";
import "./ClockConstants.sol";
import "../controller/Controller.sol";
import "../controller/Controlled.sol";


contract CourtClock is IClock, ClockConstants, TimeHelpers {
    string private constant ERROR_TERM_OUTDATED = "CLK_TERM_OUTDATED";
    string private constant ERROR_TERM_DOES_NOT_EXIST = "CLK_TERM_DOES_NOT_EXIST";
    string private constant ERROR_TERM_DURATION_TOO_LONG = "CLK_TERM_DURATION_TOO_LONG";
    string private constant ERROR_TERM_RANDOMNESS_NOT_YET = "CLK_TERM_RANDOMNESS_NOT_YET";
    string private constant ERROR_TERM_RANDOMNESS_UNAVAILABLE = "CLK_TERM_RANDOMNESS_UNAVAILABLE";
    string private constant ERROR_BAD_FIRST_TERM_START_TIME = "CLK_BAD_FIRST_TERM_START_TIME";
    string private constant ERROR_TOO_MANY_TRANSITIONS = "CLK_TOO_MANY_TRANSITIONS";
    string private constant ERROR_INVALID_TRANSITION_TERMS = "CLK_INVALID_TRANSITION_TERMS";

    // Maximum number of term transitions a callee may have to assume in order to call certain functions that require the Court being up-to-date
    uint64 internal constant MAX_AUTO_TERM_TRANSITIONS_ALLOWED = 1;

    // Max duration in seconds that a term can last
    uint64 internal constant MAX_TERM_DURATION = 365 days;

    // Max time until first term starts since contract is deployed
    uint64 internal constant MAX_FIRST_TERM_DELAY_PERIOD = 2 * MAX_TERM_DURATION;

    struct Term {
        uint64 startTime;              // Timestamp when the term started
        uint64 randomnessBN;           // Block number for entropy
        bytes32 randomness;            // Entropy from randomnessBN block hash
    }

    // Duration in seconds for each term of the Court
    uint64 public termDuration;

    // Last ensured term id
    uint64 internal termId;

    // List of Court terms indexed by id
    mapping (uint64 => Term) internal terms;

    event NewTerm(uint64 termId);

    /**
    * @dev Ensure a certain term has already been processed
    * @param _termId Identification number of the term to be checked
    */
    modifier termExists(uint64 _termId) {
        require(_termId <= termId, ERROR_TERM_DOES_NOT_EXIST);
        _;
    }

    /**
    * @dev Constructor function
    * @param _termDuration Duration in seconds per term
    * @param _firstTermStartTime Timestamp in seconds when the court will open (to give time for juror on-boarding)
    */
    constructor(uint64 _termDuration, uint64 _firstTermStartTime) public {
        require(_termDuration < MAX_TERM_DURATION, ERROR_TERM_DURATION_TOO_LONG);
        require(_firstTermStartTime >= getTimestamp64() + _termDuration, ERROR_BAD_FIRST_TERM_START_TIME);
        require(_firstTermStartTime <= getTimestamp64() + MAX_FIRST_TERM_DELAY_PERIOD, ERROR_BAD_FIRST_TERM_START_TIME);

        termDuration = _termDuration;

        // No need for SafeMath: checked above
        terms[ZERO_TERM_ID].startTime = _firstTermStartTime - _termDuration;
    }

    /**
    * @notice Send a heartbeat to transition up to `_maxRequestedTransitions` terms
    * @param _maxRequestedTransitions Max number of term transitions allowed by the sender
    * @return previousTermId Identification number of the term id previous to executing the heartbeat transitions
    * @return currentTermId Identification number of the term id after executing the heartbeat transitions
    */
    function heartbeat(uint64 _maxRequestedTransitions) external returns (uint64 previousTermId, uint64 currentTermId) {
        return _heartbeat(_maxRequestedTransitions);
    }

    /**
    * @notice Ensure the current term of the court. If the Court term is outdated it will update it. Note that this function only
    *         allows updating the Court by one term, if more terms are required, users will have to call the heartbeat function manually.
    * @return Identification number of the current term
    */
    function ensureCurrentTerm() external returns (uint64) {
        return _ensureCurrentTerm();
    }

    /**
    * @dev Ensure that a certain term has its randomness set. As we allow to draft disputes requested for previous terms, if there
    *      were mined more than 256 blocks for the current term, the blockhash of its randomness BN is no longer available, given
    *      round will be able to be drafted in the following term.
    * @param _termId Identification number of the term to be ensured
    */
    function ensureTermRandomness(uint64 _termId) external termExists(_termId) returns (bytes32) {
        // If the randomness for the given term was already computed, return
        Term storage term = terms[_termId];
        bytes32 termRandomness = term.randomness;
        if (termRandomness != bytes32(0)) {
            return termRandomness;
        }

        // Compute term randomness
        bytes32 newRandomness = _computeTermRandomness(term);
        require(newRandomness != bytes32(0), ERROR_TERM_RANDOMNESS_UNAVAILABLE);
        term.randomness = newRandomness;
        return newRandomness;
    }

    /**
    * @dev Tell the last ensured term identification number
    * @return Identification number of the last ensured term
    */
    function getLastEnsuredTermId() external view returns (uint64) {
        return termId;
    }

    /**
    * @dev Tell the current term identification number. Note that there may be pending term transitions.
    * @return Identification number of the current term
    */
    function getCurrentTermId() external view returns (uint64) {
        return _currentTermId();
    }

    /**
    * @dev Tell the number of terms the Court should transition to be up-to-date
    * @return Number of terms the Court should transition to be up-to-date
    */
    function getNeededTermTransitions() external view returns (uint64) {
        return _neededTermTransitions();
    }

    /**
    * @dev Tell the information related to a term based on its ID. Note that if the term has not been reached, the
    *      information returned won't be computed yet. This function allows querying future terms that were not computed yet.
    * @param _termId ID of the term being queried
    * @return Term start time
    * @return Number of drafts depending on the requested term
    * @return ID of the court configuration associated to the requested term
    * @return Block number used for randomness in the requested term
    * @return Randomness computed for the requested term
    */
    function getTerm(uint64 _termId) external view returns (uint64 startTime, uint64 randomnessBN, bytes32 randomness) {
        Term storage term = terms[_termId];
        return (term.startTime, term.randomnessBN, term.randomness);
    }

    /**
    * @dev Tell the randomness of a term even if it wasn't computed yet
    * @param _termId ID of the term being queried
    * @return Randomness of the requested term
    */
    function getTermRandomness(uint64 _termId) external view termExists(_termId) returns (bytes32) {
        Term storage term = terms[_termId];
        return _computeTermRandomness(term);
    }

    /**
    * @dev Internal function to compute a heartbeat
    * @param _maxRequestedTransitions Max number of term transitions allowed by the sender
    * @return Identification number of the term id previous to executing the heartbeat transitions
    * @return Identification number of the term id after executing the heartbeat transitions
    */
    function _heartbeat(uint64 _maxRequestedTransitions) internal returns (uint64, uint64) {
        // Transition the minimum number of terms between the amount requested and the amount actually needed
        uint64 neededTransitions = _neededTermTransitions();
        uint256 transitions = uint256(_maxRequestedTransitions < neededTransitions ? _maxRequestedTransitions : neededTransitions);
        require(transitions > 0, ERROR_INVALID_TRANSITION_TERMS);

        uint64 previousTermId = termId;
        uint64 currentTermId;
        for (uint256 transition = 1; transition <= transitions; transition++) {
            // Term IDs are incremented by one based on the number of time periods since the Court started. Since time is represented in uint64,
            // even if we chose the minimum duration possible for a term (1 second), we can ensure terms will never reach 2^64 since time is
            // already assumed to fit in uint64.
            Term storage previousTerm = terms[termId++];
            currentTermId = termId;
            Term storage currentTerm = terms[currentTermId];

            // Set the start time of the new term. Note that we are using a constant term duration value to guarantee
            // equally long terms, regardless of heartbeats.
            // No need for SafeMath: termDuration is capped at MAX_TERM_DURATION, _firstTermStartTime by MAX_FIRST_TERM_DELAY_PERIOD,
            // and we assume that timestamps (and its derivatives like termId) won't reach MAX_UINT64, which would be ~5.8e11 years
            currentTerm.startTime = previousTerm.startTime + termDuration;

            // In order to draft a random number of jurors in a term, we use a randomness factor for each term based on a
            // block number that is set once the term has started. Note that this information could not be known beforehand.
            currentTerm.randomnessBN = getBlockNumber64() + 1;
            emit NewTerm(currentTermId);
        }

        return (previousTermId, currentTermId);
    }

    /**
    * @dev Internal function to tell and ensure the current term of the court
    * @return Identification number of the last ensured term
    */
    function _ensureCurrentTerm() internal returns (uint64) {
        // Check the required number of transitions does not exceeds the max allowed number to be processed automatically
        uint64 requiredTransitions = _neededTermTransitions();
        require(requiredTransitions <= MAX_AUTO_TERM_TRANSITIONS_ALLOWED, ERROR_TOO_MANY_TRANSITIONS);

        // If there are no transitions pending, return the last ensured term id
        if (uint256(requiredTransitions) == 0) {
            return termId;
        }

        // Process transition if there is at least one pending
        (, uint64 currentTermId) = _heartbeat(requiredTransitions);
        return currentTermId;
    }

    /**
    * @dev Internal function to tell the current term identification number. Note that there may be pending term transitions.
    * @return Identification number of the current term
    */
    function _currentTermId() internal view returns (uint64) {
        // No need for SafeMath: Court terms are assumed to always fit in uint64.
        return termId + _neededTermTransitions();
    }

    /**
    * @dev Internal function to tell the number of terms the Court should transition to be up-to-date
    * @return Number of terms the Court should transition to be up-to-date
    */
    function _neededTermTransitions() internal view returns (uint64) {
        // Note that the Court is always initialized providing a start time for the first-term in the future. If that's the case,
        // no term transitions are required.
        uint64 currentTermStartTime = terms[termId].startTime;
        if (getTimestamp64() < currentTermStartTime) {
            return uint64(0);
        }

        // No need for SafeMath: we already know that the start time of the current term is in the past
        return (getTimestamp64() - currentTermStartTime) / termDuration;
    }

    /**
    * @dev Internal function to compute the randomness that will be used to draft jurors for the given term. This
    *      function assumes the given term exists. To determine the randomness factor for a term we use the hash of a
    *      block number that is set once the term has started to ensure it cannot be known beforehand. Note that the
    *      hash function being used only works for the 256 most recent block numbers.
    * @param _term Term to compute the randomness of
    * @return Randomness computed for the given term
    */
    function _computeTermRandomness(Term storage _term) internal view returns (bytes32) {
        require(getBlockNumber64() > _term.randomnessBN, ERROR_TERM_RANDOMNESS_NOT_YET);
        return blockhash(_term.randomnessBN);
    }
}
