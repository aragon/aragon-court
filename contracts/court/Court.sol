pragma solidity ^0.5.8;

// Inspired by: Kleros.sol https://github.com/kleros/kleros @ 7281e69
import "@aragon/os/contracts/lib/token/ERC20.sol";
import "@aragon/os/contracts/common/SafeERC20.sol";
import "@aragon/os/contracts/lib/math/SafeMath.sol";
import "@aragon/os/contracts/common/Uint256Helpers.sol";
import "@aragon/os/contracts/common/TimeHelpers.sol";

import "./IAccounting.sol";
import "../lib/PctHelpers.sol";
import "../voting/ICRVoting.sol";
import "../voting/ICRVotingOwner.sol";
import "../arbitration/Arbitrable.sol";
import "../arbitration/IArbitrable.sol";
import "../registry/IJurorsRegistry.sol";
import "../registry/IJurorsRegistryOwner.sol";
import "../subscriptions/ISubscriptions.sol";
import "../subscriptions/ISubscriptionsOwner.sol";


contract Court is IJurorsRegistryOwner, ICRVotingOwner, ISubscriptionsOwner, TimeHelpers {
    using SafeERC20 for ERC20;
    using SafeMath for uint256;
    using PctHelpers for uint256;
    using Uint256Helpers for uint256;

    // Configs-related error messages
    string private constant ERROR_SENDER_NOT_VOTING = "CT_SENDER_NOT_VOTING";
    string private constant ERROR_BAD_FIRST_TERM_START_TIME = "CT_BAD_FIRST_TERM_START_TIME";
    string private constant ERROR_CONFIG_PERIOD_ZERO_TERMS = "CT_CONFIG_PERIOD_0";
    string private constant ERROR_INVALID_PENALTY_PCT = "CT_INVALID_PENALTY_PCT";
    string private constant ERROR_INVALID_MAX_APPEAL_ROUNDS = "CT_INVALID_MAX_APPEAL_ROUNDS";
    string private constant ERROR_INVALID_PERIOD_DURATION = "CT_INVALID_PERIOD_DURATION";
    string private constant ERROR_INVALID_GOVERNANCE_SHARE = "CT_INVALID_GOVERNANCE_SHARE";
    string private constant ERROR_INVALID_LATE_PAYMENT_PENALTY = "CT_INVALID_LATE_PAYMENT_PENALTY";

    // Terms-related error messages
    string private constant ERROR_TERM_OUTDATED = "CT_TERM_OUTDATED";
    string private constant ERROR_TOO_MANY_TRANSITIONS = "CT_TOO_MANY_TRANSITIONS";
    string private constant ERROR_INVALID_TRANSITION_TERMS = "CT_INVALID_TRANSITION_TERMS";
    string private constant ERROR_PAST_TERM_FEE_CHANGE = "CT_PAST_TERM_FEE_CHANGE";
    string private constant ERROR_TERM_RANDOMNESS_NOT_YET = "CT_TERM_RANDOMNESS_NOT_YET";
    string private constant ERROR_TERM_DOES_NOT_EXIST = "CT_TERM_DOES_NOT_EXIST";
    string private constant ERROR_TERM_RANDOMNESS_NOT_AVAILABLE = "CT_TERM_RANDOMNESS_NOT_AVAILABLE";

    // Disputes-related error messages
    string private constant ERROR_DISPUTE_DOES_NOT_EXIST = "CT_DISPUTE_DOES_NOT_EXIST";
    string private constant ERROR_CANNOT_CREATE_DISPUTE = "CT_CANNOT_CREATE_DISPUTE";
    string private constant ERROR_INVALID_DISPUTE_STATE = "CT_INVALID_DISPUTE_STATE";
    string private constant ERROR_INVALID_RULING_OPTIONS = "CT_INVALID_RULING_OPTIONS";
    string private constant ERROR_SUBSCRIPTION_NOT_PAID = "CT_SUBSCRIPTION_NOT_PAID";
    string private constant ERROR_DEPOSIT_FAILED = "CT_DEPOSIT_FAILED";

    // Rounds-related error messages
    string private constant ERROR_ROUND_IS_FINAL = "CT_ROUND_IS_FINAL";
    string private constant ERROR_ROUND_DOES_NOT_EXIST = "CT_ROUND_DOES_NOT_EXIST";
    string private constant ERROR_INVALID_ADJUDICATION_STATE = "CT_INVALID_ADJUDICATION_STATE";
    string private constant ERROR_ROUND_ALREADY_DRAFTED = "CT_ROUND_ALREADY_DRAFTED";
    string private constant ERROR_ROUND_NOT_DRAFT_TERM = "CT_ROUND_NOT_DRAFT_TERM";
    string private constant ERROR_ROUND_NOT_APPEALED = "CT_ROUND_NOT_APPEALED";
    string private constant ERROR_INVALID_APPEAL_RULING = "CT_INVALID_APPEAL_RULING";

    // Settlements-related error messages
    string private constant ERROR_PREV_ROUND_NOT_SETTLED = "CT_PREVIOUS_ROUND_NOT_SETTLED";
    string private constant ERROR_ROUND_ALREADY_SETTLED = "CT_ROUND_ALREADY_SETTLED";
    string private constant ERROR_ROUND_NOT_SETTLED = "CT_ROUND_PENALTIES_NOT_SETTLED";
    string private constant ERROR_JUROR_ALREADY_REWARDED = "CT_JUROR_ALREADY_REWARDED";
    string private constant ERROR_WONT_REWARD_NON_VOTER_JUROR = "CT_WONT_REWARD_NON_VOTER_JUROR";
    string private constant ERROR_WONT_REWARD_INCOHERENT_JUROR = "CT_WONT_REWARD_INCOHERENT_JUROR";
    string private constant ERROR_ROUND_APPEAL_ALREADY_SETTLED = "CT_APPEAL_ALREADY_SETTLED";

    // Initial term to start the Court, disputes are not allowed during this term. It can be used to active jurors
    uint64 internal constant ZERO_TERM_ID = 0;

    // Maximum number of term transitions a callee may have to assume in order to call certain functions that require the Court being up-to-date
    uint64 internal constant MAX_AUTO_TERM_TRANSITIONS_ALLOWED = 1;

    // Minimum possible rulings for a dispute
    uint8 internal constant MIN_RULING_OPTIONS = 2;

    // Maximum possible rulings for a dispute, equal to minimum limit
    uint8 internal constant MAX_RULING_OPTIONS = MIN_RULING_OPTIONS;

    // Multiple of juror fees required to appeal a preliminary ruling
    uint8 internal constant APPEAL_COLLATERAL_FACTOR = 3;

    // Multiple of juror fees required to confirm appeal
    uint8 internal constant APPEAL_CONFIRMATION_COLLATERAL_FACTOR = 2;

    // Cap the max number of regular appeal rounds
    uint256 internal constant MAX_REGULAR_APPEAL_ROUNDS_LIMIT = 10;

    // Precision factor used to improve rounding when computing weights for the final round
    uint256 internal constant FINAL_ROUND_WEIGHT_PRECISION = 1000;

    enum DisputeState {
        PreDraft,
        Adjudicating,
        Executed
    }

    enum AdjudicationState {
        Invalid,
        Committing,
        Revealing,
        Appealing,
        ConfirmingAppeal,
        Ended
    }

    /**
    * TODO: document
    */
    struct CourtConfig {
        // Fee structure
        ERC20 feeToken;             // ERC20 token to be used for the fees of the Court
        uint256 jurorFee;           // per juror, total round juror fee = jurorFee * jurors drawn
        uint256 heartbeatFee;       // per dispute, total heartbeat fee = heartbeatFee * disputes/appeals in term
        uint256 draftFee;           // per juror, total round draft fee = draftFee * jurors drawn
        uint256 settleFee;          // per juror, total round draft fee = settleFee * jurors drawn
        // Dispute config
        uint64 commitTerms;         // committing period duration in terms
        uint64 revealTerms;         // revealing period duration in terms
        uint64 appealTerms;         // appealing period duration in terms
        uint64 appealConfirmTerms;  // confirmation appeal period duration in terms
        uint16 penaltyPct;          // per ten thousand that will be used to compute the tokens to be locked for a juror on a draft
        uint16 finalRoundReduction; // ‱ of reduction applied for final appeal round (1/10,000)
        uint64 appealStepFactor;    // factor in which the jurors number is increased on each appeal
        uint32 maxRegularAppealRounds; // before the final appeal
    }

    struct Term {
        uint64 startTime;           // Timestamp when the term started
        uint64 dependingDrafts;     // Adjudication rounds pegged to this term for randomness
        uint64 courtConfigId;       // Fee structure for this term (index in courtConfigs array)
        uint64 randomnessBN;        // Block number for entropy
        bytes32 randomness;         // Entropy from randomnessBN block hash
    }

    struct Dispute {
        IArbitrable subject;        // Arbitrable associated to a dispute
        uint8 possibleRulings;      // Number of possible rulings jurors can vote for each dispute
        uint8 finalRuling;          // Winning ruling of a dispute
        DisputeState state;         // State of a dispute: pre-draft, adjudicating, or executed
        AdjudicationRound[] rounds; // List of rounds for each dispute
    }

    struct AdjudicationRound {
        uint64 draftTermId;         // Term from which the jurors of a round can be drafted
        uint64 jurorsNumber;        // Number of jurors drafted for a round
        address triggeredBy;        // Address that triggered a round
        bool settledPenalties;      // Whether or not penalties have been settled for a round
        uint256 jurorFees;          // Total amount of fees to be distributed between the winning jurors of a round
        address[] jurors;           // List of jurors drafted for a round
        mapping (address => JurorState) jurorsStates; // List of states for each drafted juror indexed by address
        uint64 delayedTerms;        // Number of terms a round was delayed based on its requested draft term id
        uint64 selectedJurors;      // Number of jurors selected for a round, to allow drafts to be batched
        uint64 coherentJurors;      // Number of drafted jurors that voted in favor of the dispute final ruling
        uint64 settledJurors;       // Number of jurors whose rewards were already settled
        uint256 collectedTokens;    // Total amount of tokens collected from losing jurors
        Appeal appeal;              // Appeal-related information of a round
    }

    struct JurorState {
        uint64 weight;              // Weight computed for a juror on a round
        bool rewarded;              // Whether or not a drafted juror was rewarded
    }

    struct Appeal {
        address maker;              // Address of the appealer
        uint8 appealedRuling;       // Ruling appealing in favor of
        address taker;              // Address of the one confirming an appeal
        uint8 opposedRuling;        // Ruling opposed to an appeal
        bool settled;               // Whether or not an appeal has been settled
    }

    // Duration in seconds for each term of the Court
    uint64 public termDuration;

    // Registry of jurors participating in the Court
    IJurorsRegistry internal jurorsRegistry;

    // Accounting contract handling the assets of the Court
    IAccounting internal accounting;

    // Commit-Reveal voting instance to be used by jurors to vote for the disputes handled by the Court
    ICRVoting internal voting;

    // Court subscriptions registry
    ISubscriptions internal subscriptions;

    // Governor of the court, address allowed to change the Court configs
    // TODO: consider using aOS' ACL
    address internal governor;

    // List of all the configs used in the Court
    CourtConfig[] public courtConfigs;

    // Future term id in which a config change has been scheduled
    uint64 public configChangeTermId;

    // Last ensured term id
    uint64 internal termId;

    // List of Court terms indexed by id
    mapping (uint64 => Term) internal terms;

    // List of all the disputes created in the Court
    Dispute[] internal disputes;

    event NewTerm(uint64 termId, address indexed heartbeatSender);
    event NewCourtConfig(uint64 fromTermId, uint64 courtConfigId);
    event DisputeStateChanged(uint256 indexed disputeId, DisputeState indexed state);
    event NewDispute(uint256 indexed disputeId, address indexed subject, uint64 indexed draftTermId, uint64 jurorsNumber);
    event RulingAppealed(uint256 indexed disputeId, uint256 indexed roundId, uint8 ruling);
    event RulingAppealConfirmed(uint256 indexed disputeId, uint256 indexed roundId, uint64 indexed draftTermId, uint256 jurorsNumber);
    event RulingExecuted(uint256 indexed disputeId, uint8 indexed ruling);
    event PenaltiesSettled(uint256 indexed disputeId, uint256 indexed roundId, uint256 collectedTokens);
    event RewardSettled(uint256 indexed disputeId, uint256 indexed roundId, address juror);
    event AppealDepositSettled(uint256 indexed disputeId, uint256 indexed roundId);

    /**
    * @dev Ensure the msg.sender is the CR Voting module
    */
    modifier onlyVoting() {
        require(msg.sender == address(voting), ERROR_SENDER_NOT_VOTING);
        _;
    }

    /**
    * @dev Ensure the current term of the Court. If the Court term is outdated by one term it will be updated. Note that this function only
    *      allows updating the Court by one term, if more terms are required, users will have to call the heartbeat function manually.
    */
    modifier ensureTerm {
        _ensureTerm();
        _;
    }

    /**
    * @dev Ensure a dispute exists
    * @param _id Identification number of the dispute to be ensured
    */
    modifier disputeExists(uint256 _id) {
        require(_id < disputes.length, ERROR_DISPUTE_DOES_NOT_EXIST);
        _;
    }

    /**
    * @dev Ensure a dispute round exists
    * @param _disputeId Identification number of the dispute to be ensured
    * @param _roundId Identification number of the dispute round to be ensured
    */
    modifier roundExists(uint256 _disputeId, uint256 _roundId) {
        require(_disputeId < disputes.length, ERROR_DISPUTE_DOES_NOT_EXIST);
        require(_roundId < disputes[_disputeId].rounds.length, ERROR_ROUND_DOES_NOT_EXIST);
        _;
    }

    /**
    * @param _termDuration Duration in seconds per term (recommended 1 hour)
    * @param _tokens Array containing:
    *        _jurorToken The address of the juror work token contract.
    *        _feeToken The address of the token contract that is used to pay for fees.
    * @param _jurorsRegistry The address of the JurorsRegistry component of the Court
    * @param _voting The address of the Commit Reveal Voting contract.
    * @param _fees Array containing:
    *        _jurorFee The amount of _feeToken that is paid per juror per dispute
    *        _heartbeatFee The amount of _feeToken per dispute to cover maintenance costs.
    *        _draftFee The amount of _feeToken per juror to cover the drafting cost.
    *        _settleFee The amount of _feeToken per juror to cover round settlement cost.
    * @param _governor Address of the governor contract.
    * @param _firstTermStartTime Timestamp in seconds when the court will open (to give time for juror onboarding)
    * @param _minJurorsActiveBalance Minimum amount of juror tokens that can be activated
    * @param _roundStateDurations Number of terms that the different states a dispute round last
    * @param _pcts Array containing:
    *        _penaltyPct ‱ of minJurorsActiveBalance that can be slashed (1/10,000)
    *        _finalRoundReduction ‱ of fee reduction for the last appeal round (1/10,000)
    * @param _subscriptionParams Array containing params for Subscriptions:
    *        _periodDuration Length of Subscription periods
    *        _feeAmount Amount of periodic fees
    *        _prePaymentPeriods Max number of payments that can be done in advance
    *        _latePaymentPenaltyPct Penalty for not paying on time
    *        _governorSharePct Share of paid fees that goes to governor
    */
    constructor(
        uint64 _termDuration,
        ERC20[2] memory _tokens, // _jurorToken, _feeToken
        IJurorsRegistry _jurorsRegistry,
        IAccounting _accounting,
        ICRVoting _voting,
        ISubscriptions _subscriptions,
        uint256[4] memory _fees, // _jurorFee, _heartbeatFee, _draftFee, _settleFee
        address _governor,
        uint64 _firstTermStartTime,
        uint256 _minJurorsActiveBalance,
        uint64[4] memory _roundStateDurations,
        uint16[2] memory _pcts, //_penaltyPct, _finalRoundReduction
        uint64 _appealStepFactor,
        uint32 _maxRegularAppealRounds,
        uint256[5] memory _subscriptionParams // _periodDuration, _feeAmount, _prePaymentPeriods, _latePaymentPenaltyPct, _governorSharePct
    ) public {
        require(_firstTermStartTime >= getTimestamp64() + _termDuration, ERROR_BAD_FIRST_TERM_START_TIME);

        termDuration = _termDuration;
        jurorsRegistry = _jurorsRegistry;
        accounting = _accounting;
        voting = _voting;
        subscriptions = _subscriptions;
        governor = _governor;

        //                                  _jurorToken
        _initJurorsRegistry(_jurorsRegistry, _tokens[0], _minJurorsActiveBalance);
        accounting.init(address(this));
        voting.init(ICRVotingOwner(this));
        //                 _jurorToken
        _initSubscriptions(_tokens[0], _subscriptionParams);

        courtConfigs.length = 1; // leave index 0 empty
        _setCourtConfig(
            ZERO_TERM_ID,
            _tokens[1], // _feeToken
            _fees,
            _roundStateDurations,
            _pcts[0], // _penaltyPct
            _pcts[1],  // _finalRoundReduction
            _appealStepFactor,
            _maxRegularAppealRounds
        );
        terms[ZERO_TERM_ID].startTime = _firstTermStartTime - _termDuration;
    }

    /**
    * @notice Create a dispute over `_subject` with `_possibleRulings` possible rulings, drafting `_jurorsNumber` jurors in term `_draftTermId`
    * @dev Create a dispute to be drafted in a future term
    * @param _subject Arbitrable subject being disputed
    * @param _possibleRulings Number of possible rulings allowed for the drafted jurors to vote on the dispute
    * @param _jurorsNumber Requested number of jurors to be drafted for the dispute
    * @param _draftTermId Term from which the the jurors for the dispute will be drafted
    * @return Dispute identification number
    */
    function createDispute(IArbitrable _subject, uint8 _possibleRulings, uint64 _jurorsNumber, uint64 _draftTermId) external ensureTerm
        returns (uint256)
    {
        // TODO: Limit the min amount of terms before drafting (to allow for evidence submission)
        // TODO: Limit the max amount of terms into the future that a dispute can be drafted
        // TODO: Limit the max number of initial jurors
        // TODO: ERC165 check that _subject conforms to the Arbitrable interface
        // TODO: require(address(_subject) == msg.sender, ERROR_INVALID_DISPUTE_CREATOR);
        require(_draftTermId > termId, ERROR_CANNOT_CREATE_DISPUTE);
        require(subscriptions.isUpToDate(address(_subject)), ERROR_SUBSCRIPTION_NOT_PAID);
        require(_possibleRulings >= MIN_RULING_OPTIONS && _possibleRulings <= MAX_RULING_OPTIONS, ERROR_INVALID_RULING_OPTIONS);

        // Create the dispute
        uint256 disputeId = disputes.length++;
        Dispute storage dispute = disputes[disputeId];
        dispute.subject = _subject;
        dispute.possibleRulings = _possibleRulings;
        emit NewDispute(disputeId, address(_subject), _draftTermId, _jurorsNumber);

        // Create first adjudication round of the dispute
        (ERC20 feeToken, uint256 jurorFees, uint256 totalFees) = _getRegularRoundFees(_draftTermId, _jurorsNumber);
        _createRound(disputeId, DisputeState.PreDraft, _draftTermId, _jurorsNumber, jurorFees);

        // Pay round fees and return dispute id
        _depositSenderAmount(feeToken, totalFees);
        return disputeId;
    }

    /**
     * @notice Draft jurors for the next round of dispute #`_disputeId`
     * @param _disputeId Identification number of the dispute to be drafted
     * @param _maxJurorsToBeDrafted Max number of jurors to be drafted, it will be capped to the requested number of jurors of the dispute
     */
    function draft(uint256 _disputeId, uint64 _maxJurorsToBeDrafted) external disputeExists(_disputeId) {
        // Drafts can only be computed when the Court is up-to-date. Note that forcing a term transition won't work since the term randomness
        // is always based on the next term which means it won't be available anyway.
        uint64 requiredTransitions = _neededTermTransitions();
        require(uint256(requiredTransitions) == 0, ERROR_TERM_OUTDATED);

        // Ensure dispute has not been drafted yet
        Dispute storage dispute = disputes[_disputeId];
        require(dispute.state == DisputeState.PreDraft, ERROR_ROUND_ALREADY_DRAFTED);

        // Ensure round can be drafted in the current term
        AdjudicationRound storage round = dispute.rounds[dispute.rounds.length - 1];
        uint64 requestedDraftTermId = round.draftTermId;
        uint64 currentTermId = termId;
        require(requestedDraftTermId <= currentTermId, ERROR_ROUND_NOT_DRAFT_TERM);

        // Ensure current term randomness can be ensured for the current block number
        Term storage draftTerm = terms[currentTermId];
        _ensureTermRandomness(draftTerm);

        // Draft the min number of jurors between the one requested by the sender and the one requested by the disputer
        uint64 jurorsNumber = round.jurorsNumber;
        uint64 selectedJurors = round.selectedJurors;
        uint64 jurorsToBeDrafted = jurorsNumber - selectedJurors;
        uint256 requestedJurors = uint256(jurorsToBeDrafted < _maxJurorsToBeDrafted ? jurorsToBeDrafted : _maxJurorsToBeDrafted);

        // Draft jurors for the given dispute and reimburse fees
        CourtConfig storage config = _getConfigAtDraftTerm(round);
        _draft(_disputeId, round, jurorsNumber, requestedJurors, draftTerm, config);
        accounting.assign(config.feeToken, msg.sender, config.draftFee * requestedJurors);

        // If the drafting is over, update its state
        if (round.selectedJurors == jurorsNumber) {
            // Note that we can avoid using SafeMath here since we already ensured `termId` is greater than or equal to `round.draftTermId`
            round.delayedTerms = currentTermId - requestedDraftTermId;
            dispute.state = DisputeState.Adjudicating;
            emit DisputeStateChanged(_disputeId, dispute.state);
        }
    }

    /**
    * @notice Appeal round #`_roundId` of dispute #`_disputeId` in favor of ruling `_ruling`
    * @param _disputeId Identification number of the dispute being appealed
    * @param _roundId Identification number of the dispute round being appealed
    * @param _ruling Ruling appealing a dispute round in favor of
    */
    function createAppeal(uint256 _disputeId, uint256 _roundId, uint8 _ruling) external disputeExists(_disputeId) ensureTerm {
        // Ensure given round can be appealed. Note that if there was a final appeal the adjudication state will be 'Ended'.
        Dispute storage dispute = disputes[_disputeId];
        _checkAdjudicationState(dispute, _roundId, AdjudicationState.Appealing);

        // Ensure that the ruling being appealed in favor of is valid and different from the current winning ruling
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
        (,,, ERC20 feeToken,,, uint256 appealDeposit,) = _getNextRoundDetails(round, _roundId);
        _depositSenderAmount(feeToken, appealDeposit);
    }

    /**
    * @notice Confirm appeal for round #`_roundId` of dispute #`_disputeId` in favor of ruling `_ruling`
    * @param _disputeId Identification number of the dispute confirming an appeal of
    * @param _roundId Identification number of the dispute round confirming an appeal of
    * @param _ruling Ruling being confirmed against a dispute round appeal
    */
    function confirmAppeal(uint256 _disputeId, uint256 _roundId, uint8 _ruling) external ensureTerm {
        // TODO: ensure dispute exists
        // Ensure given round is appealed and can be confirmed. Note that if there was a final appeal the adjudication state will be 'Ended'.
        Dispute storage dispute = disputes[_disputeId];
        _checkAdjudicationState(dispute, _roundId, AdjudicationState.ConfirmingAppeal);

        // Ensure that the ruling being confirmed in favor of is valid and different from the appealed ruling
        AdjudicationRound storage round = dispute.rounds[_roundId];
        Appeal storage appeal = round.appeal;
        uint256 voteId = _getVoteId(_disputeId, _roundId);
        require(appeal.appealedRuling != _ruling && voting.isValidOutcome(voteId, _ruling), ERROR_INVALID_APPEAL_RULING);

        // Create a new adjudication round for the dispute
        (uint64 nextRoundStartTerm,
        uint64 nextRoundJurorsNumber,
        DisputeState newDisputeState,
        ERC20 feeToken,,
        uint256 jurorFees,,
        uint256 confirmAppealDeposit) = _getNextRoundDetails(round, _roundId);
        uint256 newRoundId = _createRound(_disputeId, newDisputeState, nextRoundStartTerm, nextRoundJurorsNumber, jurorFees);

        // Update previous round appeal state
        appeal.taker = msg.sender;
        appeal.opposedRuling = _ruling;
        emit RulingAppealConfirmed(_disputeId, newRoundId, nextRoundStartTerm, nextRoundJurorsNumber);

        // Pay appeal confirm deposit
        _depositSenderAmount(feeToken, confirmAppealDeposit);
    }

    /**
    * @notice Execute the arbitrable associated to dispute #`_disputeId` based on its final ruling
    * @param _disputeId Identification number of the dispute to be executed
    */
    function executeRuling(uint256 _disputeId) external disputeExists(_disputeId) ensureTerm {
        Dispute storage dispute = disputes[_disputeId];
        require(dispute.state != DisputeState.Executed, ERROR_INVALID_DISPUTE_STATE);

        uint8 finalRuling = _ensureFinalRuling(_disputeId);
        dispute.state = DisputeState.Executed;
        dispute.subject.rule(_disputeId, uint256(finalRuling));
        emit RulingExecuted(_disputeId, finalRuling);
    }

    /**
    * @notice Settle penalties for round #`_roundId` of dispute #`_disputeId`
    * @dev In case of a regular round, all the drafted jurors that didn't vote in favor of the final ruling of the given dispute will be slashed.
    *      For final rounds, jurors are slashed when voting, thus it will considered these rounds settled at once. Rewards have to be manually
    *      claimed through `settleReward` which will return pre-slashed tokens for the winning jurors of a final round as well.
    * @param _disputeId Identification number of the dispute to settle penalties for
    * @param _roundId Identification number of the dispute round to settle penalties for
    * @param _jurorsToSettle Maximum number of jurors to be slashed in this call. It can be set to zero to slash all the losing jurors of the
    *        given round. This argument is only used when settling regular rounds.
    */
    function settlePenalties(uint256 _disputeId, uint256 _roundId, uint256 _jurorsToSettle) external ensureTerm {
        // TODO: ensure round exists
        // Enforce that rounds are settled in order to avoid one round without incentive to settle. Even if there is a settleFee
        // it may not be big enough and all jurors in the round could be slashed.
        Dispute storage dispute = disputes[_disputeId];
        require(_roundId == 0 || dispute.rounds[_roundId - 1].settledPenalties, ERROR_PREV_ROUND_NOT_SETTLED);

        // Ensure given round has not been settled yet
        AdjudicationRound storage round = dispute.rounds[_roundId];
        require(!round.settledPenalties, ERROR_ROUND_ALREADY_SETTLED);

        // Set the number of jurors that voted in favor of the final ruling if we haven't started settling yet
        uint8 finalRuling = _ensureFinalRuling(_disputeId);
        uint256 voteId = _getVoteId(_disputeId, _roundId);
        if (round.settledJurors == 0) {
            // Note that we are safe to cast the tally of a ruling to uint64 since the highest value a ruling can have is
            // `jurorsNumbers` for regular rounds or total active balance of the registry for final rounds, and both are
            // ensured to fit in uint64
            round.coherentJurors = uint64(voting.getOutcomeTally(voteId, finalRuling));
        }

        CourtConfig storage config = _getConfigAtDraftTerm(round);
        if (_isRegularRound(_roundId, config)) {
            // For regular appeal rounds we compute the amount of locked tokens that needs to get burned in batches.
            // The callers of this function will get rewarded in this case.
            uint256 jurorsSettled = _settleRegularRoundPenalties(round, voteId, finalRuling, config.penaltyPct, _jurorsToSettle);
            accounting.assign(config.feeToken, msg.sender, config.settleFee * jurorsSettled);
        } else {
            // For the final appeal round, there is no need to settle in batches since, to guarantee scalability,
            // all the tokens collected from jurors participating in the final round are burned, and those jurors who
            // voted in favor of the winning ruling can claim their collected tokens back along with their reward.
            // Note that the caller of this function is not being reimbursed.
            round.settledPenalties = true;
        }

        // Burn tokens and refund fees only if we finished settling all the jurors that voted in this round
        if (round.settledPenalties) {
            uint256 collectedTokens = round.collectedTokens;
            emit PenaltiesSettled(_disputeId, _roundId, collectedTokens);

            // If there wasn't at least one juror voting in favor of the winning ruling, we refund the creator of
            // this round and burn the collected tokens of the jurors to be slashed. Note that this will happen
            // only when there were no jurors voting in favor of the winning outcome. Otherwise, these tokens are
            // re-distributed between the winning jurors in `settleReward` instead of being burned.
            if (round.coherentJurors == 0) {
                if (collectedTokens > 0) {
                    jurorsRegistry.burnTokens(collectedTokens);
                }
                accounting.assign(config.feeToken, round.triggeredBy, round.jurorFees);
            }
        }
    }

    /**
    * @notice Claim reward for round #`_roundId` of dispute #`_disputeId` for juror `_juror`
    * @dev For regular rounds, it will only reward winning
    * @param _disputeId Identification number of the dispute to settle penalties for
    * @param _roundId Identification number of the dispute round to settle penalties for
    * @param _juror Identification number of the dispute round to settle penalties for
    */
    function settleReward(uint256 _disputeId, uint256 _roundId, address _juror) external ensureTerm {
        // TODO: ensure round exists
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
        uint256 voteId = _getVoteId(_disputeId, _roundId);
        require(voting.hasVotedInFavorOf(voteId, dispute.finalRuling, _juror), ERROR_WONT_REWARD_INCOHERENT_JUROR);

        // Distribute the collected tokens of the jurors that were slashed weighted by the winning jurors. Note that
        // we are penalizing jurors that refused intentionally their vote for the final round.
        uint256 coherentJurors = round.coherentJurors;
        uint256 collectedTokens = round.collectedTokens;
        if (collectedTokens > 0) {
            jurorsRegistry.assignTokens(_juror, jurorState.weight * collectedTokens / coherentJurors);
        }

        // Reward the winning juror
        uint256 jurorFee = round.jurorFees * jurorState.weight / coherentJurors;
        CourtConfig storage config = _getConfigAtDraftTerm(round);
        accounting.assign(config.feeToken, _juror, jurorFee);
        emit RewardSettled(_disputeId, _roundId, _juror);
    }

    /**
    * @notice Settle appeal deposits for round #`_roundId` of dispute #`_disputeId`
    * @param _disputeId Identification number of the dispute to settle appeal deposits for
    * @param _roundId Identification number of the dispute round to settle appeal deposits for
    */
    function settleAppealDeposit(uint256 _disputeId, uint256 _roundId) external ensureTerm {
        // TODO: ensure round exists
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

        // If the appeal wasn't confirmed, return the entire deposit to appeal maker
        (,,,ERC20 feeToken, uint256 totalFees,, uint256 appealDeposit, uint256 confirmAppealDeposit) = _getNextRoundDetails(round, _roundId);
        if (!_isAppealConfirmed(appeal)) {
            accounting.assign(feeToken, appeal.maker, appealDeposit);
            return;
        }

        // If the appeal was confirmed pay the winner the total deposit or split it between both in case no one voted in favor
        // of the winning outcome. Since we already ensured that round penalties were settled, we are safe to access the dispute final ruling
        uint8 finalRuling = dispute.finalRuling;
        uint256 totalDeposit = appealDeposit + confirmAppealDeposit;
        if (appeal.appealedRuling == finalRuling) {
            accounting.assign(feeToken, appeal.maker, totalDeposit - totalFees);
        } else if (appeal.opposedRuling == finalRuling) {
            accounting.assign(feeToken, appeal.taker, totalDeposit - totalFees);
        } else {
            // If the final ruling wasn't selected by any of the appealing parties or no jurors voted in the
            // final round, return their deposits minus half of the fees to each party
            accounting.assign(feeToken, appeal.maker, appealDeposit - totalFees / 2);
            accounting.assign(feeToken, appeal.taker, confirmAppealDeposit - totalFees / 2);
        }
    }

    /**
    * @notice Get the weight of `_voter` for vote #`_voteId` and check if votes can be committed
    * @param _voteId ID of the vote instance to request the weight of a voter for
    * @param _voter Address of the voter querying the weight of
    * @return Weight of the requested juror for the requested dispute's round
    */
    function getVoterWeightToCommit(uint256 _voteId, address _voter) external onlyVoting ensureTerm returns (uint64) {
        (uint256 disputeId, uint256 roundId) = _decodeVoteId(_voteId);
        Dispute storage dispute = disputes[disputeId];
        _checkAdjudicationState(dispute, roundId, AdjudicationState.Committing);
        return _computeJurorWeight(dispute, roundId, _voter);
    }

    /**
    * @notice Get the weight of `_voter` for vote #`_voteId` and check if votes can be revealed
    * @param _voteId ID of the vote instance to request the weight of a voter for
    * @param _voter Address of the voter querying the weight of
    * @return Weight of the requested juror for the requested dispute's round
    */
    function getVoterWeightToReveal(uint256 _voteId, address _voter) external onlyVoting ensureTerm returns (uint64) {
        (uint256 disputeId, uint256 roundId) = _decodeVoteId(_voteId);
        Dispute storage dispute = disputes[disputeId];
        _checkAdjudicationState(dispute, roundId, AdjudicationState.Revealing);
        return _computeJurorWeight(dispute, roundId, _voter);
    }

    /**
    * @dev Tell and ensure the current term of the court.
    * @return Identification number of the last ensured term
    */
    function ensureAndGetTermId() external ensureTerm returns (uint64) {
        return termId;
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
        return _getCurrentTermId();
    }

    /**
    * @dev Tell the number of terms the Court should transition to be up-to-date
    * @return Number of terms the Court should transition to be up-to-date
    */
    function neededTermTransitions() external view returns (uint64) {
        return _neededTermTransitions();
    }

    /**
    * @dev Tell the information related to a term based on its ID. Note that if the term has not been reached, the
    *      information returned won't be computed yet.
    * @param _termId ID of the term being queried
    * @return Term start time
    * @return Number of drafts depending on the requested term
    * @return ID of the court configuration associated to the requested term
    * @return Block number used for randomness in the requested term
    * @return Randomness computed for the requested term
    */
    function getTerm(uint64 _termId) external view
        returns (uint64 startTime, uint64 dependingDrafts, uint64 courtConfigId, uint64 randomnessBN, bytes32 randomness)
    {
        // We allow querying future terms that were not computed yet
        Term storage term = terms[_termId];
        return (term.startTime, term.dependingDrafts, term.courtConfigId, term.randomnessBN, term.randomness);
    }

    /**
    * @dev Tell the randomness of a term even if it wasn't computed yet
    * @param _termId ID of the term being queried
    * @return Randomness of the requested term
    */
    function getTermRandomness(uint64 _termId) external view returns (bytes32) {
        require(_termId <= termId, ERROR_TERM_DOES_NOT_EXIST);
        Term storage term = terms[_termId];
        return _getTermRandomness(term);
    }

    /**
    * @dev Tell the address of the Court governor
    * @return Address of the Court governor
    */
    function getGovernor() external view returns (address) {
        return governor;
    }

    /**
    * @dev Tell information of a certain dispute
    * @param _disputeId Identification number of the dispute being queried
    * @return subject Arbitrable subject being disputed
    * @return possibleRulings Number of possible rulings allowed for the drafted jurors to vote on the dispute
    * @return state Current state of the dispute being queried: pre-draft, adjudicating, or executed
    * @return finalRuling The winning ruling in case the dispute is finished
    * @return lastRoundId Identification number of the last round created for the dispute
    */
    function getDispute(uint256 _disputeId) external view disputeExists(_disputeId)
        returns (IArbitrable subject, uint8 possibleRulings, DisputeState state, uint8 finalRuling, uint256 lastRoundId)
    {
        Dispute storage dispute = disputes[_disputeId];

        subject = dispute.subject;
        possibleRulings = dispute.possibleRulings;
        state = dispute.state;
        finalRuling = dispute.finalRuling;
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
    * @return triggeredBy Address that triggered the requested round
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
            address triggeredBy,
            bool settledPenalties,
            uint256 collectedTokens,
            uint64 coherentJurors,
            AdjudicationState state
        )
    {
        Dispute storage dispute = disputes[_disputeId];
        AdjudicationRound storage round = dispute.rounds[_roundId];

        state = _adjudicationStateAt(dispute, _roundId, _getCurrentTermId());
        draftTerm = round.draftTermId;
        delayedTerms = round.delayedTerms;
        jurorsNumber = round.jurorsNumber;
        selectedJurors = round.selectedJurors;
        triggeredBy = round.triggeredBy;
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
    function getAppeal(uint256 _disputeId, uint256 _roundId) external view
        returns (
            address maker,
            uint64 appealedRuling,
            address taker,
            uint64 opposedRuling
        )
    {
        Appeal storage appeal = disputes[_disputeId].rounds[_roundId].appeal;

        maker = appeal.maker;
        appealedRuling = appeal.appealedRuling;
        taker = appeal.taker;
        opposedRuling = appeal.opposedRuling;
    }

    /**
    * @dev Tell the amount of token fees required to create a dispute
    * @param _draftTermId Term id in which the dispute will be drafted
    * @param _jurorsNumber Number of jurors to be drafted for the dispute
    * @return feeToken ERC20 token used for the fees
    * @return jurorFees Total amount of fees to be distributed between the winning jurors of a round
    * @return totalFees Total amount of fees for a regular round at the given term
    */
    function getDisputeFees(uint64 _draftTermId, uint64 _jurorsNumber) external view
        returns (ERC20 feeToken, uint256 jurorFees, uint256 totalFees)
    {
        require(_draftTermId > termId, ERROR_CANNOT_CREATE_DISPUTE);
        return _getRegularRoundFees(_draftTermId, _jurorsNumber);
    }

    /**
    * @dev Tell information related to the next round due to an appeal of a certain round given.
    * @param _disputeId Identification number of the dispute being queried
    * @param _roundId Identification number of the round requesting the appeal details of
    * @return nextRoundStartTerm Term id from which the next round will start
    * @return nextRoundJurorsNumber Jurors number for the next round
    * @return newDisputeState New state for the dispute associated to the given round after the appeal
    * @return feeToken ERC20 token used for the next round fees
    * @return jurorFees Total amount of fees to be distributed between the winning jurors of the next round
    * @return totalFees Total amount of fees for a regular round at the given term
    * @return appealDeposit Amount to be deposit of fees for a regular round at the given term
    * @return confirmAppealDeposit Total amount of fees for a regular round at the given term
    */
    function getNextRoundDetails(uint256 _disputeId, uint256 _roundId) external view roundExists(_disputeId, _roundId)
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
        Dispute storage dispute = disputes[_disputeId];
        AdjudicationRound storage round = dispute.rounds[_roundId];
        CourtConfig storage config = _getConfigAtDraftTerm(round);
        require(_isRegularRound(_roundId, config), ERROR_ROUND_IS_FINAL);
        return _getNextRoundDetails(round, _roundId);
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
        weight = _getJurorWeight(_disputeId, _roundId, _juror);
        rewarded = disputes[_disputeId].rounds[_roundId].jurorsStates[_juror].rewarded;
    }

    /**
    * @notice Send a heartbeat to the Court to transition up to `_maxRequestedTransitions` terms
    * @param _maxRequestedTransitions Max number of term transitions allowed by the sender
    */
    function heartbeat(uint64 _maxRequestedTransitions) public {
        uint64 neededTransitions = _neededTermTransitions();
        uint256 transitions = uint256(_maxRequestedTransitions < neededTransitions ? _maxRequestedTransitions : neededTransitions);
        require(transitions > 0, ERROR_INVALID_TRANSITION_TERMS);

        // Transition the minimum number of terms between the amount requested and the amount actually needed
        uint256 totalFee;
        CourtConfig storage config = _getConfigSafeAt(termId);
        for (uint256 transition = 1; transition <= transitions; transition++) {
            // Term IDs are incremented by one based on the number of time periods since the Court started. Since time is represented in uint64,
            // even if we chose the minimum duration possible for a term (1 second), we can ensure terms will never reach 2^64 since time is
            // already assumed to fit in uint64.
            Term storage previousTerm = terms[termId++];
            uint64 currentTermId = termId;
            Term storage currentTerm = terms[currentTermId];

            // TODO: allow config to be changed for a future term id
            currentTerm.courtConfigId = previousTerm.courtConfigId;
            // Set the start time of the new term. Note that we are using a constant term duration value to guarantee
            // equally long terms, regardless of heartbeats.
            currentTerm.startTime = previousTerm.startTime + termDuration;
            // In order to draft a random number of jurors in a term, we use a randomness factor for each term based on a
            // block number that is set once the term has started. Note that this information could not be known beforehand.
            currentTerm.randomnessBN = getBlockNumber64() + 1;
            emit NewTerm(currentTermId, msg.sender);

            // Add amount of fees to be paid for the transitioned term
            config = _getConfigSafeAt(currentTermId);
            totalFee = totalFee.add(config.heartbeatFee.mul(uint256(currentTerm.dependingDrafts)));
        }

        // Pay heartbeat fees to the caller of this function
        if (totalFee > 0) {
            accounting.assign(config.feeToken, msg.sender, totalFee);
        }
    }

    /**
    * @dev Internal function to ensure the current term. If the Court term is outdated it will update it. Note that this function
    *      only allows updating the Court by one term, if more terms are required, users will have to call the heartbeat function manually.
    */
    function _ensureTerm() internal {
        uint64 requiredTransitions = _neededTermTransitions();
        require(requiredTransitions <= MAX_AUTO_TERM_TRANSITIONS_ALLOWED, ERROR_TOO_MANY_TRANSITIONS);

        if (uint256(requiredTransitions) > 0) {
            heartbeat(requiredTransitions);
        }
    }

    /**
    * @dev Internal function to ensure a certain term has its randomness set. As we allow to draft disputes requested for previous terms,
    *      if there were mined more than 256 blocks for the current term, the blockhash of its randomness BN is no longer available, given
    *      round will be able to be drafted in the following term.
    * @param _term Term to be checked
    */
    function _ensureTermRandomness(Term storage _term) internal {
        if (_term.randomness == bytes32(0)) {
            bytes32 newRandomness = _getTermRandomness(_term);
            require(newRandomness != bytes32(0), ERROR_TERM_RANDOMNESS_NOT_AVAILABLE);
            _term.randomness = newRandomness;
        }
    }

    /**
    * @dev Internal function to create a new round for a given dispute
    * @param _disputeId Identification number of the dispute to create a new round for
    * @param _disputeState New state for the dispute to be changed
    * @param _draftTermId Term id when the jurors for the new round will be drafted
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
        round.triggeredBy = msg.sender;

        // Register new draft for the requested term
        terms[_draftTermId].dependingDrafts += 1;

        // Create new vote for the new round
        uint256 voteId = _getVoteId(_disputeId, roundId);
        voting.create(voteId, dispute.possibleRulings);
        return roundId;
    }

    /**
    * @dev Internal function to ensure the final ruling of a dispute. It will compute it only if missing.
    * @param _disputeId Identification number of the dispute to ensure its final ruling
    * @return Number of the final ruling ensured for the given dispute
    */
    function _ensureFinalRuling(uint256 _disputeId) internal returns (uint8) {
        // Check if there was a final ruling already cached
        Dispute storage dispute = disputes[_disputeId];
        if (uint256(dispute.finalRuling) > 0) {
            return dispute.finalRuling;
        }

        // Ensure the last adjudication round has ended. Note that there will always be at least one round.
        uint256 lastRoundId = dispute.rounds.length - 1;
        _checkAdjudicationState(dispute, lastRoundId, AdjudicationState.Ended);

        // If the last adjudication round was appealed but no-one confirmed it, the final ruling is the outcome the
        // appealer vouched for. Otherwise, fetch the winning outcome from the voting app of the last round.
        AdjudicationRound storage lastRound = dispute.rounds[lastRoundId];
        Appeal storage lastAppeal = lastRound.appeal;
        bool isRoundAppealedAndNotConfirmed = _existsAppeal(lastAppeal) && !_isAppealConfirmed(lastAppeal);
        uint8 finalRuling = isRoundAppealedAndNotConfirmed
            ? lastAppeal.appealedRuling
            : voting.getWinningOutcome(_getVoteId(_disputeId, lastRoundId));

        // Store the winning ruling as the final decision for the given dispute
        dispute.finalRuling = finalRuling;
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
    * @return Number of jurors slashed for the given round
    */
    function _settleRegularRoundPenalties(
        AdjudicationRound storage _round,
        uint256 _voteId,
        uint8 _finalRuling,
        uint16 _penaltyPct,
        uint256 _jurorsToSettle
    )
        internal
        returns (uint256)
    {
        // The batch starts where the previous one ended, stored in _round.settledJurors
        uint256 roundSettledJurors = _round.settledJurors;
        // Compute the amount of jurors that are going to be settled in this batch, which is returned by the function for fees calculation
        // Initially we try to reach the end of the jurors array
        uint256 batchSettledJurors = _round.jurors.length - roundSettledJurors;

        // If the requested amount of jurors is not zero and it is lower that the remaining number of jurors to be settled for the given round,
        // we cap the number of jurors that are going to be settled in this batch to the requested amount. If not, we know we have reached the
        // last batch and we are safe to mark round penalties as settled.
        if (_jurorsToSettle > 0 && batchSettledJurors > _jurorsToSettle) {
            batchSettledJurors = _jurorsToSettle;
        } else {
            _round.settledPenalties = true;
        }

        // Update the number of round settled jurors. Note that we don't need to use SafeMath here since the highest number of jurors to be
        // settled for a round could be the `jurorsNumber` itself, which is a uint64 value.
        _round.settledJurors = uint64(roundSettledJurors + batchSettledJurors);

        // Prepare the list of jurors and penalties to either be slashed or returned based on their votes for the given round
        uint256 minActiveBalance = jurorsRegistry.minJurorsActiveBalance();
        address[] memory jurors = new address[](batchSettledJurors);
        uint256[] memory penalties = new uint256[](batchSettledJurors);
        for (uint256 i = 0; i < batchSettledJurors; i++) {
            address juror = _round.jurors[roundSettledJurors + i];
            jurors[i] = juror;
            penalties[i] = minActiveBalance.pct(_penaltyPct) * _round.jurorsStates[juror].weight;
        }

        // Check which of the jurors voted in favor of the final ruling of the dispute in this round. Ask the registry to slash or unlocked the
        // locked active tokens of each juror depending on their vote, and finally store the total amount of slashed tokens.
        bool[] memory jurorsInFavor = voting.getVotersInFavorOf(_voteId, _finalRuling, jurors);
        _round.collectedTokens = _round.collectedTokens.add(jurorsRegistry.slashOrUnlock(termId, jurors, penalties, jurorsInFavor));
        return batchSettledJurors;
    }

    /**
    * @dev Internal function to compute the juror weight for a dispute's round
    * @param _dispute Dispute to calculate the juror's weight of
    * @param _roundId ID of the dispute's round to calculate the juror's weight of
    * @param _juror Address of the juror to calculate the weight of
    * @return Computed weight of the requested juror for the final round of the given dispute
    */
    function _computeJurorWeight(Dispute storage _dispute, uint256 _roundId, address _juror) internal returns (uint64) {
        AdjudicationRound storage round = _dispute.rounds[_roundId];
        CourtConfig storage config = _getConfigAtDraftTerm(round);

        return _isRegularRound(_roundId, config)
            ? _getJurorWeightForRegularRound(round, _juror)
            : _computeJurorWeightForFinalRound(round, _juror);
    }

    /**
    * @dev Internal function to compute the juror weight for the final round. Note that for a final round the weight of
    *      each juror is equal to the number of times the min active balance the juror has. This function will try to
    *      collect said amount from the active balance of a juror, acting as a lock to allow them to vote.
    * @param _round Dispute round to calculate the juror's weight of
    * @param _juror Address of the juror to calculate the weight of
    * @return Weight of the requested juror for the final round of the given dispute
    */
    function _computeJurorWeightForFinalRound(AdjudicationRound storage _round, address _juror) internal returns (uint64) {
        // If the juror weight for the last round was already computed, return that value
        JurorState storage jurorState = _round.jurorsStates[_juror];
        if (jurorState.weight != uint64(0)) {
            return jurorState.weight;
        }

        // If the juror weight for the last round is zero, return zero
        uint64 weight = _getJurorWeightForFinalRound(_round, _juror);
        if (weight == uint64(0)) {
            return uint64(0);
        }

        // To guarantee scalability of the final round, since all jurors may vote, we try to collect the amount of
        // active tokens that needs to be locked for each juror when they try to commit their vote.
        uint256 activeBalance = jurorsRegistry.activeBalanceOfAt(_juror, _round.draftTermId);
        CourtConfig storage config = _getConfigAtDraftTerm(_round);
        uint256 weightedPenalty = activeBalance.pct(config.penaltyPct);

        // If it was not possible to collect the amount to be locked, return 0 to prevent juror from voting
        if (!jurorsRegistry.collectTokens(_juror, weightedPenalty, termId)) {
            return uint64(0);
        }

        // If it was possible to collect the amount of active tokens to be locked, update the final round state
        jurorState.weight = weight;
        _round.collectedTokens = _round.collectedTokens.add(weightedPenalty);
        return weight;
    }

    /**
    * TODO: Expose external function to change config
    * TODO: document
    */
    function _setCourtConfig(
        uint64 _fromTermId,
        ERC20 _feeToken,
        uint256[4] memory _fees, // _jurorFee, _heartbeatFee, _draftFee, _settleFee
        uint64[4] memory _roundStateDurations,
        uint16 _penaltyPct,
        uint16 _finalRoundReduction,
        uint64 _appealStepFactor,
        uint32 _maxRegularAppealRounds
    )
        internal
    {
        // TODO: Require config changes happening at least X terms in the future
        // Where X is the amount of terms in the future a dispute can be scheduled to be drafted at
        require(configChangeTermId > termId || termId == ZERO_TERM_ID, ERROR_PAST_TERM_FEE_CHANGE);

        // Make sure the given penalty pct is not greater than 100%
        require(PctHelpers.isValid(_penaltyPct), ERROR_INVALID_PENALTY_PCT);

        // Make sure the max number of appeals allowed does not reach the limit
        bool isMaxAppealRoundsValid = uint256(_maxRegularAppealRounds) > 0 && _maxRegularAppealRounds <= MAX_REGULAR_APPEAL_ROUNDS_LIMIT;
        require(isMaxAppealRoundsValid, ERROR_INVALID_MAX_APPEAL_ROUNDS);

        // TODO: add reasonable limits for durations
        for (uint i = 0; i < _roundStateDurations.length; i++) {
            require(_roundStateDurations[i] > 0, ERROR_CONFIG_PERIOD_ZERO_TERMS);
        }

        if (configChangeTermId != ZERO_TERM_ID) {
            terms[configChangeTermId].courtConfigId = 0; // reset previously set fee structure change
        }

        CourtConfig memory courtConfig = CourtConfig({
            feeToken: _feeToken,
            jurorFee: _fees[0],
            heartbeatFee: _fees[1],
            draftFee: _fees[2],
            settleFee: _fees[3],
            commitTerms: _roundStateDurations[0],
            revealTerms: _roundStateDurations[1],
            appealTerms: _roundStateDurations[2],
            appealConfirmTerms: _roundStateDurations[3],
            penaltyPct: _penaltyPct,
            finalRoundReduction: _finalRoundReduction,
            appealStepFactor: _appealStepFactor,
            maxRegularAppealRounds: _maxRegularAppealRounds
        });

        uint64 courtConfigId = uint64(courtConfigs.push(courtConfig) - 1);
        terms[configChangeTermId].courtConfigId = courtConfigId;
        configChangeTermId = _fromTermId;

        emit NewCourtConfig(_fromTermId, courtConfigId);
    }

    /**
    * @dev Internal function to execute a deposit of tokens from the msg.sender to the Court accounting contract
    * @param _token ERC20 token to execute a transfer from
    * @param _amount Amount of tokens to be transferred from the msg.sender to the Court accounting
    */
    function _depositSenderAmount(ERC20 _token, uint256 _amount) internal {
        if (_amount > 0) {
            require(_token.safeTransferFrom(msg.sender, address(accounting), _amount), ERROR_DEPOSIT_FAILED);
        }
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

        // We already know that the start time of the current term is in the past, we are safe to avoid SafeMath here
        return (getTimestamp64() - currentTermStartTime) / termDuration;
    }

    /**
    * @dev Internal function to get the juror weight for a dispute's round
    * @param _disputeId ID of the dispute to calculate the juror's weight of
    * @param _roundId ID of the dispute's round to calculate the juror's weight of
    * @param _juror Address of the juror to calculate the weight of
    * @return Weight of the requested juror for the final round of the given dispute
    */
    function _getJurorWeight(uint256 _disputeId, uint256 _roundId, address _juror) internal view returns (uint64) {
        AdjudicationRound storage round = disputes[_disputeId].rounds[_roundId];
        CourtConfig storage config = _getConfigAtDraftTerm(round);

        return (_isRegularRound(_roundId, config))
            ? _getJurorWeightForRegularRound(round, _juror)
            : _getJurorWeightForFinalRound(round, _juror);
    }

    /**
    * @dev Internal function to get the juror weight for a regular round. Note that the weight of a juror for a regular
    *      round is the number of times a juror was picked for the round round.
    * @param _round Dispute round to calculate the juror's weight of
    * @param _juror Address of the juror to calculate the weight of
    * @return Weight of the requested juror for the final round of the given dispute
    */
    function _getJurorWeightForRegularRound(AdjudicationRound storage _round, address _juror) internal view returns (uint64) {
        return _round.jurorsStates[_juror].weight;
    }

    /**
    * @dev Internal function to get the juror weight for the final round. Note that for the final round the weight of
    *      each juror is equal to the number of times the min active balance the juror has, multiplied by a precision
    *      factor to deal with division rounding. This function assumes Court term is up-to-date.
    * @param _round Dispute round to calculate the juror's weight of
    * @param _juror Address of the juror to calculate the weight of
    * @return Weight of the requested juror for the final round of the given dispute
    */
    function _getJurorWeightForFinalRound(AdjudicationRound storage _round, address _juror) internal view returns (uint64) {
        uint256 activeBalance = jurorsRegistry.activeBalanceOfAt(_juror, _round.draftTermId);
        uint256 minJurorsActiveBalance = jurorsRegistry.minJurorsActiveBalance();

        // Note that jurors may not reach the minimum active balance since some might have been slashed. If that occurs,
        // these jurors cannot vote in the final round.
        if (activeBalance < minJurorsActiveBalance) {
            return uint64(0);
        }

        // Otherwise, return the times the active balance of the juror fits in the min active balance, multiplying
        // it by a round factor to ensure a better precision rounding.
        // TODO: review, we are not using the final round discount here
        return (FINAL_ROUND_WEIGHT_PRECISION.mul(activeBalance) / minJurorsActiveBalance).toUint64();
    }

    /**
    * @dev Internal function to tell information related to the next round due to an appeal of a certain round given. This function assumes
    *      given round can be appealed and that the given round ID corresponds to the given round pointer.
    * @param _round Round requesting the appeal details of
    * @param _roundId Identification number of the round requesting the appeal details of
    * @return nextRoundStartTerm Term id from which the next round will start
    * @return nextRoundJurorsNumber Jurors number for the next round
    * @return newDisputeState New state for the dispute associated to the given round after the appeal
    * @return feeToken ERC20 token used for the next round fees
    * @return jurorFees Total amount of fees to be distributed between the winning jurors of the next round
    * @return totalFees Total amount of fees for a regular round at the given term
    * @return appealDeposit Amount to be deposit of fees for a regular round at the given term
    * @return confirmAppealDeposit Total amount of fees for a regular round at the given term
    */
    function _getNextRoundDetails(AdjudicationRound storage _round, uint256 _roundId) internal view
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
        CourtConfig storage config = _getConfigAtDraftTerm(_round);
        // Court terms are assumed to always fit in uint64. Thus, the end term of a round is assumed to fit in uint64 too.
        uint64 currentRoundAppealStartTerm = _round.draftTermId + _round.delayedTerms + config.commitTerms + config.revealTerms;
        // Next round start term is current round end term
        nextRoundStartTerm = currentRoundAppealStartTerm + config.appealTerms + config.appealConfirmTerms;

        // Compute next round settings depending on if it will be the final round or not
        if (_roundId >= uint256(config.maxRegularAppealRounds) - 1) {
            // If the next round is the final round, no draft is needed.
            newDisputeState = DisputeState.Adjudicating;
            // The number of jurors will be the number of times the minimum stake is hold in the registry,
            // multiplied by a precision factor to help with division rounding.
            nextRoundJurorsNumber = _getFinalRoundJurorsNumber(nextRoundStartTerm);
            // Calculate fees for the final round using the appeal start term of the current round
            (feeToken, jurorFees, totalFees) = _getFinalRoundFees(currentRoundAppealStartTerm, nextRoundJurorsNumber);
        } else {
            // For a new regular rounds we need to draft jurors
            newDisputeState = DisputeState.PreDraft;
            // The number of jurors will be the number of jurors of the current round multiplied by an appeal factor
            nextRoundJurorsNumber = _getNextRegularRoundJurorsNumber(_round, config);
            // Calculate fees for the next regular round using the appeal start term of the current round
            (feeToken, jurorFees, totalFees) = _getRegularRoundFees(currentRoundAppealStartTerm, nextRoundJurorsNumber);
        }

        // Calculate appeal collateral
        appealDeposit = totalFees * APPEAL_COLLATERAL_FACTOR;
        confirmAppealDeposit = totalFees * APPEAL_CONFIRMATION_COLLATERAL_FACTOR;
    }

    /**
    * @dev Internal function to calculate the jurors number for the next regular round of a given round. This function assumes Court term is
    *      up-to-date, that the next round of the one given is regular, and the given config corresponds to the draft term of the given round.
    * @param _round Round querying the jurors number of its next round
    * @param _config Court config at the draft term of the given round
    * @return Jurors number for the next regular round of the given round
    */
    function _getNextRegularRoundJurorsNumber(AdjudicationRound storage _round, CourtConfig storage _config) internal view returns (uint64) {
        // Jurors number are increased by a step factor on each appeal
        uint64 jurorsNumber = _round.jurorsNumber * _config.appealStepFactor;
        // Make sure it's odd to enforce avoiding a tie. Note that it can happen if any of the jurors don't vote anyway.
        if (uint256(jurorsNumber) % 2 == 0) {
            jurorsNumber++;
        }
        return jurorsNumber;
    }

    /**
    * @dev Internal function to calculate the jurors number for final rounds at the current term. The number of jurors of a final round does not
    *      depend on its previous rounds, only on the current Court term. This function assumes Court term is up-to-date.
    * @param _termId Term querying the final round jurors number of
    * @return Jurors number for final rounds for the given term
    */
    function _getFinalRoundJurorsNumber(uint64 _termId) internal view returns (uint64) {
        // The registry guarantees its total active balance will never be greater than
        // `2^64 * minJurorsActiveBalance / FINAL_ROUND_WEIGHT_PRECISION`. Thus, the
        // jurors number for a final round will always fit in uint64
        uint256 totalActiveBalance = jurorsRegistry.totalActiveBalanceAt(_termId);
        uint256 minJurorsActiveBalance = jurorsRegistry.minJurorsActiveBalance();
        return (FINAL_ROUND_WEIGHT_PRECISION.mul(totalActiveBalance) / minJurorsActiveBalance).toUint64();
    }

    /**
    * @dev Internal function to get fees information for regular rounds for a certain term. This function assumes Court term is up-to-date.
    * @param _termId Term id to query the fees information for regular rounds of
    * @param _jurorsNumber Number of jurors participating in the round being queried
    * @return feeToken ERC20 token used for the fees
    * @return jurorFees Total amount of fees to be distributed between the winning jurors of a round
    * @return totalFees Total amount of fees for a regular round at the given term
    */
    function _getRegularRoundFees(uint64 _termId, uint64 _jurorsNumber) internal view
        returns (ERC20 feeToken, uint256 jurorFees, uint256 totalFees)
    {
        CourtConfig storage config = _getConfigAt(_termId);
        feeToken = config.feeToken;
        // For regular rounds the fees for each juror is constant and given by the config of the round
        jurorFees = uint256(_jurorsNumber).mul(config.jurorFee);
        // The total fees for regular rounds also considers the heartbeat, the number of drafts, and the number of settles
        uint256 draftAndSettleFees = (config.draftFee.add(config.settleFee)).mul(uint256(_jurorsNumber));
        totalFees = config.heartbeatFee.add(jurorFees).add(draftAndSettleFees);
    }

    /**
    * @dev Internal function to get fees information for final rounds for a certain term. This function assumes Court term is up-to-date.
    * @param _termId Term id to query the fees information for final rounds of
    * @param _jurorsNumber Number of jurors participating in the round being queried
    * @return feeToken ERC20 token used for the fees
    * @return jurorFees Total amount of fees corresponding to the jurors at the given term
    * @return totalFees Total amount of fees for a final round at the given term
    */
    function _getFinalRoundFees(uint64 _termId, uint64 _jurorsNumber) internal view
        returns (ERC20 feeToken, uint256 jurorFees, uint256 totalFees)
    {
        CourtConfig storage config = _getConfigAt(_termId);
        feeToken = config.feeToken;
        // For final rounds, the jurors number is computed as the number of times the registry's minimum active balance is held in the registry
        // itself, multiplied by a precision factor. To avoid requesting a huge amount of fees, a final round discount is applied for each juror.
        jurorFees = (uint256(_jurorsNumber).mul(config.jurorFee) / FINAL_ROUND_WEIGHT_PRECISION).pct(config.finalRoundReduction);
        // The total fees for final rounds only considers the heartbeat, there is no draft and no extra settle fees considered
        totalFees = config.heartbeatFee.add(jurorFees);
    }

    /**
    * @dev Internal function to check the adjudication state of a certain dispute round. This function assumes Court term is up-to-date.
    * @param _dispute Dispute to be checked
    * @param _roundId Identification number of the dispute round to be checked
    * @param _state Expected adjudication state for the given dispute round
    */
    function _checkAdjudicationState(Dispute storage _dispute, uint256 _roundId, AdjudicationState _state) internal view {
        require(_roundId < _dispute.rounds.length, ERROR_ROUND_DOES_NOT_EXIST);
        require(_adjudicationStateAt(_dispute, _roundId, termId) == _state, ERROR_INVALID_ADJUDICATION_STATE);
    }

    /**
    * @dev Internal function to tell adjudication state of a round at a certain term. This function assumes the given round exists.
    * @param _dispute Dispute querying the adjudication round of
    * @param _roundId Identification number of the dispute round querying the adjudication round of
    * @param _termId Identification number of the dispute round querying the adjudication round of
    * @return Adjudication state of the requested dispute round for the given term
    */
    function _adjudicationStateAt(Dispute storage _dispute, uint256 _roundId, uint64 _termId) internal view returns (AdjudicationState) {
        AdjudicationRound storage round = _dispute.rounds[_roundId];
        CourtConfig storage config = _getConfigAtDraftTerm(round);

        // If the dispute is executed or the given round is not the last one, we consider it ended
        uint256 numberOfRounds = _dispute.rounds.length;
        if (_dispute.state == DisputeState.Executed || _roundId < numberOfRounds - 1) {
            return AdjudicationState.Ended;
        }

        // If given term is before the actual term when the last round was finally drafted, then the last round adjudication state is invalid
        uint64 draftFinishedTermId = round.draftTermId + round.delayedTerms;
        if (_dispute.state == DisputeState.PreDraft || _termId < draftFinishedTermId) {
            return AdjudicationState.Invalid;
        }

        // If given term is before the reveal start term of the last round, then jurors are still allowed to commit votes for the last round
        uint64 revealStartTerm = draftFinishedTermId + config.commitTerms;
        if (_termId < revealStartTerm) {
            return AdjudicationState.Committing;
        }

        // If given term is before the appeal start term of the last round, then jurors are still allowed to reveal votes for the last round
        uint64 appealStartTerm = revealStartTerm + config.revealTerms;
        if (_termId < appealStartTerm) {
            return AdjudicationState.Revealing;
        }

        // If the max number of appeals has been reached, then the last round is the final round and can be considered ended
        bool maxAppealReached = numberOfRounds > uint256(config.maxRegularAppealRounds);
        if (maxAppealReached) {
            return AdjudicationState.Ended;
        }

        // If the last round was not appealed yet, check if the confirmation period has started or not
        bool isLastRoundAppealed = _existsAppeal(round.appeal);
        uint64 appealConfirmationStartTerm = appealStartTerm + config.appealTerms;
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
        // above by the first check and considered 'Ended'
        uint64 appealConfirmationEndTerm = appealConfirmationStartTerm + config.appealConfirmTerms;
        if (_termId < appealConfirmationEndTerm) {
            return AdjudicationState.ConfirmingAppeal;
        }

        // If non of the above conditions have been met, the last round is considered ended
        return AdjudicationState.Ended;
    }

    /**
    * @dev Internal function to get the Court config at the draft term of a certain round
    * @param _round Round querying the court config at its draft term
    * @return Court config at the draft term of the given round
    */
    function _getConfigAtDraftTerm(AdjudicationRound storage _round) internal view returns (CourtConfig storage) {
        // Note that it is safe to access a court config directly for a past term, no need to use `_getConfigAt`
        return _getConfigSafeAt(_round.draftTermId);
    }

    /**
    * @dev Internal function to get the Court config for a given term
    * @param _termId Term querying the Court config of
    * @return Court config for the given term
    */
    function _getConfigAt(uint64 _termId) internal view returns (CourtConfig storage) {
        // If the given term is lower or equal to the last ensured Court term, it is safe to use a past Court config
        uint64 lastEnsuredTermId = termId;
        if (_termId <= lastEnsuredTermId) {
            return _getConfigSafeAt(_termId);
        }

        // If the given term is in the future but there is a config change scheduled before it, use the incoming config
        if (configChangeTermId <= _termId) {
            return _getConfigSafeAt(configChangeTermId);
        }

        // If no changes are scheduled, use the Court config of the last ensured term
        return _getConfigSafeAt(lastEnsuredTermId);
    }

    /**
    * @dev Internal function to directly get the Court config for a given term
    * @param _termId Term querying the Court config of
    * @return Court config for the given term
    */
    function _getConfigSafeAt(uint64 _termId) internal view returns (CourtConfig storage) {
        uint64 configId = terms[_termId].courtConfigId;
        return courtConfigs[uint256(configId)];
    }

    /**
    * @dev Internal function to tell the current term of the Court. Note that the current term may not be ensured yet.
    * @return Identification number of the Court current term
    */
    function _getCurrentTermId() internal view returns (uint64) {
        // Court terms are assumed to always fit in uint64. Thus, some terms after the last ensured term is assumed to fit in uint64 too.
        return termId + _neededTermTransitions();
    }

    /**
    * @dev Internal function to compute the randomness that will be used to draft jurors for the given term. This
    *      function assumes the given term exists. To determine the randomness factor for a term we use the hash of a
    *      block number that is set once the term has started to ensure it cannot be known beforehand. Note that the
    *      hash function being used only works for the 256 most recent block numbers.
    * @param _term Term to compute the randomness of
    * @return Randomness computed for the given term
    */
    function _getTermRandomness(Term storage _term) internal view returns (bytes32) {
        require(getBlockNumber64() > _term.randomnessBN, ERROR_TERM_RANDOMNESS_NOT_YET);
        return blockhash(_term.randomnessBN);
    }

    /**
    * @dev Internal function to tell whether a round is regular or final. This function assumes the given round exists.
    * @param _roundId Identification number of the round to be checked
    * @param _config Court config to use in order to check if the given round is regular or final
    * @return True if the given round is regular, false in case its a final round
    */
    function _isRegularRound(uint256 _roundId, CourtConfig storage _config) internal view returns (bool) {
        return _roundId < uint256(_config.maxRegularAppealRounds);
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
    * @dev Internal function to get the identification number of the vote of a certain dispute round
    * @param _disputeId Identification number of the dispute querying the vote id of
    * @param _roundId Identification number of the dispute round querying the vote id of
    * @return Identification number of the vote of the requested dispute round
    */
    function _getVoteId(uint256 _disputeId, uint256 _roundId) internal pure returns (uint256) {
        return (_disputeId << 128) + _roundId;
    }

    /**
    * @dev Internal function to get the dispute round of a certain vote identification number
    * @param _voteId Identification number of the vote querying the dispute round of
    * @return disputeId Identification number of the dispute for the given vote
    * @return roundId Identification number of the dispute round for the given vote
    */
    function _decodeVoteId(uint256 _voteId) internal pure returns (uint256 disputeId, uint256 roundId) {
        disputeId = _voteId >> 128;
        roundId = _voteId & 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF;
        // TODO: validate round exists
    }

    /**
    * @dev Private function to draft jurors for a given dispute and round. It assumes the given data is correct
    * @param _disputeId Identification number of the dispute to be drafted
    * @param _round Round of the dispute to be drafted
    * @param _jurorsNumber Number of jurors requested for the dispute round
    * @param _requestedJurors Number of jurors to be drafted for the given dispute. Note that this number could be part of the jurors number.
    * @param _draftTerm Term in which the dispute was requested to be drafted
    * @param _config Config of the Court at the draft term
    */
    function _draft(
        uint256  _disputeId,
        AdjudicationRound storage _round,
        uint64 _jurorsNumber,
        uint256 _requestedJurors,
        Term storage _draftTerm,
        CourtConfig storage _config
    )
        private
    {
        // TODO: Could not pass selectedJurors due to a stack-too-deep issue here
        // Draft jurors for the requested round
        uint256[7] memory draftParams = [
            uint256(_draftTerm.randomness),
            _disputeId,
            uint256(termId),
            _round.selectedJurors,
            _requestedJurors,
            uint256(_jurorsNumber),
            uint256(_config.penaltyPct)
        ];
        (address[] memory jurors, uint64[] memory weights, uint256 outputLength, uint64 selectedJurors) = jurorsRegistry.draft(draftParams);

        // Update round with drafted jurors information
        _round.selectedJurors = selectedJurors;
        for (uint256 i = 0; i < outputLength; i++) {
            // If the juror was already registered in the list, then don't add it twice
            address juror = jurors[i];
            JurorState storage jurorState = _round.jurorsStates[juror];
            if (jurorState.weight == uint64(0)) {
                _round.jurors.push(juror);
            }
            // We assume a juror cannot be drafted 2^64 times for a round
            jurorState.weight += weights[i];
        }

        // TODO: return boolean to tell whether the draft has finished or not, cannot do it due to a stack-too-deep issue
    }

    // TODO: move to a factory contract
    function _initJurorsRegistry(IJurorsRegistry _jurorsRegistry, ERC20 _jurorToken, uint256 _minJurorsActiveBalance) private {
        _jurorsRegistry.init(IJurorsRegistryOwner(this), _jurorToken, _minJurorsActiveBalance);
    }

    // TODO: move to a factory contract
    function _initSubscriptions(ERC20 _feeToken, uint256[5] memory _subscriptionParams) private {
        uint64 maxUint64 = uint64(-1);
        uint256 maxUint16 = uint16(-1);

        require(_subscriptionParams[0] <= maxUint64, ERROR_INVALID_PERIOD_DURATION); // _periodDuration
        require(_subscriptionParams[3] <= maxUint16, ERROR_INVALID_LATE_PAYMENT_PENALTY); // _latePaymentPenaltyPct
        require(_subscriptionParams[4] <= maxUint16, ERROR_INVALID_GOVERNANCE_SHARE); // _governorSharePct
        subscriptions.init(
            ISubscriptionsOwner(this),
            jurorsRegistry,
            uint64(_subscriptionParams[0]), // _periodDuration
            _feeToken,
            _subscriptionParams[1],         // _feeAmount
            _subscriptionParams[2],         // _prePaymentPeriods
            uint16(_subscriptionParams[3]), // _latePaymentPenaltyPct
            uint16(_subscriptionParams[4])  // _governorSharePct
        );
    }
}
