pragma solidity ^0.5.8;

import "../lib/os/ERC20.sol";
import "../lib/os/SafeERC20.sol";
import "../lib/os/SafeMath.sol";
import "../lib/os/SafeMath64.sol";
import "../lib/os/Uint256Helpers.sol";

import "./IDisputeManager.sol";
import "../lib/PctHelpers.sol";
import "../voting/ICRVoting.sol";
import "../voting/ICRVotingOwner.sol";
import "../treasury/ITreasury.sol";
import "../arbitration/IArbitrable.sol";
import "../registry/IJurorsRegistry.sol";
import "../subscriptions/ISubscriptions.sol";
import "../court/controller/ControlledRecoverable.sol";


contract DisputeManager is ControlledRecoverable, ICRVotingOwner, IDisputeManager {
    using SafeERC20 for ERC20;
    using SafeMath for uint256;
    using SafeMath64 for uint64;
    using PctHelpers for uint256;
    using Uint256Helpers for uint256;

    // Voting-related error messages
    string private constant ERROR_VOTER_WEIGHT_ZERO = "DM_VOTER_WEIGHT_ZERO";
    string private constant ERROR_SENDER_NOT_VOTING = "DM_SENDER_NOT_VOTING";

    // Disputes-related error messages
    string private constant ERROR_SENDER_NOT_DISPUTE_SUBJECT = "DM_SENDER_NOT_DISPUTE_SUBJECT";
    string private constant ERROR_CANNOT_CLOSE_EVIDENCE_PERIOD = "DM_CANNOT_CLOSE_EVIDENCE_PERIOD";
    string private constant ERROR_EVIDENCE_PERIOD_IS_CLOSED = "DM_EVIDENCE_PERIOD_IS_CLOSED";
    string private constant ERROR_TERM_OUTDATED = "DM_TERM_OUTDATED";
    string private constant ERROR_DISPUTE_DOES_NOT_EXIST = "DM_DISPUTE_DOES_NOT_EXIST";
    string private constant ERROR_INVALID_RULING_OPTIONS = "DM_INVALID_RULING_OPTIONS";
    string private constant ERROR_SUBSCRIPTION_NOT_PAID = "DM_SUBSCRIPTION_NOT_PAID";
    string private constant ERROR_DEPOSIT_FAILED = "DM_DEPOSIT_FAILED";
    string private constant ERROR_BAD_MAX_DRAFT_BATCH_SIZE = "DM_BAD_MAX_DRAFT_BATCH_SIZE";

    // Rounds-related error messages
    string private constant ERROR_ROUND_IS_FINAL = "DM_ROUND_IS_FINAL";
    string private constant ERROR_ROUND_DOES_NOT_EXIST = "DM_ROUND_DOES_NOT_EXIST";
    string private constant ERROR_INVALID_ADJUDICATION_STATE = "DM_INVALID_ADJUDICATION_STATE";
    string private constant ERROR_ROUND_ALREADY_DRAFTED = "DM_ROUND_ALREADY_DRAFTED";
    string private constant ERROR_DRAFT_TERM_NOT_REACHED = "DM_DRAFT_TERM_NOT_REACHED";
    string private constant ERROR_ROUND_NOT_APPEALED = "DM_ROUND_NOT_APPEALED";
    string private constant ERROR_INVALID_APPEAL_RULING = "DM_INVALID_APPEAL_RULING";

    // Settlements-related error messages
    string private constant ERROR_PREV_ROUND_NOT_SETTLED = "DM_PREVIOUS_ROUND_NOT_SETTLED";
    string private constant ERROR_ROUND_ALREADY_SETTLED = "DM_ROUND_ALREADY_SETTLED";
    string private constant ERROR_ROUND_NOT_SETTLED = "DM_ROUND_PENALTIES_NOT_SETTLED";
    string private constant ERROR_JUROR_ALREADY_REWARDED = "DM_JUROR_ALREADY_REWARDED";
    string private constant ERROR_WONT_REWARD_NON_VOTER_JUROR = "DM_WONT_REWARD_NON_VOTER_JUROR";
    string private constant ERROR_WONT_REWARD_INCOHERENT_JUROR = "DM_WONT_REWARD_INCOHERENT_JUROR";
    string private constant ERROR_ROUND_APPEAL_ALREADY_SETTLED = "DM_APPEAL_ALREADY_SETTLED";

    // Minimum possible rulings for a dispute
    uint8 internal constant MIN_RULING_OPTIONS = 2;

    // Maximum possible rulings for a dispute, equal to minimum limit
    uint8 internal constant MAX_RULING_OPTIONS = MIN_RULING_OPTIONS;

    // Precision factor used to improve rounding when computing weights for the final round
    uint256 internal constant FINAL_ROUND_WEIGHT_PRECISION = 1000;

    // Mask used to decode vote IDs
    uint256 internal constant VOTE_ID_MASK = 0x00000000000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF;

    struct Dispute {
        IArbitrable subject;           // Arbitrable associated to a dispute
        uint64 createTermId;           // Term ID when the dispute was created
        uint8 possibleRulings;         // Number of possible rulings jurors can vote for each dispute
        uint8 finalRuling;             // Winning ruling of a dispute
        DisputeState state;            // State of a dispute: pre-draft, adjudicating, or ruled
        AdjudicationRound[] rounds;    // List of rounds for each dispute
    }

    struct AdjudicationRound {
        uint64 draftTermId;            // Term from which the jurors of a round can be drafted
        uint64 jurorsNumber;           // Number of jurors drafted for a round
        bool settledPenalties;         // Whether or not penalties have been settled for a round
        uint256 jurorFees;             // Total amount of fees to be distributed between the winning jurors of a round
        address[] jurors;              // List of jurors drafted for a round
        mapping (address => JurorState) jurorsStates; // List of states for each drafted juror indexed by address
        uint64 delayedTerms;           // Number of terms a round was delayed based on its requested draft term id
        uint64 selectedJurors;         // Number of jurors selected for a round, to allow drafts to be batched
        uint64 coherentJurors;         // Number of drafted jurors that voted in favor of the dispute final ruling
        uint64 settledJurors;          // Number of jurors whose rewards were already settled
        uint256 collectedTokens;       // Total amount of tokens collected from losing jurors
        Appeal appeal;                 // Appeal-related information of a round
    }

    struct JurorState {
        uint64 weight;                 // Weight computed for a juror on a round
        bool rewarded;                 // Whether or not a drafted juror was rewarded
    }

    struct Appeal {
        address maker;                 // Address of the appealer
        uint8 appealedRuling;          // Ruling appealing in favor of
        address taker;                 // Address of the one confirming an appeal
        uint8 opposedRuling;           // Ruling opposed to an appeal
        bool settled;                  // Whether or not an appeal has been settled
    }

    struct DraftParams {
        uint256 disputeId;            // Identification number of the dispute to be drafted
        uint256 roundId;              // Identification number of the round to be drafted
        uint64 termId;                // Identification number of the current term of the Court
        bytes32 draftTermRandomness;  // Randomness of the term in which the dispute was requested to be drafted
        DraftConfig config;           // Draft config of the Court at the draft term
    }

    struct NextRoundDetails {
        uint64 startTerm;              // Term ID from which the next round will start
        uint64 jurorsNumber;           // Jurors number for the next round
        DisputeState newDisputeState;  // New state for the dispute associated to the given round after the appeal
        ERC20 feeToken;                // ERC20 token used for the next round fees
        uint256 totalFees;             // Total amount of fees to be distributed between the winning jurors of the next round
        uint256 jurorFees;             // Total amount of fees for a regular round at the given term
        uint256 appealDeposit;         // Amount to be deposit of fees for a regular round at the given term
        uint256 confirmAppealDeposit;  // Total amount of fees for a regular round at the given term
    }

    // Max jurors to be drafted in each batch. To prevent running out of gas. We allow to change it because max gas per tx can vary
    // As a reference, drafting 100 jurors from a small tree of 4 would cost ~2.4M. Drafting 500, ~7.75M.
    uint64 public maxJurorsPerDraftBatch;

    // List of all the disputes created in the Court
    Dispute[] internal disputes;

    event DisputeStateChanged(uint256 indexed disputeId, DisputeState indexed state);
    event EvidencePeriodClosed(uint256 indexed disputeId, uint64 indexed termId);
    event NewDispute(uint256 indexed disputeId, IArbitrable indexed subject, uint64 indexed draftTermId, uint64 jurorsNumber, bytes metadata);
    event JurorDrafted(uint256 indexed disputeId, uint256 indexed roundId, address indexed juror);
    event RulingAppealed(uint256 indexed disputeId, uint256 indexed roundId, uint8 ruling);
    event RulingAppealConfirmed(uint256 indexed disputeId, uint256 indexed roundId, uint64 indexed draftTermId, uint256 jurorsNumber);
    event RulingComputed(uint256 indexed disputeId, uint8 indexed ruling);
    event PenaltiesSettled(uint256 indexed disputeId, uint256 indexed roundId, uint256 collectedTokens);
    event RewardSettled(uint256 indexed disputeId, uint256 indexed roundId, address juror, uint256 collectedTokens, uint256 jurorFees);
    event AppealDepositSettled(uint256 indexed disputeId, uint256 indexed roundId);
    event MaxJurorsPerDraftBatchChanged(uint64 previousMaxJurorsPerDraftBatch, uint64 currentMaxJurorsPerDraftBatch);

    /**
    * @dev Ensure the msg.sender is the CR Voting module
    */
    modifier onlyVoting() {
        ICRVoting voting = _voting();
        require(msg.sender == address(voting), ERROR_SENDER_NOT_VOTING);
        _;
    }

    /**
    * @dev Ensure a dispute exists
    * @param _disputeId Identification number of the dispute to be ensured
    */
    modifier disputeExists(uint256 _disputeId) {
        _checkDisputeExists(_disputeId);
        _;
    }

    /**
    * @dev Ensure a dispute round exists
    * @param _disputeId Identification number of the dispute to be ensured
    * @param _roundId Identification number of the dispute round to be ensured
    */
    modifier roundExists(uint256 _disputeId, uint256 _roundId) {
        _checkRoundExists(_disputeId, _roundId);
        _;
    }

    /**
    * @dev Constructor function
    * @param _controller Address of the controller
    * @param _maxJurorsPerDraftBatch Max number of jurors to be drafted per batch
    */
    constructor(Controller _controller, uint64 _maxJurorsPerDraftBatch) ControlledRecoverable(_controller) public {
        // No need to explicitly call `Controlled` constructor since `ControlledRecoverable` is already doing it
        _setMaxJurorsPerDraftBatch(_maxJurorsPerDraftBatch);
    }

    /**
    * @notice Create a dispute over `_subject` with `_possibleRulings` possible rulings
    * @param _subject Arbitrable instance creating the dispute
    * @param _possibleRulings Number of possible rulings allowed for the drafted jurors to vote on the dispute
    * @param _metadata Optional metadata that can be used to provide additional information on the dispute to be created
    * @return Dispute identification number
    */
    function createDispute(IArbitrable _subject, uint8 _possibleRulings, bytes calldata _metadata) external onlyController returns (uint256) {
        uint64 termId = _ensureCurrentTerm();
        require(_possibleRulings >= MIN_RULING_OPTIONS && _possibleRulings <= MAX_RULING_OPTIONS, ERROR_INVALID_RULING_OPTIONS);

        // Create the dispute
        uint256 disputeId = disputes.length++;
        Dispute storage dispute = disputes[disputeId];
        dispute.subject = _subject;
        dispute.possibleRulings = _possibleRulings;
        dispute.createTermId = termId;

        Config memory config = _getConfigAt(termId);
        uint64 jurorsNumber = config.disputes.firstRoundJurorsNumber;
        uint64 draftTermId = termId.add(config.disputes.evidenceTerms);
        emit NewDispute(disputeId, _subject, draftTermId, jurorsNumber, _metadata);

        // Create first adjudication round of the dispute
        (ERC20 feeToken, uint256 jurorFees, uint256 totalFees) = _getRegularRoundFees(config.fees, jurorsNumber);
        _createRound(disputeId, DisputeState.PreDraft, draftTermId, jurorsNumber, jurorFees);

        // Pay round fees and return dispute id
        _depositAmount(address(_subject), feeToken, totalFees);
        return disputeId;
    }

    /**
    * @notice Close the evidence period of dispute #`_disputeId`
    * @param _subject IArbitrable instance requesting to close the evidence submission period
    * @param _disputeId Identification number of the dispute to close its evidence submitting period
    */
    function closeEvidencePeriod(IArbitrable _subject, uint256 _disputeId) external onlyController roundExists(_disputeId, 0) {
        Dispute storage dispute = disputes[_disputeId];
        AdjudicationRound storage round = dispute.rounds[0];
        require(dispute.subject == _subject, ERROR_SENDER_NOT_DISPUTE_SUBJECT);

        // Check current term is within the evidence submission period
        uint64 termId = _ensureCurrentTerm();
        require(dispute.createTermId < termId, ERROR_CANNOT_CLOSE_EVIDENCE_PERIOD);
        require(termId < round.draftTermId, ERROR_EVIDENCE_PERIOD_IS_CLOSED);

        // Update the draft term of the first round to the next term
        round.draftTermId = termId;
        emit EvidencePeriodClosed(_disputeId, termId);
    }

    /**
    * @notice Draft jurors for the next round of dispute #`_disputeId`
    * @param _disputeId Identification number of the dispute to be drafted
    */
    function draft(uint256 _disputeId) external disputeExists(_disputeId) {
        // Drafts can only be computed when the Court is up-to-date. Note that forcing a term transition won't work since the term randomness
        // is always based on the next term which means it won't be available anyway.
        IClock clock = _clock();
        uint64 requiredTransitions = _clock().getNeededTermTransitions();
        require(uint256(requiredTransitions) == 0, ERROR_TERM_OUTDATED);
        uint64 currentTermId = _getLastEnsuredTermId();

        // Ensure dispute has not been drafted yet
        Dispute storage dispute = disputes[_disputeId];
        require(dispute.state == DisputeState.PreDraft, ERROR_ROUND_ALREADY_DRAFTED);

        // Ensure draft term randomness can be computed for the current block number
        uint256 roundId = dispute.rounds.length - 1;
        AdjudicationRound storage round = dispute.rounds[roundId];
        uint64 draftTermId = round.draftTermId;
        require(draftTermId <= currentTermId, ERROR_DRAFT_TERM_NOT_REACHED);
        bytes32 draftTermRandomness = clock.ensureCurrentTermRandomness();

        // Draft jurors for the given dispute and reimburse fees
        DraftConfig memory config = _getDraftConfig(draftTermId);
        bool draftEnded = _draft(round, _buildDraftParams(_disputeId, roundId, currentTermId, draftTermRandomness, config));

        // If the drafting is over, update its state
        if (draftEnded) {
            // No need for SafeMath: we ensured `currentTermId` is greater than or equal to `draftTermId` above
            round.delayedTerms = currentTermId - draftTermId;
            dispute.state = DisputeState.Adjudicating;
            emit DisputeStateChanged(_disputeId, DisputeState.Adjudicating);
        }
    }

    /**
    * @notice Appeal round #`_roundId` of dispute #`_disputeId` in favor of ruling `_ruling`
    * @param _disputeId Identification number of the dispute being appealed
    * @param _roundId Identification number of the dispute round being appealed
    * @param _ruling Ruling appealing a dispute round in favor of
    */
    function createAppeal(uint256 _disputeId, uint256 _roundId, uint8 _ruling) external roundExists(_disputeId, _roundId) {
        // Ensure current term and check that the given round can be appealed.
        // Note that if there was a final appeal the adjudication state will be 'Ended'.
        Dispute storage dispute = disputes[_disputeId];
        Config memory config = _getDisputeConfig(dispute);
        _ensureAdjudicationState(dispute, _roundId, AdjudicationState.Appealing, config.disputes);

        // Ensure that the ruling being appealed in favor of is valid and different from the current winning ruling
        ICRVoting voting = _voting();
        uint256 voteId = _getVoteId(_disputeId, _roundId);
        uint8 roundWinningRuling = voting.getWinningOutcome(voteId);
        require(roundWinningRuling != _ruling && voting.isValidOutcome(voteId, _ruling), ERROR_INVALID_APPEAL_RULING);

        // Update round appeal state
        AdjudicationRound storage round = dispute.rounds[_roundId];
        Appeal storage appeal = round.appeal;
        appeal.maker = msg.sender;
        appeal.appealedRuling = _ruling;
        emit RulingAppealed(_disputeId, _roundId, _ruling);

        // Pay appeal deposit
        NextRoundDetails memory nextRound = _getNextRoundDetails(round, _roundId, config);
        _depositAmount(msg.sender, nextRound.feeToken, nextRound.appealDeposit);
    }

    /**
    * @notice Confirm appeal for round #`_roundId` of dispute #`_disputeId` in favor of ruling `_ruling`
    * @param _disputeId Identification number of the dispute confirming an appeal of
    * @param _roundId Identification number of the dispute round confirming an appeal of
    * @param _ruling Ruling being confirmed against a dispute round appeal
    */
    function confirmAppeal(uint256 _disputeId, uint256 _roundId, uint8 _ruling) external roundExists(_disputeId, _roundId) {
        // Ensure current term and check that the given round is appealed and can be confirmed.
        // Note that if there was a final appeal the adjudication state will be 'Ended'.
        Dispute storage dispute = disputes[_disputeId];
        Config memory config = _getDisputeConfig(dispute);
        _ensureAdjudicationState(dispute, _roundId, AdjudicationState.ConfirmingAppeal, config.disputes);

        // Ensure that the ruling being confirmed in favor of is valid and different from the appealed ruling
        AdjudicationRound storage round = dispute.rounds[_roundId];
        Appeal storage appeal = round.appeal;
        uint256 voteId = _getVoteId(_disputeId, _roundId);
        require(appeal.appealedRuling != _ruling && _voting().isValidOutcome(voteId, _ruling), ERROR_INVALID_APPEAL_RULING);

        // Create a new adjudication round for the dispute
        NextRoundDetails memory nextRound = _getNextRoundDetails(round, _roundId, config);
        DisputeState newDisputeState = nextRound.newDisputeState;
        uint256 newRoundId = _createRound(_disputeId, newDisputeState, nextRound.startTerm, nextRound.jurorsNumber, nextRound.jurorFees);

        // Update previous round appeal state
        appeal.taker = msg.sender;
        appeal.opposedRuling = _ruling;
        emit RulingAppealConfirmed(_disputeId, newRoundId, nextRound.startTerm, nextRound.jurorsNumber);

        // Pay appeal confirm deposit
        _depositAmount(msg.sender, nextRound.feeToken, nextRound.confirmAppealDeposit);
    }

    /**
    * @notice Compute the final ruling for dispute #`_disputeId`
    * @param _disputeId Identification number of the dispute to compute its final ruling
    * @return subject Arbitrable instance associated to the dispute
    * @return finalRuling Final ruling decided for the given dispute
    */
    function computeRuling(uint256 _disputeId) external disputeExists(_disputeId) returns (IArbitrable subject, uint8 finalRuling) {
        Dispute storage dispute = disputes[_disputeId];
        subject = dispute.subject;

        Config memory config = _getDisputeConfig(dispute);
        finalRuling = _ensureFinalRuling(dispute, _disputeId, config);

        if (dispute.state != DisputeState.Ruled) {
            dispute.state = DisputeState.Ruled;
            emit RulingComputed(_disputeId, finalRuling);
        }
    }

    /**
    * @notice Settle penalties for round #`_roundId` of dispute #`_disputeId`
    * @dev In case of a regular round, all the drafted jurors that didn't vote in favor of the final ruling of the given dispute will be slashed.
    *      In case of a final round, jurors are slashed when voting, thus it is considered these rounds settled at once. Rewards have to be
    *      manually claimed through `settleReward` which will return pre-slashed tokens for the winning jurors of a final round as well.
    * @param _disputeId Identification number of the dispute to settle penalties for
    * @param _roundId Identification number of the dispute round to settle penalties for
    * @param _jurorsToSettle Maximum number of jurors to be slashed in this call. It can be set to zero to slash all the losing jurors of the
    *        given round. This argument is only used when settling regular rounds.
    */
    function settlePenalties(uint256 _disputeId, uint256 _roundId, uint256 _jurorsToSettle) external roundExists(_disputeId, _roundId) {
        // Enforce that rounds are settled in order to avoid one round without incentive to settle. Even if there is a settle fee
        // it may not be big enough and all jurors in the round could be slashed.
        Dispute storage dispute = disputes[_disputeId];
        require(_roundId == 0 || dispute.rounds[_roundId - 1].settledPenalties, ERROR_PREV_ROUND_NOT_SETTLED);

        // Ensure given round has not been fully settled yet
        AdjudicationRound storage round = dispute.rounds[_roundId];
        require(!round.settledPenalties, ERROR_ROUND_ALREADY_SETTLED);

        // Ensure the final ruling of the given dispute is already computed
        Config memory config = _getDisputeConfig(dispute);
        uint8 finalRuling = _ensureFinalRuling(dispute, _disputeId, config);

        // Set the number of jurors that voted in favor of the final ruling if we haven't started settling yet
        uint256 voteId = _getVoteId(_disputeId, _roundId);
        if (round.settledJurors == 0) {
            // Note that we are safe to cast the tally of a ruling to uint64 since the highest value a ruling can have is equal to the jurors
            // number for regular rounds or to the total active balance of the registry for final rounds, and both are ensured to fit in uint64.
            ICRVoting voting = _voting();
            round.coherentJurors = uint64(voting.getOutcomeTally(voteId, finalRuling));
        }

        ITreasury treasury = _treasury();
        ERC20 feeToken = config.fees.token;
        if (_isRegularRound(_roundId, config)) {
            // For regular appeal rounds we compute the amount of locked tokens that needs to get burned in batches.
            // The callers of this function will get rewarded in this case.
            uint256 jurorsSettled = _settleRegularRoundPenalties(round, voteId, finalRuling, config.disputes.penaltyPct, _jurorsToSettle, config.minActiveBalance);
            treasury.assign(feeToken, msg.sender, config.fees.settleFee.mul(jurorsSettled));
        } else {
            // For the final appeal round, there is no need to settle in batches since, to guarantee scalability,
            // all the tokens are collected from jurors when they vote, and those jurors who
            // voted in favor of the winning ruling can claim their collected tokens back along with their reward.
            // Note that the caller of this function is not being reimbursed.
            round.settledPenalties = true;
        }

        if (round.settledPenalties) {
            uint256 collectedTokens = round.collectedTokens;
            emit PenaltiesSettled(_disputeId, _roundId, collectedTokens);
            _burnCollectedTokensIfNecessary(dispute, round, _roundId, treasury, feeToken, collectedTokens);
        }
    }

    /**
    * @notice Claim reward for round #`_roundId` of dispute #`_disputeId` for juror `_juror`
    * @dev For regular rounds, it will only reward winning jurors
    * @param _disputeId Identification number of the dispute to settle rewards for
    * @param _roundId Identification number of the dispute round to settle rewards for
    * @param _juror Address of the juror to settle their rewards
    */
    function settleReward(uint256 _disputeId, uint256 _roundId, address _juror) external roundExists(_disputeId, _roundId) {
        // Ensure dispute round penalties are settled first
        Dispute storage dispute = disputes[_disputeId];
        AdjudicationRound storage round = dispute.rounds[_roundId];
        require(round.settledPenalties, ERROR_ROUND_NOT_SETTLED);

        // Ensure given juror was not rewarded yet and was drafted for the given round
        JurorState storage jurorState = round.jurorsStates[_juror];
        require(!jurorState.rewarded, ERROR_JUROR_ALREADY_REWARDED);
        require(uint256(jurorState.weight) > 0, ERROR_WONT_REWARD_NON_VOTER_JUROR);
        jurorState.rewarded = true;

        // Check if the given juror has voted in favor of the final ruling of the dispute in this round
        ICRVoting voting = _voting();
        uint256 voteId = _getVoteId(_disputeId, _roundId);
        require(voting.hasVotedInFavorOf(voteId, dispute.finalRuling, _juror), ERROR_WONT_REWARD_INCOHERENT_JUROR);

        // Note that the number of coherent jurors has to be greater than zero since we already ensured the juror has voted in favor of the
        // final ruling, therefore there will be at least one coherent juror and divisions below are safe.
        uint256 coherentJurors = round.coherentJurors;
        uint256 collectedTokens = round.collectedTokens;
        IJurorsRegistry jurorsRegistry = _jurorsRegistry();

        // Distribute the collected tokens of the jurors that were slashed weighted by the winning jurors. Note that we are penalizing jurors
        // that refused intentionally their vote for the final round.
        uint256 collectedTokensReward = uint256(jurorState.weight).mul(collectedTokens) / coherentJurors;
        if (collectedTokens > 0) {
            jurorsRegistry.assignTokens(_juror, collectedTokensReward);
        }

        // Reward the winning juror with fees
        Config memory config = _getDisputeConfig(dispute);
        uint256 jurorFeesReward = round.jurorFees.mul(jurorState.weight) / coherentJurors;
        _treasury().assign(config.fees.token, _juror, jurorFeesReward);

        // Set the lock for final round
        if (!_isRegularRound(_roundId, config)) {
            // Round end term ID (as it's final there's no draft delay nor appeal) plus the lock period
            DisputesConfig memory disputesConfig = config.disputes;
            uint64 finalRoundLockTermId = round.draftTermId +
                disputesConfig.commitTerms + disputesConfig.revealTerms + disputesConfig.finalRoundLockTerms;
            jurorsRegistry.lockWithdrawals(_juror, finalRoundLockTermId);
        }

        emit RewardSettled(_disputeId, _roundId, _juror, collectedTokensReward, jurorFeesReward);
    }

    /**
    * @notice Settle appeal deposits for round #`_roundId` of dispute #`_disputeId`
    * @param _disputeId Identification number of the dispute to settle appeal deposits for
    * @param _roundId Identification number of the dispute round to settle appeal deposits for
    */
    function settleAppealDeposit(uint256 _disputeId, uint256 _roundId) external roundExists(_disputeId, _roundId) {
        // Ensure dispute round penalties are settled first
        Dispute storage dispute = disputes[_disputeId];
        AdjudicationRound storage round = dispute.rounds[_roundId];
        require(round.settledPenalties, ERROR_ROUND_NOT_SETTLED);

        // Ensure given round was appealed and has not been settled yet
        Appeal storage appeal = round.appeal;
        require(_existsAppeal(appeal), ERROR_ROUND_NOT_APPEALED);
        require(!appeal.settled, ERROR_ROUND_APPEAL_ALREADY_SETTLED);
        appeal.settled = true;
        emit AppealDepositSettled(_disputeId, _roundId);

        // Load next round details
        Config memory config = _getDisputeConfig(dispute);
        NextRoundDetails memory nextRound = _getNextRoundDetails(round, _roundId, config);
        ERC20 feeToken = nextRound.feeToken;
        uint256 totalFees = nextRound.totalFees;
        uint256 appealDeposit = nextRound.appealDeposit;
        uint256 confirmAppealDeposit = nextRound.confirmAppealDeposit;

        // If the appeal wasn't confirmed, return the entire deposit to appeal maker
        ITreasury treasury = _treasury();
        if (!_isAppealConfirmed(appeal)) {
            treasury.assign(feeToken, appeal.maker, appealDeposit);
            return;
        }

        // If the appeal was confirmed and there is a winner, we transfer the total deposit to that party. Otherwise, if the final ruling wasn't
        // selected by any of the appealing parties or no juror voted in the in favor of the possible outcomes, we split it between both parties.
        // Note that we are safe to access the dispute final ruling, since we already ensured that round penalties were settled.
        uint8 finalRuling = dispute.finalRuling;
        uint256 totalDeposit = appealDeposit.add(confirmAppealDeposit);
        if (appeal.appealedRuling == finalRuling) {
            treasury.assign(feeToken, appeal.maker, totalDeposit.sub(totalFees));
        } else if (appeal.opposedRuling == finalRuling) {
            treasury.assign(feeToken, appeal.taker, totalDeposit.sub(totalFees));
        } else {
            uint256 feesRefund = totalFees / 2;
            treasury.assign(feeToken, appeal.maker, appealDeposit.sub(feesRefund));
            treasury.assign(feeToken, appeal.taker, confirmAppealDeposit.sub(feesRefund));
        }
    }

    /**
    * @notice Ensure votes can be committed for vote #`_voteId`, revert otherwise
    * @dev This function will ensure the current term of the Court and revert in case votes cannot still be committed
    * @param _voteId ID of the vote instance to request the weight of a voter for
    */
    function ensureCanCommit(uint256 _voteId) external {
        (Dispute storage dispute, uint256 roundId) = _decodeVoteId(_voteId);
        Config memory config = _getDisputeConfig(dispute);

        // Ensure current term and check that votes can still be committed for the given round
        _ensureAdjudicationState(dispute, roundId, AdjudicationState.Committing, config.disputes);
    }

    /**
    * @notice Ensure `voter` can commit votes for vote #`_voteId`, revert otherwise
    * @dev This function will ensure the current term of the Court and revert in case the given voter is not allowed to commit votes
    * @param _voteId ID of the vote instance to request the weight of a voter for
    * @param _voter Address of the voter querying the weight of
    */
    function ensureCanCommit(uint256 _voteId, address _voter) external onlyVoting {
        (Dispute storage dispute, uint256 roundId) = _decodeVoteId(_voteId);
        Config memory config = _getDisputeConfig(dispute);

        // Ensure current term and check that votes can still be committed for the given round
        _ensureAdjudicationState(dispute, roundId, AdjudicationState.Committing, config.disputes);
        uint64 weight = _computeJurorWeight(dispute, roundId, _voter, config);
        require(weight > 0, ERROR_VOTER_WEIGHT_ZERO);
    }

    /**
    * @notice Ensure `voter` can reveal votes for vote #`_voteId`, revert otherwise
    * @dev This function will ensure the current term of the Court and revert in case votes cannot still be revealed
    * @param _voteId ID of the vote instance to request the weight of a voter for
    * @param _voter Address of the voter querying the weight of
    * @return Weight of the requested juror for the requested dispute's round
    */
    function ensureCanReveal(uint256 _voteId, address _voter) external returns (uint64) {
        (Dispute storage dispute, uint256 roundId) = _decodeVoteId(_voteId);
        Config memory config = _getDisputeConfig(dispute);

        // Ensure current term and check that votes can still be revealed for the given round
        _ensureAdjudicationState(dispute, roundId, AdjudicationState.Revealing, config.disputes);
        AdjudicationRound storage round = dispute.rounds[roundId];
        return _getJurorWeight(round, _voter);
    }

    /**
    * @notice Sets the global configuration for the max number of jurors to be drafted per batch to `_maxJurorsPerDraftBatch`
    * @param _maxJurorsPerDraftBatch Max number of jurors to be drafted per batch
    */
    function setMaxJurorsPerDraftBatch(uint64 _maxJurorsPerDraftBatch) external onlyConfigGovernor {
        _setMaxJurorsPerDraftBatch(_maxJurorsPerDraftBatch);
    }

    /**
    * @dev Tell the amount of token fees required to create a dispute
    * @return feeToken ERC20 token used for the fees
    * @return totalFees Total amount of fees for a regular round at the given term
    */
    function getDisputeFees() external view returns (ERC20 feeToken, uint256 totalFees) {
        uint64 currentTermId = _getCurrentTermId();
        Config memory config = _getConfigAt(currentTermId);
        (feeToken,, totalFees) = _getRegularRoundFees(config.fees, config.disputes.firstRoundJurorsNumber);
    }

    /**
    * @dev Tell information of a certain dispute
    * @param _disputeId Identification number of the dispute being queried
    * @return subject Arbitrable subject being disputed
    * @return possibleRulings Number of possible rulings allowed for the drafted jurors to vote on the dispute
    * @return state Current state of the dispute being queried: pre-draft, adjudicating, or ruled
    * @return finalRuling The winning ruling in case the dispute is finished
    * @return lastRoundId Identification number of the last round created for the dispute
    * @return createTermId Identification number of the term when the dispute was created
    */
    function getDispute(uint256 _disputeId) external view disputeExists(_disputeId)
        returns (IArbitrable subject, uint8 possibleRulings, DisputeState state, uint8 finalRuling, uint256 lastRoundId, uint64 createTermId)
    {
        Dispute storage dispute = disputes[_disputeId];

        subject = dispute.subject;
        possibleRulings = dispute.possibleRulings;
        state = dispute.state;
        finalRuling = dispute.finalRuling;
        createTermId = dispute.createTermId;
        // If a dispute exists, it has at least one round
        lastRoundId = dispute.rounds.length - 1;
    }

    /**
    * @dev Tell information of a certain adjudication round
    * @param _disputeId Identification number of the dispute being queried
    * @param _roundId Identification number of the round being queried
    * @return draftTerm Term from which the requested round can be drafted
    * @return delayedTerms Number of terms the given round was delayed based on its requested draft term id
    * @return jurorsNumber Number of jurors requested for the round
    * @return selectedJurors Number of jurors already selected for the requested round
    * @return settledPenalties Whether or not penalties have been settled for the requested round
    * @return collectedTokens Amount of juror tokens that were collected from slashed jurors for the requested round
    * @return coherentJurors Number of jurors that voted in favor of the final ruling in the requested round
    * @return state Adjudication state of the requested round
    */
    function getRound(uint256 _disputeId, uint256 _roundId) external view roundExists(_disputeId, _roundId)
        returns (
            uint64 draftTerm,
            uint64 delayedTerms,
            uint64 jurorsNumber,
            uint64 selectedJurors,
            uint256 jurorFees,
            bool settledPenalties,
            uint256 collectedTokens,
            uint64 coherentJurors,
            AdjudicationState state
        )
    {
        Dispute storage dispute = disputes[_disputeId];
        state = _adjudicationStateAt(dispute, _roundId, _getCurrentTermId(), _getDisputeConfig(dispute).disputes);

        AdjudicationRound storage round = dispute.rounds[_roundId];
        draftTerm = round.draftTermId;
        delayedTerms = round.delayedTerms;
        jurorsNumber = round.jurorsNumber;
        selectedJurors = round.selectedJurors;
        jurorFees = round.jurorFees;
        settledPenalties = round.settledPenalties;
        coherentJurors = round.coherentJurors;
        collectedTokens = round.collectedTokens;
    }

    /**
    * @dev Tell appeal-related information of a certain adjudication round
    * @param _disputeId Identification number of the dispute being queried
    * @param _roundId Identification number of the round being queried
    * @return maker Address of the account appealing the given round
    * @return appealedRuling Ruling confirmed by the appealer of the given round
    * @return taker Address of the account confirming the appeal of the given round
    * @return opposedRuling Ruling confirmed by the appeal taker of the given round
    */
    function getAppeal(uint256 _disputeId, uint256 _roundId) external view roundExists(_disputeId, _roundId)
        returns (address maker, uint64 appealedRuling, address taker, uint64 opposedRuling)
    {
        Appeal storage appeal = disputes[_disputeId].rounds[_roundId].appeal;

        maker = appeal.maker;
        appealedRuling = appeal.appealedRuling;
        taker = appeal.taker;
        opposedRuling = appeal.opposedRuling;
    }

    /**
    * @dev Tell information related to the next round due to an appeal of a certain round given.
    * @param _disputeId Identification number of the dispute being queried
    * @param _roundId Identification number of the round requesting the appeal details of
    * @return nextRoundStartTerm Term ID from which the next round will start
    * @return nextRoundJurorsNumber Jurors number for the next round
    * @return newDisputeState New state for the dispute associated to the given round after the appeal
    * @return feeToken ERC20 token used for the next round fees
    * @return jurorFees Total amount of fees to be distributed between the winning jurors of the next round
    * @return totalFees Total amount of fees for a regular round at the given term
    * @return appealDeposit Amount to be deposit of fees for a regular round at the given term
    * @return confirmAppealDeposit Total amount of fees for a regular round at the given term
    */
    function getNextRoundDetails(uint256 _disputeId, uint256 _roundId) external view
        returns (
            uint64 nextRoundStartTerm,
            uint64 nextRoundJurorsNumber,
            DisputeState newDisputeState,
            ERC20 feeToken,
            uint256 totalFees,
            uint256 jurorFees,
            uint256 appealDeposit,
            uint256 confirmAppealDeposit
        )
    {
        _checkRoundExists(_disputeId, _roundId);

        Dispute storage dispute = disputes[_disputeId];
        Config memory config = _getDisputeConfig(dispute);
        require(_isRegularRound(_roundId, config), ERROR_ROUND_IS_FINAL);

        AdjudicationRound storage round = dispute.rounds[_roundId];
        NextRoundDetails memory nextRound = _getNextRoundDetails(round, _roundId, config);
        return (
            nextRound.startTerm,
            nextRound.jurorsNumber,
            nextRound.newDisputeState,
            nextRound.feeToken,
            nextRound.totalFees,
            nextRound.jurorFees,
            nextRound.appealDeposit,
            nextRound.confirmAppealDeposit
        );
    }

    /**
    * @dev Tell juror-related information of a certain adjudication round
    * @param _disputeId Identification number of the dispute being queried
    * @param _roundId Identification number of the round being queried
    * @param _juror Address of the juror being queried
    * @return weight Juror weight drafted for the requested round
    * @return rewarded Whether or not the given juror was rewarded based on the requested round
    */
    function getJuror(uint256 _disputeId, uint256 _roundId, address _juror) external view roundExists(_disputeId, _roundId)
        returns (uint64 weight, bool rewarded)
    {
        Dispute storage dispute = disputes[_disputeId];
        AdjudicationRound storage round = dispute.rounds[_roundId];
        Config memory config = _getDisputeConfig(dispute);

        if (_isRegularRound(_roundId, config)) {
            weight = _getJurorWeight(round, _juror);
        } else {
            IJurorsRegistry jurorsRegistry = _jurorsRegistry();
            uint256 activeBalance = jurorsRegistry.activeBalanceOfAt(_juror, round.draftTermId);
            weight = _getMinActiveBalanceMultiple(activeBalance, config.minActiveBalance);
        }

        rewarded = round.jurorsStates[_juror].rewarded;
    }

    /**
    * @dev Internal function to create a new round for a given dispute
    * @param _disputeId Identification number of the dispute to create a new round for
    * @param _disputeState New state for the dispute to be changed
    * @param _draftTermId Term ID when the jurors for the new round will be drafted
    * @param _jurorsNumber Number of jurors to be drafted for the new round
    * @param _jurorFees Total amount of fees to be shared between the winning jurors of the new round
    * @return Identification number of the new dispute round
    */
    function _createRound(uint256 _disputeId, DisputeState _disputeState, uint64 _draftTermId, uint64 _jurorsNumber, uint256 _jurorFees) internal
        returns (uint256)
    {
        // Update dispute state
        Dispute storage dispute = disputes[_disputeId];
        dispute.state = _disputeState;

        // Create new requested round
        uint256 roundId = dispute.rounds.length++;
        AdjudicationRound storage round = dispute.rounds[roundId];
        round.draftTermId = _draftTermId;
        round.jurorsNumber = _jurorsNumber;
        round.jurorFees = _jurorFees;

        // Create new vote for the new round
        ICRVoting voting = _voting();
        uint256 voteId = _getVoteId(_disputeId, roundId);
        voting.create(voteId, dispute.possibleRulings);
        return roundId;
    }

    /**
    * @dev Internal function to ensure the adjudication state of a certain dispute round. This function will make sure the court term is updated.
    *      This function assumes the given round exists.
    * @param _dispute Dispute to be checked
    * @param _roundId Identification number of the dispute round to be checked
    * @param _state Expected adjudication state for the given dispute round
    * @param _config Config at the draft term ID of the given dispute
    */
    function _ensureAdjudicationState(Dispute storage _dispute, uint256 _roundId, AdjudicationState _state, DisputesConfig memory _config)
        internal
    {
        uint64 termId = _ensureCurrentTerm();
        AdjudicationState roundState = _adjudicationStateAt(_dispute, _roundId, termId, _config);
        require(roundState == _state, ERROR_INVALID_ADJUDICATION_STATE);
    }

    /**
    * @dev Internal function to ensure the final ruling of a dispute. It will compute it only if missing.
    * @param _dispute Dispute to ensure its final ruling
    * @param _disputeId Identification number of the dispute to ensure its final ruling
    * @param _config Config at the draft term ID of the given dispute
    * @return Number of the final ruling ensured for the given dispute
    */
    function _ensureFinalRuling(Dispute storage _dispute, uint256 _disputeId, Config memory _config) internal returns (uint8) {
        // Check if there was a final ruling already cached
        if (uint256(_dispute.finalRuling) > 0) {
            return _dispute.finalRuling;
        }

        // Ensure current term and check that the last adjudication round has ended.
        // Note that there will always be at least one round.
        uint256 lastRoundId = _dispute.rounds.length - 1;
        _ensureAdjudicationState(_dispute, lastRoundId, AdjudicationState.Ended, _config.disputes);

        // If the last adjudication round was appealed but no-one confirmed it, the final ruling is the outcome the
        // appealer vouched for. Otherwise, fetch the winning outcome from the voting app of the last round.
        AdjudicationRound storage lastRound = _dispute.rounds[lastRoundId];
        Appeal storage lastAppeal = lastRound.appeal;
        bool isRoundAppealedAndNotConfirmed = _existsAppeal(lastAppeal) && !_isAppealConfirmed(lastAppeal);
        uint8 finalRuling = isRoundAppealedAndNotConfirmed
            ? lastAppeal.appealedRuling
            : _voting().getWinningOutcome(_getVoteId(_disputeId, lastRoundId));

        // Store the winning ruling as the final decision for the given dispute
        _dispute.finalRuling = finalRuling;
        return finalRuling;
    }

    /**
    * @dev Internal function to slash all the jurors drafted for a round that didn't vote in favor of the final ruling of a dispute. Note that
    *      the slashing can be batched handling the maximum number of jurors to be slashed on each call.
    * @param _round Round to slash the non-winning jurors of
    * @param _voteId Identification number of the voting associated to the given round
    * @param _finalRuling Winning ruling of the dispute corresponding to the given round
    * @param _penaltyPct Per ten thousand of the minimum active balance of a juror to be slashed
    * @param _jurorsToSettle Maximum number of jurors to be slashed in this call. It can be set to zero to slash all the losing jurors of the round.
    * @param _minActiveBalance Minimum amount of juror tokens that can be activated
    * @return Number of jurors slashed for the given round
    */
    function _settleRegularRoundPenalties(
        AdjudicationRound storage _round,
        uint256 _voteId,
        uint8 _finalRuling,
        uint16 _penaltyPct,
        uint256 _jurorsToSettle,
        uint256 _minActiveBalance
    )
        internal
        returns (uint256)
    {
        uint64 termId = _ensureCurrentTerm();
        // The batch starts where the previous one ended, stored in _round.settledJurors
        uint256 roundSettledJurors = _round.settledJurors;
        // Compute the amount of jurors that are going to be settled in this batch, which is returned by the function for fees calculation
        // Initially we try to reach the end of the jurors array
        uint256 batchSettledJurors = _round.jurors.length.sub(roundSettledJurors);

        // If the requested amount of jurors is not zero and it is lower that the remaining number of jurors to be settled for the given round,
        // we cap the number of jurors that are going to be settled in this batch to the requested amount. If not, we know we have reached the
        // last batch and we are safe to mark round penalties as settled.
        if (_jurorsToSettle > 0 && batchSettledJurors > _jurorsToSettle) {
            batchSettledJurors = _jurorsToSettle;
        } else {
            _round.settledPenalties = true;
        }

        // Update the number of round settled jurors.
        _round.settledJurors = uint64(roundSettledJurors.add(batchSettledJurors));

        // Prepare the list of jurors and penalties to either be slashed or returned based on their votes for the given round
        IJurorsRegistry jurorsRegistry = _jurorsRegistry();
        address[] memory jurors = new address[](batchSettledJurors);
        uint256[] memory penalties = new uint256[](batchSettledJurors);
        for (uint256 i = 0; i < batchSettledJurors; i++) {
            address juror = _round.jurors[roundSettledJurors + i];
            jurors[i] = juror;
            penalties[i] = _minActiveBalance.pct(_penaltyPct).mul(_round.jurorsStates[juror].weight);
        }

        // Check which of the jurors voted in favor of the final ruling of the dispute in this round. Ask the registry to slash or unlocked the
        // locked active tokens of each juror depending on their vote, and finally store the total amount of slashed tokens.
        bool[] memory jurorsInFavor = _voting().getVotersInFavorOf(_voteId, _finalRuling, jurors);
        _round.collectedTokens = _round.collectedTokens.add(jurorsRegistry.slashOrUnlock(termId, jurors, penalties, jurorsInFavor));
        return batchSettledJurors;
    }

    /**
    * @dev Internal function to compute the juror weight for a dispute's round
    * @param _dispute Dispute to calculate the juror's weight of
    * @param _roundId ID of the dispute's round to calculate the juror's weight of
    * @param _juror Address of the juror to calculate the weight of
    * @param _config Config at the draft term ID of the given dispute
    * @return Computed weight of the requested juror for the final round of the given dispute
    */
    function _computeJurorWeight(Dispute storage _dispute, uint256 _roundId, address _juror, Config memory _config) internal returns (uint64) {
        AdjudicationRound storage round = _dispute.rounds[_roundId];

        return _isRegularRound(_roundId, _config)
            ? _getJurorWeight(round, _juror)
            : _computeJurorWeightForFinalRound(_config, round, _juror);
    }

    /**
    * @dev Internal function to compute the juror weight for the final round. Note that for a final round the weight of
    *      each juror is equal to the number of times the min active balance the juror has. This function will try to
    *      collect said amount from the active balance of a juror, acting as a lock to allow them to vote.
    * @param _config Court config to calculate the juror's weight
    * @param _round Dispute round to calculate the juror's weight for
    * @param _juror Address of the juror to calculate the weight of
    * @return Weight of the requested juror for the final round of the given dispute
    */
    function _computeJurorWeightForFinalRound(Config memory _config, AdjudicationRound storage _round, address _juror) internal
        returns (uint64)
    {
        // Fetch active balance and multiples of the min active balance from the registry
        IJurorsRegistry jurorsRegistry = _jurorsRegistry();
        uint256 activeBalance = jurorsRegistry.activeBalanceOfAt(_juror, _round.draftTermId);
        uint64 weight = _getMinActiveBalanceMultiple(activeBalance, _config.minActiveBalance);

        // If the juror weight for the last round is zero, return zero
        if (weight == 0) {
            return uint64(0);
        }

        // To guarantee scalability of the final round, since all jurors may vote, we try to collect the amount of
        // active tokens that needs to be locked for each juror when they try to commit their vote.
        uint256 weightedPenalty = activeBalance.pct(_config.disputes.penaltyPct);

        // If it was not possible to collect the amount to be locked, return 0 to prevent juror from voting
        if (!jurorsRegistry.collectTokens(_juror, weightedPenalty, _getLastEnsuredTermId())) {
            return uint64(0);
        }

        // If it was possible to collect the amount of active tokens to be locked, update the final round state
        _round.jurorsStates[_juror].weight = weight;
        _round.collectedTokens = _round.collectedTokens.add(weightedPenalty);

        return weight;
    }

    /**
    * @dev Sets the global configuration for the max number of jurors to be drafted per batch
    * @param _maxJurorsPerDraftBatch Max number of jurors to be drafted per batch
    */
    function _setMaxJurorsPerDraftBatch(uint64 _maxJurorsPerDraftBatch) internal {
        require(_maxJurorsPerDraftBatch > 0, ERROR_BAD_MAX_DRAFT_BATCH_SIZE);
        emit MaxJurorsPerDraftBatchChanged(maxJurorsPerDraftBatch, _maxJurorsPerDraftBatch);
        maxJurorsPerDraftBatch = _maxJurorsPerDraftBatch;
    }

    /**
    * @dev Internal function to execute a deposit of tokens from an account to the Court treasury contract
    * @param _from Address transferring the amount of tokens
    * @param _token ERC20 token to execute a transfer from
    * @param _amount Amount of tokens to be transferred from the address transferring the funds to the Court treasury
    */
    function _depositAmount(address _from, ERC20 _token, uint256 _amount) internal {
        if (_amount > 0) {
            ITreasury treasury = _treasury();
            require(_token.safeTransferFrom(_from, address(treasury), _amount), ERROR_DEPOSIT_FAILED);
        }
    }

    /**
    * @dev Internal function to get the stored juror weight for a round. Note that the weight of a juror is:
    *      - For a regular round: the number of times a juror was picked for the round round.
    *      - For a final round: the relative active stake of a juror's state over the total active tokens, only set after the juror has voted.
    * @param _round Dispute round to calculate the juror's weight of
    * @param _juror Address of the juror to calculate the weight of
    * @return Weight of the requested juror for the given round
    */
    function _getJurorWeight(AdjudicationRound storage _round, address _juror) internal view returns (uint64) {
        return _round.jurorsStates[_juror].weight;
    }

    /**
    * @dev Internal function to tell information related to the next round due to an appeal of a certain round given. This function assumes
    *      given round can be appealed and that the given round ID corresponds to the given round pointer.
    * @param _round Round requesting the appeal details of
    * @param _roundId Identification number of the round requesting the appeal details of
    * @param _config Config at the draft term of the given dispute
    * @return Next round details
    */
    function _getNextRoundDetails(AdjudicationRound storage _round, uint256 _roundId, Config memory _config) internal view
        returns (NextRoundDetails memory)
    {
        NextRoundDetails memory nextRound;
        DisputesConfig memory disputesConfig = _config.disputes;

        // Next round start term is current round end term
        uint64 delayedDraftTerm = _round.draftTermId.add(_round.delayedTerms);
        uint64 currentRoundAppealStartTerm = delayedDraftTerm.add(disputesConfig.commitTerms).add(disputesConfig.revealTerms);
        nextRound.startTerm = currentRoundAppealStartTerm.add(disputesConfig.appealTerms).add(disputesConfig.appealConfirmTerms);

        // Compute next round settings depending on if it will be the final round or not
        if (_roundId >= disputesConfig.maxRegularAppealRounds.sub(1)) {
            // If the next round is the final round, no draft is needed.
            nextRound.newDisputeState = DisputeState.Adjudicating;
            // The number of jurors will be the number of times the minimum stake is held in the registry,
            // multiplied by a precision factor to help with division rounding.
            // Total active balance is guaranteed to never be greater than `2^64 * minActiveBalance / FINAL_ROUND_WEIGHT_PRECISION`.
            // Thus, the jurors number for a final round will always fit in uint64.
            IJurorsRegistry jurorsRegistry = _jurorsRegistry();
            uint256 totalActiveBalance = jurorsRegistry.totalActiveBalanceAt(nextRound.startTerm);
            uint64 jurorsNumber = _getMinActiveBalanceMultiple(totalActiveBalance, _config.minActiveBalance);
            nextRound.jurorsNumber = jurorsNumber;
            // Calculate fees for the final round using the appeal start term of the current round
            (nextRound.feeToken, nextRound.jurorFees, nextRound.totalFees) = _getFinalRoundFees(_config.fees, jurorsNumber);
        } else {
            // For a new regular rounds we need to draft jurors
            nextRound.newDisputeState = DisputeState.PreDraft;
            // The number of jurors will be the number of jurors of the current round multiplied by an appeal factor
            nextRound.jurorsNumber = _getNextRegularRoundJurorsNumber(_round, disputesConfig);
            // Calculate fees for the next regular round using the appeal start term of the current round
            (nextRound.feeToken, nextRound.jurorFees, nextRound.totalFees) = _getRegularRoundFees(_config.fees, nextRound.jurorsNumber);
        }

        // Calculate appeal collateral
        nextRound.appealDeposit = nextRound.totalFees.pct256(disputesConfig.appealCollateralFactor);
        nextRound.confirmAppealDeposit = nextRound.totalFees.pct256(disputesConfig.appealConfirmCollateralFactor);
        return nextRound;
    }

    /**
    * @dev Internal function to calculate the jurors number for the next regular round of a given round. This function assumes Court term is
    *      up-to-date, that the next round of the one given is regular, and the given config corresponds to the draft term of the given round.
    * @param _round Round querying the jurors number of its next round
    * @param _config Disputes config at the draft term of the first round of the dispute
    * @return Jurors number for the next regular round of the given round
    */
    function _getNextRegularRoundJurorsNumber(AdjudicationRound storage _round, DisputesConfig memory _config) internal view returns (uint64) {
        // Jurors number are increased by a step factor on each appeal
        uint64 jurorsNumber = _round.jurorsNumber.mul(_config.appealStepFactor);
        // Make sure it's odd to enforce avoiding a tie. Note that it can happen if any of the jurors don't vote anyway.
        if (uint256(jurorsNumber) % 2 == 0) {
            jurorsNumber++;
        }
        return jurorsNumber;
    }

    /**
    * @dev Internal function to tell adjudication state of a round at a certain term. This function assumes the given round exists.
    * @param _dispute Dispute querying the adjudication round of
    * @param _roundId Identification number of the dispute round querying the adjudication round of
    * @param _termId Identification number of the term to be used for the different round phases durations
    * @param _config Disputes config at the draft term ID of the given dispute
    * @return Adjudication state of the requested dispute round for the given term
    */
    function _adjudicationStateAt(Dispute storage _dispute, uint256 _roundId, uint64 _termId, DisputesConfig memory _config) internal view
        returns (AdjudicationState)
    {
        AdjudicationRound storage round = _dispute.rounds[_roundId];

        // If the dispute is ruled or the given round is not the last one, we consider it ended
        uint256 numberOfRounds = _dispute.rounds.length;
        if (_dispute.state == DisputeState.Ruled || _roundId < numberOfRounds.sub(1)) {
            return AdjudicationState.Ended;
        }

        // If given term is before the actual term when the last round was finally drafted, then the last round adjudication state is invalid
        uint64 draftFinishedTermId = round.draftTermId.add(round.delayedTerms);
        if (_dispute.state == DisputeState.PreDraft || _termId < draftFinishedTermId) {
            return AdjudicationState.Invalid;
        }

        // If given term is before the reveal start term of the last round, then jurors are still allowed to commit votes for the last round
        uint64 revealStartTerm = draftFinishedTermId.add(_config.commitTerms);
        if (_termId < revealStartTerm) {
            return AdjudicationState.Committing;
        }

        // If given term is before the appeal start term of the last round, then jurors are still allowed to reveal votes for the last round
        uint64 appealStartTerm = revealStartTerm.add(_config.revealTerms);
        if (_termId < appealStartTerm) {
            return AdjudicationState.Revealing;
        }

        // If the max number of appeals has been reached, then the last round is the final round and can be considered ended
        bool maxAppealReached = numberOfRounds > _config.maxRegularAppealRounds;
        if (maxAppealReached) {
            return AdjudicationState.Ended;
        }

        // If the last round was not appealed yet, check if the confirmation period has started or not
        bool isLastRoundAppealed = _existsAppeal(round.appeal);
        uint64 appealConfirmationStartTerm = appealStartTerm.add(_config.appealTerms);
        if (!isLastRoundAppealed) {
            // If given term is before the appeal confirmation start term, then the last round can still be appealed. Otherwise, it is ended.
            if (_termId < appealConfirmationStartTerm) {
                return AdjudicationState.Appealing;
            } else {
                return AdjudicationState.Ended;
            }
        }

        // If the last round was appealed and the given term is before the appeal confirmation end term, then the last round appeal can still be
        // confirmed. Note that if the round being checked was already appealed and confirmed, it won't be the last round, thus it will be caught
        // above by the first check and considered 'Ended'.
        uint64 appealConfirmationEndTerm = appealConfirmationStartTerm.add(_config.appealConfirmTerms);
        if (_termId < appealConfirmationEndTerm) {
            return AdjudicationState.ConfirmingAppeal;
        }

        // If non of the above conditions have been met, the last round is considered ended
        return AdjudicationState.Ended;
    }

    /**
    * @dev Internal function to get the Court config used for a dispute
    * @param _dispute Dispute querying the Court config of
    * @return Court config used for the given dispute
    */
    function _getDisputeConfig(Dispute storage _dispute) internal view returns (Config memory) {
        // Note that it is safe to access a Court config directly for a past term
        return _getConfigAt(_dispute.createTermId);
    }

    /**
    * @dev Internal function to check if a certain appeal exists
    * @param _appeal Appeal to be checked
    * @return True if the given appeal has a maker address associated to it, false otherwise
    */
    function _existsAppeal(Appeal storage _appeal) internal view returns (bool) {
        return _appeal.maker != address(0);
    }

    /**
    * @dev Internal function to check if a certain appeal has been confirmed
    * @param _appeal Appeal to be checked
    * @return True if the given appeal was confirmed, false otherwise
    */
    function _isAppealConfirmed(Appeal storage _appeal) internal view returns (bool) {
        return _appeal.taker != address(0);
    }

    /**
    * @dev Internal function to check if a certain dispute exists, it reverts if it doesn't
    * @param _disputeId Identification number of the dispute to be checked
    */
    function _checkDisputeExists(uint256 _disputeId) internal view {
        require(_disputeId < disputes.length, ERROR_DISPUTE_DOES_NOT_EXIST);
    }

    /**
    * @dev Internal function to check if a certain dispute round exists, it reverts if it doesn't
    * @param _disputeId Identification number of the dispute to be checked
    * @param _roundId Identification number of the dispute round to be checked
    */
    function _checkRoundExists(uint256 _disputeId, uint256 _roundId) internal view {
        _checkDisputeExists(_disputeId);
        require(_roundId < disputes[_disputeId].rounds.length, ERROR_ROUND_DOES_NOT_EXIST);
    }

    /**
    * @dev Internal function to get the dispute round of a certain vote identification number
    * @param _voteId Identification number of the vote querying the dispute round of
    * @return dispute Dispute for the given vote
    * @return roundId Identification number of the dispute round for the given vote
    */
    function _decodeVoteId(uint256 _voteId) internal view returns (Dispute storage dispute, uint256 roundId) {
        uint256 disputeId = _voteId >> 128;
        roundId = _voteId & VOTE_ID_MASK;
        _checkRoundExists(disputeId, roundId);
        dispute = disputes[disputeId];
    }

    /**
    * @dev Internal function to get the identification number of the vote of a certain dispute round
    * @param _disputeId Identification number of the dispute querying the vote ID of
    * @param _roundId Identification number of the dispute round querying the vote ID of
    * @return Identification number of the vote of the requested dispute round
    */
    function _getVoteId(uint256 _disputeId, uint256 _roundId) internal pure returns (uint256) {
        return (_disputeId << 128) + _roundId;
    }

    /**
    * @dev Internal function to get fees information for regular rounds for a certain term. This function assumes Court term is up-to-date.
    * @param _config Court config to use in order to get fees
    * @param _jurorsNumber Number of jurors participating in the round being queried
    * @return feeToken ERC20 token used for the fees
    * @return jurorFees Total amount of fees to be distributed between the winning jurors of a round
    * @return totalFees Total amount of fees for a regular round at the given term
    */
    function _getRegularRoundFees(FeesConfig memory _config, uint64 _jurorsNumber) internal pure
        returns (ERC20 feeToken, uint256 jurorFees, uint256 totalFees)
    {
        feeToken = _config.token;
        // For regular rounds the fees for each juror is constant and given by the config of the round
        jurorFees = uint256(_jurorsNumber).mul(_config.jurorFee);
        // The total fees for regular rounds also considers the number of drafts and settles
        uint256 draftAndSettleFees = (_config.draftFee.add(_config.settleFee)).mul(uint256(_jurorsNumber));
        totalFees = jurorFees.add(draftAndSettleFees);
    }

    /**
    * @dev Internal function to get fees information for final rounds for a certain term. This function assumes Court term is up-to-date.
    * @param _config Court config to use in order to get fees
    * @param _jurorsNumber Number of jurors participating in the round being queried
    * @return feeToken ERC20 token used for the fees
    * @return jurorFees Total amount of fees corresponding to the jurors at the given term
    * @return totalFees Total amount of fees for a final round at the given term
    */
    function _getFinalRoundFees(FeesConfig memory _config, uint64 _jurorsNumber) internal pure
        returns (ERC20 feeToken, uint256 jurorFees, uint256 totalFees)
    {
        feeToken = _config.token;
        // For final rounds, the jurors number is computed as the number of times the registry's minimum active balance is held in the registry
        // itself, multiplied by a precision factor. To avoid requesting a huge amount of fees, a final round discount is applied for each juror.
        jurorFees = (uint256(_jurorsNumber).mul(_config.jurorFee) / FINAL_ROUND_WEIGHT_PRECISION).pct(_config.finalRoundReduction);
        // There is no draft and no extra settle fees considered for final rounds
        totalFees = jurorFees;
    }

    /**
    * @dev Internal function to tell whether a round is regular or final. This function assumes the given round exists.
    * @param _roundId Identification number of the round to be checked
    * @param _config Court config to use in order to check if the given round is regular or final
    * @return True if the given round is regular, false in case its a final round
    */
    function _isRegularRound(uint256 _roundId, Config memory _config) internal pure returns (bool) {
        return _roundId < _config.disputes.maxRegularAppealRounds;
    }

    /**
    * @dev Calculate the number of times that an amount contains the min active balance (multiplied by precision).
    *      Used to get the juror weight for the final round. Note that for the final round the weight of
    *      each juror is equal to the number of times the min active balance the juror has, multiplied by a precision
    *      factor to deal with division rounding.
    * @param _activeBalance Juror's or total active balance
    * @param _minActiveBalance Minimum amount of juror tokens that can be activated
    * @return Number of times that the active balance contains the min active balance (multiplied by precision)
    */
    function _getMinActiveBalanceMultiple(uint256 _activeBalance, uint256 _minActiveBalance) internal pure returns (uint64) {
        // Note that jurors may not reach the minimum active balance since some might have been slashed. If that occurs,
        // these jurors cannot vote in the final round.
        if (_activeBalance < _minActiveBalance) {
            return 0;
        }

        // Otherwise, return the times the active balance of the juror fits in the min active balance, multiplying
        // it by a round factor to ensure a better precision rounding.
        return (FINAL_ROUND_WEIGHT_PRECISION.mul(_activeBalance) / _minActiveBalance).toUint64();
    }

    /**
    * @dev Private function to build params to call for a draft. It assumes the given data is correct.
    * @param _disputeId Identification number of the dispute to be drafted
    * @param _roundId Identification number of the round to be drafted
    * @param _termId Identification number of the current term of the Court
    * @param _draftTermRandomness Randomness of the term in which the dispute was requested to be drafted
    * @param _config Draft config of the Court at the draft term
    * @return Draft params object
    */
    function _buildDraftParams(uint256 _disputeId, uint256 _roundId, uint64 _termId, bytes32 _draftTermRandomness, DraftConfig memory _config)
        private
        pure
        returns (DraftParams memory)
    {
        return DraftParams({
            disputeId: _disputeId,
            roundId: _roundId,
            termId: _termId,
            draftTermRandomness: _draftTermRandomness,
            config: _config
        });
    }

    /**
    * @dev Private function to draft jurors for a given dispute and round. It assumes the given data is correct.
    * @param _round Round of the dispute to be drafted
    * @param _draftParams Draft params to be used for the draft
    * @return True if all the requested jurors for the given round were drafted, false otherwise
    */
    function _draft(AdjudicationRound storage _round, DraftParams memory _draftParams) private returns (bool) {
        uint64 jurorsNumber = _round.jurorsNumber;
        uint64 selectedJurors = _round.selectedJurors;
        uint64 maxJurorsPerBatch = maxJurorsPerDraftBatch;
        uint64 jurorsToBeDrafted = jurorsNumber.sub(selectedJurors);
        // Draft the min number of jurors between the one requested by the sender and the one requested by the sender
        uint64 requestedJurors = jurorsToBeDrafted < maxJurorsPerBatch ? jurorsToBeDrafted : maxJurorsPerBatch;

        // Pack draft params
        uint256[7] memory params = [
            uint256(_draftParams.draftTermRandomness),
            _draftParams.disputeId,
            uint256(_draftParams.termId),
            uint256(selectedJurors),
            uint256(requestedJurors),
            uint256(jurorsNumber),
            uint256(_draftParams.config.penaltyPct)
        ];

        // Draft jurors for the requested round
        IJurorsRegistry jurorsRegistry = _jurorsRegistry();
        (address[] memory jurors, uint256 draftedJurors) = jurorsRegistry.draft(params);

        // Update round with drafted jurors information
        uint64 newSelectedJurors = selectedJurors.add(uint64(draftedJurors));
        _round.selectedJurors = newSelectedJurors;
        _updateRoundDraftedJurors(_draftParams.disputeId, _draftParams.roundId, _round, jurors, draftedJurors);
        bool draftEnded = newSelectedJurors == jurorsNumber;

        // Transfer fees corresponding to the actual number of drafted jurors
        uint256 draftFees = _draftParams.config.draftFee.mul(draftedJurors);
        _treasury().assign(_draftParams.config.feeToken, msg.sender, draftFees);
        return draftEnded;
    }

    /**
    * @dev Private function to update the drafted jurors' weight for the given round
    * @param _disputeId Identification number of the dispute being drafted
    * @param _roundId Identification number of the round being drafted
    * @param _round Adjudication round that was drafted
    * @param _jurors List of jurors addresses that were drafted for the given round
    * @param _draftedJurors Number of jurors that were drafted for the given round. Note that this number may not necessarily be equal to the
    *        given list of jurors since the draft could potentially return less jurors than the requested amount.
    */
    function _updateRoundDraftedJurors(
        uint256 _disputeId,
        uint256 _roundId,
        AdjudicationRound storage _round,
        address[] memory _jurors,
        uint256 _draftedJurors
    )
        private
    {
        for (uint256 i = 0; i < _draftedJurors; i++) {
            address juror = _jurors[i];
            JurorState storage jurorState = _round.jurorsStates[juror];

            // If the juror was already registered in the list, then don't add it twice
            if (uint256(jurorState.weight) == 0) {
                _round.jurors.push(juror);
            }

            jurorState.weight = jurorState.weight.add(1);
            emit JurorDrafted(_disputeId, _roundId, juror);
        }
    }

    /**
    * @dev Private function to burn the collected for a certain round in case there were no coherent jurors
    * @param _dispute Dispute to settle penalties for
    * @param _round Dispute round to settle penalties for
    * @param _roundId Identification number of the dispute round to settle penalties for
    * @param _courtTreasury Treasury module to refund the corresponding juror fees
    * @param _feeToken ERC20 token to be used for the fees corresponding to the draft term of the given dispute round
    * @param _collectedTokens Amount of tokens collected during the given dispute round
    */
    function _burnCollectedTokensIfNecessary(
        Dispute storage _dispute,
        AdjudicationRound storage _round,
        uint256 _roundId,
        ITreasury _courtTreasury,
        ERC20 _feeToken,
        uint256 _collectedTokens
    )
        private
    {
        // If there was at least one juror voting in favor of the winning ruling, return
        if (_round.coherentJurors > 0) {
            return;
        }

        // Burn all the collected tokens of the jurors to be slashed. Note that this will happen only when there were no jurors voting
        // in favor of the final winning outcome. Otherwise, these will be re-distributed between the winning jurors in `settleReward`
        // instead of being burned.
        if (_collectedTokens > 0) {
            IJurorsRegistry jurorsRegistry = _jurorsRegistry();
            jurorsRegistry.burnTokens(_collectedTokens);
        }

        // Reimburse juror fees to the Arbtirable subject for round 0 or to the previous appeal parties for other rounds.
        // Note that if the given round is not the first round, we can ensure there was an appeal in the previous round.
        if (_roundId == 0) {
            _courtTreasury.assign(_feeToken, address(_dispute.subject), _round.jurorFees);
        } else {
            uint256 refundFees = _round.jurorFees / 2;
            Appeal storage triggeringAppeal = _dispute.rounds[_roundId - 1].appeal;
            _courtTreasury.assign(_feeToken, triggeringAppeal.maker, refundFees);
            _courtTreasury.assign(_feeToken, triggeringAppeal.taker, refundFees);
        }
    }
}
