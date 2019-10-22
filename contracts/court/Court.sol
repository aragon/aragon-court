pragma solidity ^0.5.8;

// Inspired by: Kleros.sol https://github.com/kleros/kleros @ 7281e69
import "@aragon/os/contracts/lib/token/ERC20.sol";
import "@aragon/os/contracts/common/SafeERC20.sol";
import "@aragon/os/contracts/lib/math/SafeMath.sol";
import "@aragon/os/contracts/lib/math/SafeMath64.sol";
import "@aragon/os/contracts/common/Uint256Helpers.sol";

import "../lib/PctHelpers.sol";
import "../voting/ICRVoting.sol";
import "../voting/ICRVotingOwner.sol";
import "../accounting/IAccounting.sol";
import "../arbitration/IArbitrable.sol";
import "../registry/IJurorsRegistry.sol";
import "../subscriptions/ISubscriptions.sol";
import "../controller/ControlledRecoverable.sol";


contract Court is ControlledRecoverable, ICRVotingOwner {
    using SafeERC20 for ERC20;
    using SafeMath for uint256;
    using SafeMath64 for uint64;
    using PctHelpers for uint256;
    using Uint256Helpers for uint256;

    // Authorization-related error messages
    string private constant ERROR_SENDER_NOT_VOTING = "CT_SENDER_NOT_VOTING";

    // Configs-related error messages
    string private constant ERROR_TOO_OLD_TERM = "CT_TOO_OLD_TERM";
    string private constant ERROR_CONFIG_PERIOD = "CT_CONFIG_PERIOD";
    string private constant ERROR_INVALID_PENALTY_PCT = "CT_INVALID_PENALTY_PCT";
    string private constant ERROR_BAD_INITIAL_JURORS = "CT_BAD_INITIAL_JURORS";
    string private constant ERROR_BAD_APEAL_STEP_FACTOR = "CT_BAD_APEAL_STEP_FACTOR";
    string private constant ERROR_INVALID_MAX_APPEAL_ROUNDS = "CT_INVALID_MAX_APPEAL_ROUNDS";
    string private constant ERROR_ZERO_COLLATERAL_FACTOR = "CT_0_COLLATERAL_FACTOR";

    // Disputes-related error messages
    string private constant ERROR_TERM_OUTDATED = "CT_TERM_OUTDATED";
    string private constant ERROR_DISPUTE_DOES_NOT_EXIST = "CT_DISPUTE_DOES_NOT_EXIST";
    string private constant ERROR_INVALID_DISPUTE_STATE = "CT_INVALID_DISPUTE_STATE";
    string private constant ERROR_INVALID_RULING_OPTIONS = "CT_INVALID_RULING_OPTIONS";
    string private constant ERROR_SUBSCRIPTION_NOT_PAID = "CT_SUBSCRIPTION_NOT_PAID";
    string private constant ERROR_DEPOSIT_FAILED = "CT_DEPOSIT_FAILED";

    // Rounds-related error messages
    string private constant ERROR_ROUND_IS_FINAL = "CT_ROUND_IS_FINAL";
    string private constant ERROR_ROUND_DOES_NOT_EXIST = "CT_ROUND_DOES_NOT_EXIST";
    string private constant ERROR_INVALID_ADJUDICATION_STATE = "CT_INVALID_ADJUDICATION_STATE";
    string private constant ERROR_ROUND_ALREADY_DRAFTED = "CT_ROUND_ALREADY_DRAFTED";
    string private constant ERROR_ROUND_NOT_APPEALED = "CT_ROUND_NOT_APPEALED";
    string private constant ERROR_INVALID_APPEAL_RULING = "CT_INVALID_APPEAL_RULING";

    // Settlements-related error messages
    string private constant ERROR_PREV_ROUND_NOT_SETTLED = "CT_PREVIOUS_ROUND_NOT_SETTLED";
    string private constant ERROR_ROUND_ALREADY_SETTLED = "CT_ROUND_ALREADY_SETTLED";
    string private constant ERROR_ROUND_NOT_SETTLED = "CT_ROUND_PENALTIES_NOT_SETTLED";
    string private constant ERROR_JUROR_ALREADY_REWARDED = "CT_JUROR_ALREADY_REWARDED";
    string private constant ERROR_WONT_REWARD_NON_VOTER_JUROR = "CT_WONT_REWARD_NON_VOTER_JUROR";
    string private constant ERROR_WONT_REWARD_INCOHERENT_JUROR = "CT_WONT_REWARD_INCOHERENT_JUROR";
    string private constant ERROR_NO_COHERENT_JURORS = "CT_NO_COHERENT_JURORS";
    string private constant ERROR_ROUND_APPEAL_ALREADY_SETTLED = "CT_APPEAL_ALREADY_SETTLED";

    // Initial term to start the Court, disputes are not allowed during this term. It can be used to active jurors
    uint64 internal constant ZERO_TERM_ID = 0;

    // Maximum number of term transitions a callee may have to assume in order to call certain functions that require the Court being up-to-date
    uint64 internal constant MAX_AUTO_TERM_TRANSITIONS_ALLOWED = 1;

    // Minimum possible rulings for a dispute
    uint8 internal constant MIN_RULING_OPTIONS = 2;

    // Maximum possible rulings for a dispute, equal to minimum limit
    uint8 internal constant MAX_RULING_OPTIONS = MIN_RULING_OPTIONS;

    // Cap the max number of regular appeal rounds
    uint256 internal constant MAX_REGULAR_APPEAL_ROUNDS_LIMIT = 10;

    // Precision factor used to improve rounding when computing weights for the final round
    uint256 internal constant FINAL_ROUND_WEIGHT_PRECISION = 1000;

    // Max number of terms that each of the different adjudication states can last (if lasted 1h, this would be a year)
    uint64 internal constant MAX_ADJ_STATE_DURATION = 8670;

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

    struct FeesConfig {
        ERC20 token;                   // ERC20 token to be used for the fees of the Court
        uint256 jurorFee;              // Amount of tokens paid to draft a juror to adjudicate a dispute
        uint256 heartbeatFee;          // Amount of tokens paid per dispute to cover the term transitions costs of the draft term
        uint256 draftFee;              // Amount of tokens paid per round to cover the costs of drafting jurors
        uint256 settleFee;             // Amount of tokens paid per round to cover the costs of slashing jurors
    }

    struct DisputesConfig {
        uint64 commitTerms;            // Committing period duration in terms
        uint64 revealTerms;            // Revealing period duration in terms
        uint64 appealTerms;            // Appealing period duration in terms
        uint64 appealConfirmTerms;     // Confirmation appeal period duration in terms
        uint16 penaltyPct;             // Per ten thousand that will be used to compute the tokens to be locked for drafted jurors (‱ - 1/10,000)
        uint16 finalRoundReduction;    // Per ten thousand of reduction applied for final appeal round (‱ - 1/10,000)
        uint64 firstRoundJurorsNumber; // Number of jurors drafted on first round
        uint64 appealStepFactor;       // Factor in which the jurors number is increased on each appeal
        uint256 maxRegularAppealRounds; // Before the final appeal
        uint256 appealCollateralFactor; // Multiple of juror fees required to appeal a preliminary ruling
        uint256 appealConfirmCollateralFactor; // Multiple of juror fees required to confirm appeal
    }

    struct CourtConfig {
        FeesConfig fees;
        DisputesConfig disputes;
    }

    struct Dispute {
        IArbitrable subject;           // Arbitrable associated to a dispute
        uint8 possibleRulings;         // Number of possible rulings jurors can vote for each dispute
        uint8 finalRuling;             // Winning ruling of a dispute
        DisputeState state;            // State of a dispute: pre-draft, adjudicating, or executed
        AdjudicationRound[] rounds;    // List of rounds for each dispute
    }

    struct AdjudicationRound {
        uint64 draftTermId;            // Term from which the jurors of a round can be drafted
        uint64 jurorsNumber;           // Number of jurors drafted for a round
        address triggeredBy;           // Address that triggered a round
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

    struct NextRoundDetails {
        uint64 nextRoundStartTerm;     // Term id from which the next round will start
        uint64 nextRoundJurorsNumber;  // Jurors number for the next round
        DisputeState newDisputeState;  // New state for the dispute associated to the given round after the appeal
        ERC20 feeToken;                // ERC20 token used for the next round fees
        uint256 totalFees;             // Total amount of fees to be distributed between the winning jurors of the next round
        uint256 jurorFees;             // Total amount of fees for a regular round at the given term
        uint256 appealDeposit;         // Amount to be deposit of fees for a regular round at the given term
        uint256 confirmAppealDeposit;  // Total amount of fees for a regular round at the given term
    }

    // Future term id in which a config change has been scheduled
    uint64 internal configChangeTermId;

    // List of all the disputes created in the Court
    Dispute[] internal disputes;

    // List of all the configs used in the Court
    CourtConfig[] internal courtConfigs;

    // List of configs indexed by id
    mapping (uint256 => uint256) internal configIdByTerm;

    // List of number of disputes per term id
    mapping (uint256 => uint256) internal dependingDraftsByTerm;

    event NewCourtConfig(uint64 fromTermId, uint64 courtConfigId);
    event DisputeStateChanged(uint256 indexed disputeId, DisputeState indexed state);
    event NewDispute(uint256 indexed disputeId, address indexed subject, uint64 indexed draftTermId, uint64 jurorsNumber);
    event RulingAppealed(uint256 indexed disputeId, uint256 indexed roundId, uint8 ruling);
    event RulingAppealConfirmed(uint256 indexed disputeId, uint256 indexed roundId, uint64 indexed draftTermId, uint256 jurorsNumber);
    event RulingExecuted(uint256 indexed disputeId, uint8 indexed ruling);
    event PenaltiesSettled(uint256 indexed disputeId, uint256 indexed roundId, uint256 collectedTokens);
    event RewardSettled(uint256 indexed disputeId, uint256 indexed roundId, address juror);
    event AppealDepositSettled(uint256 indexed disputeId, uint256 indexed roundId);
    event Heartbeat(uint64 previousTermId, uint64 currentTermId, address indexed sender);

    /**
    * @dev Ensure the msg.sender is the CR Voting module
    */
    modifier onlyVoting() {
        ICRVoting voting = _voting();
        require(msg.sender == address(voting), ERROR_SENDER_NOT_VOTING);
        _;
    }

    /**
    * @dev Constructor function
    * @param _controller Address of the controller
    * @param _feeToken Address of the token contract that is used to pay for fees
    * @param _fees Array containing:
    *        0. jurorFee The amount of _feeToken that is paid per juror per dispute
    *        1. heartbeatFee The amount of _feeToken per dispute to cover maintenance costs
    *        2. draftFee The amount of _feeToken per juror to cover the drafting cost
    *        3. settleFee The amount of _feeToken per juror to cover round settlement cost
    * @param _roundStateDurations Array containing the durations in terms of the different phases of a dispute:
    *        0. commitTerms Commit period duration in terms
    *        1. revealTerms Reveal period duration in terms
    *        2. appealTerms Appeal period duration in terms
    *        3. appealConfirmationTerms Appeal confirmation period duration in terms
    * @param _pcts Array containing:
    *        0. penaltyPct ‱ of minJurorsActiveBalance that can be slashed (1/10,000)
    *        1. finalRoundReduction ‱ of fee reduction for the last appeal round (1/10,000)
    * @param _roundParams Array containing params for rounds:
    *        0. firstRoundJurorsNumber Number of jurors to be drafted for the first round of disputes
    *        1. appealStepFactor Increasing factor for the number of jurors of each round of a dispute
    *        2. maxRegularAppealRounds Number of regular appeal rounds before the final round is triggered
    * @param _appealCollateralParams Array containing params for appeal collateral:
    *        0. appealCollateralFactor Multiple of juror fees required to appeal a preliminary ruling
    *        1. appealConfirmCollateralFactor Multiple of juror fees required to confirm appeal
    */
    constructor(
        Controller _controller,
        ERC20 _feeToken,
        uint256[4] memory _fees,
        uint64[4] memory _roundStateDurations,
        uint16[2] memory _pcts,
        uint64[3] memory _roundParams,
        uint256[2] memory _appealCollateralParams
    )
        ControlledRecoverable(_controller)
        public
    {
        // No need to explicitly call `Controlled` constructor since `ControlledRecoverable` is already doing it
        // Leave config at index 0 empty for non-scheduled config changes
        courtConfigs.length = 1;
        _setCourtConfig(ZERO_TERM_ID, ZERO_TERM_ID, _feeToken, _fees, _roundStateDurations, _pcts, _roundParams, _appealCollateralParams);
    }

    /**
    * @notice Change Court configuration params
    * @param _fromTermId Identification number of the term in which the config will be effective at
    * @param _feeToken Address of the token contract that is used to pay for fees.
    * @param _fees Array containing:
    *        _jurorFee The amount of _feeToken that is paid per juror per dispute
    *        _heartbeatFee The amount of _feeToken per dispute to cover maintenance costs.
    *        _draftFee The amount of _feeToken per juror to cover the drafting cost.
    *        _settleFee The amount of _feeToken per juror to cover round settlement cost.
    * @param _roundStateDurations Array containing the durations in terms of the different phases of a dispute,
    *        in this order: commit, reveal, appeal and appeal confirm
    * @param _pcts Array containing:
    *        _penaltyPct ‱ of minJurorsActiveBalance that can be slashed (1/10,000)
    *        _finalRoundReduction ‱ of fee reduction for the last appeal round (1/10,000)
    * @param _roundParams Array containing params for rounds:
    *        _firstRoundJurorsNumber Number of jurors to be drafted for the first round of disputes
    *        _appealStepFactor Increasing factor for the number of jurors of each round of a dispute
    *        _maxRegularAppealRounds Number of regular appeal rounds before the final round is triggered
    * @param _appealCollateralParams Array containing params for appeal collateral:
    *        _appealCollateralFactor Multiple of juror fees required to appeal a preliminary ruling
    *        _appealConfirmCollateralFactor Multiple of juror fees required to confirm appeal
    */
    function setCourtConfig(
        uint64 _fromTermId,
        ERC20 _feeToken,
        uint256[4] calldata _fees,
        uint64[4] calldata _roundStateDurations,
        uint16[2] calldata _pcts,
        uint64[3] calldata _roundParams,
        uint256[2] calldata _appealCollateralParams
    )
        external
        onlyConfigGovernor
    {
        uint64 termId = _ensureCurrentTerm();
        _setCourtConfig(termId, _fromTermId, _feeToken, _fees, _roundStateDurations, _pcts, _roundParams, _appealCollateralParams);
    }

    /**
    * @notice Create a dispute over `_subject` with `_possibleRulings` possible rulings in next term
    * @dev Create a dispute to be drafted in a future term
    * @param _subject Arbitrable subject being disputed
    * @param _possibleRulings Number of possible rulings allowed for the drafted jurors to vote on the dispute
    * @return Dispute identification number
    */
    function createDispute(IArbitrable _subject, uint8 _possibleRulings) external returns (uint256) {
        // TODO: Limit the min amount of terms before drafting (to allow for evidence submission)
        // TODO: ERC165 check that _subject conforms to the Arbitrable interface
        // TODO: require(address(_subject) == msg.sender, ERROR_INVALID_DISPUTE_CREATOR);
        uint64 termId = _ensureCurrentTerm();
        ISubscriptions subscriptions = _subscriptions();
        require(subscriptions.isUpToDate(address(_subject)), ERROR_SUBSCRIPTION_NOT_PAID);
        require(_possibleRulings >= MIN_RULING_OPTIONS && _possibleRulings <= MAX_RULING_OPTIONS, ERROR_INVALID_RULING_OPTIONS);

        // Create the dispute
        uint64 draftTermId = termId + 1;
        uint256 disputeId = disputes.length++;
        Dispute storage dispute = disputes[disputeId];
        dispute.subject = _subject;
        dispute.possibleRulings = _possibleRulings;
        CourtConfig storage config = _getConfigAt(draftTermId);
        uint64 jurorsNumber = config.disputes.firstRoundJurorsNumber;
        emit NewDispute(disputeId, address(_subject), draftTermId, jurorsNumber);

        // Create first adjudication round of the dispute
        (ERC20 feeToken, uint256 jurorFees, uint256 totalFees) = _getRegularRoundFees(config, jurorsNumber);
        _createRound(disputeId, DisputeState.PreDraft, draftTermId, jurorsNumber, jurorFees);

        // Pay round fees and return dispute id
        _depositSenderAmount(feeToken, totalFees);
        return disputeId;
    }

    /**
     * @notice Draft jurors for the next round of dispute #`_disputeId`
     * @param _disputeId Identification number of the dispute to be drafted
     * @param _maxJurorsToBeDrafted Max number of jurors to be drafted, it will be capped to the requested number of jurors of the dispute
     */
    function draft(uint256 _disputeId, uint64 _maxJurorsToBeDrafted) external {
        disputeExists(_disputeId);
        // Drafts can only be computed when the Court is up-to-date. Note that forcing a term transition won't work since the term randomness
        // is always based on the next term which means it won't be available anyway.
        IClock clock = _clock();
        uint64 requiredTransitions = _clock().getNeededTermTransitions();
        require(uint256(requiredTransitions) == 0, ERROR_TERM_OUTDATED);
        uint64 currentTermId = controller.getLastEnsuredTermId();

        // Ensure dispute has not been drafted yet
        Dispute storage dispute = disputes[_disputeId];
        require(dispute.state == DisputeState.PreDraft, ERROR_ROUND_ALREADY_DRAFTED);

        // Ensure draft term randomness can be computed for the current block number
        AdjudicationRound storage round = dispute.rounds[dispute.rounds.length - 1];
        bytes32 draftTermRandomness = clock.ensureTermRandomness(round.draftTermId);

        // Draft the min number of jurors between the one requested by the sender and the one requested by the disputer
        uint64 jurorsNumber = round.jurorsNumber;
        uint64 selectedJurors = round.selectedJurors;
        // No need for SafeMath: selectedJurors is set in `_draft` function, by adding to it `requestedJurors`. The line below prevents underflow
        uint64 jurorsToBeDrafted = jurorsNumber - selectedJurors;
        uint64 requestedJurors = jurorsToBeDrafted < _maxJurorsToBeDrafted ? jurorsToBeDrafted : _maxJurorsToBeDrafted;

        // Draft jurors for the given dispute and reimburse fees
        CourtConfig storage config = _getDisputeConfig(dispute);
        bool draftEnded = _draft(_disputeId, round, jurorsNumber, selectedJurors, requestedJurors, currentTermId, draftTermRandomness, config);
        _accounting().assign(config.fees.token, msg.sender, config.fees.draftFee.mul(requestedJurors));

        // If the drafting is over, update its state
        if (draftEnded) {
            // Note that we can avoid using SafeMath here since we already ensured `termId` is greater than or equal to `round.draftTermId`
            round.delayedTerms = currentTermId - round.draftTermId;
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
    function createAppeal(uint256 _disputeId, uint256 _roundId, uint8 _ruling) external {
        disputeExists(_disputeId);
        // Ensure current term and check that the given round can be appealed.
        // Note that if there was a final appeal the adjudication state will be 'Ended'.
        Dispute storage dispute = disputes[_disputeId];
        _checkAdjudicationState(dispute, _roundId, AdjudicationState.Appealing);

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
        NextRoundDetails memory nextRound = _getNextRoundDetails(dispute, round, _roundId);
        _depositSenderAmount(nextRound.feeToken, nextRound.appealDeposit);
    }

    /**
    * @notice Confirm appeal for round #`_roundId` of dispute #`_disputeId` in favor of ruling `_ruling`
    * @param _disputeId Identification number of the dispute confirming an appeal of
    * @param _roundId Identification number of the dispute round confirming an appeal of
    * @param _ruling Ruling being confirmed against a dispute round appeal
    */
    function confirmAppeal(uint256 _disputeId, uint256 _roundId, uint8 _ruling) external {
        // TODO: ensure dispute exists
        // Ensure current term and check that the given round is appealed and can be confirmed.
        // Note that if there was a final appeal the adjudication state will be 'Ended'.
        Dispute storage dispute = disputes[_disputeId];
        _checkAdjudicationState(dispute, _roundId, AdjudicationState.ConfirmingAppeal);

        // Ensure that the ruling being confirmed in favor of is valid and different from the appealed ruling
        AdjudicationRound storage round = dispute.rounds[_roundId];
        Appeal storage appeal = round.appeal;
        uint256 voteId = _getVoteId(_disputeId, _roundId);
        require(appeal.appealedRuling != _ruling && _voting().isValidOutcome(voteId, _ruling), ERROR_INVALID_APPEAL_RULING);

        // Create a new adjudication round for the dispute
        NextRoundDetails memory nextRound = _getNextRoundDetails(dispute, round, _roundId);
        uint64 nextRoundStartTerm = nextRound.nextRoundStartTerm;
        uint64 nextRoundJurorsNumber = nextRound.nextRoundJurorsNumber;
        DisputeState newDisputeState = nextRound.newDisputeState;
        uint256 jurorFees = nextRound.jurorFees;
        uint256 newRoundId = _createRound(_disputeId, newDisputeState, nextRoundStartTerm, nextRoundJurorsNumber, jurorFees);

        // Update previous round appeal state
        appeal.taker = msg.sender;
        appeal.opposedRuling = _ruling;
        emit RulingAppealConfirmed(_disputeId, newRoundId, nextRoundStartTerm, nextRoundJurorsNumber);

        // Pay appeal confirm deposit
        _depositSenderAmount(nextRound.feeToken, nextRound.confirmAppealDeposit);
    }

    /**
    * @notice Execute the arbitrable associated to dispute #`_disputeId` based on its final ruling
    * @param _disputeId Identification number of the dispute to be executed
    */
    function executeRuling(uint256 _disputeId) external {
        disputeExists(_disputeId);
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
    function settlePenalties(uint256 _disputeId, uint256 _roundId, uint256 _jurorsToSettle) external {
        // TODO: ensure round exists
        // Enforce that rounds are settled in order to avoid one round without incentive to settle. Even if there is a settleFee
        // it may not be big enough and all jurors in the round could be slashed.
        bool isFirstRound = _roundId == 0;
        Dispute storage dispute = disputes[_disputeId];
        require(isFirstRound || dispute.rounds[_roundId - 1].settledPenalties, ERROR_PREV_ROUND_NOT_SETTLED);

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
            ICRVoting voting = _voting();
            round.coherentJurors = uint64(voting.getOutcomeTally(voteId, finalRuling));
        }

        CourtConfig storage config = _getDisputeConfig(dispute);
        if (_isRegularRound(_roundId, config)) {
            // For regular appeal rounds we compute the amount of locked tokens that needs to get burned in batches.
            // The callers of this function will get rewarded in this case.
            uint256 jurorsSettled = _settleRegularRoundPenalties(round, voteId, finalRuling, config.disputes.penaltyPct, _jurorsToSettle);
            IAccounting accounting = _accounting();
            accounting.assign(config.fees.token, msg.sender, config.fees.settleFee.mul(jurorsSettled));
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

            // Check if there wasn't at least one juror voting in favor of the winning ruling
            if (round.coherentJurors == 0) {
                // Burn all the collected tokens of the jurors to be slashed. Note that this will happen only when there were no jurors voting
                // in favor of the final winning outcome. Otherwise, these will be re-distributed between the winning jurors in `settleReward`
                // instead of being burned.
                if (collectedTokens > 0) {
                    IJurorsRegistry jurorsRegistry = _jurorsRegistry();
                    jurorsRegistry.burnTokens(collectedTokens);
                }

                // Reimburse juror fees to the disputer for round 0 or to the previous appeal parties for other rounds. Note that if the
                // given round is not the first round, we can ensure there was an appeal in the previous round.
                IAccounting accounting = _accounting();
                if (isFirstRound) {
                    accounting.assign(config.fees.token, round.triggeredBy, round.jurorFees);
                } else {
                    ERC20 feeToken = config.fees.token;
                    uint256 refundFees = round.jurorFees / 2;
                    Appeal storage triggeringAppeal = dispute.rounds[_roundId - 1].appeal;
                    accounting.assign(feeToken, triggeringAppeal.maker, refundFees);
                    accounting.assign(feeToken, triggeringAppeal.taker, refundFees);
                }
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
    function settleReward(uint256 _disputeId, uint256 _roundId, address _juror) external {
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
        ICRVoting voting = _voting();
        uint256 voteId = _getVoteId(_disputeId, _roundId);
        require(voting.hasVotedInFavorOf(voteId, dispute.finalRuling, _juror), ERROR_WONT_REWARD_INCOHERENT_JUROR);

        // Distribute the collected tokens of the jurors that were slashed weighted by the winning jurors. Note that
        // we are penalizing jurors that refused intentionally their vote for the final round.
        // Note that coherentJurors has to be > 0 because above it's required that _juror voted in favour (so at the very least there is one),
        // therefore divisions below are safe.
        uint256 coherentJurors = round.coherentJurors;
        uint256 collectedTokens = round.collectedTokens;
        if (collectedTokens > 0) {
            IJurorsRegistry jurorsRegistry = _jurorsRegistry();
            jurorsRegistry.assignTokens(_juror, uint256(jurorState.weight).mul(collectedTokens) / coherentJurors);
        }

        // Reward the winning juror
        uint256 jurorFee = round.jurorFees.mul(jurorState.weight) / coherentJurors;
        CourtConfig storage config = _getDisputeConfig(dispute);
        IAccounting accounting = _accounting();
        accounting.assign(config.fees.token, _juror, jurorFee);
        emit RewardSettled(_disputeId, _roundId, _juror);
    }

    /**
    * @notice Settle appeal deposits for round #`_roundId` of dispute #`_disputeId`
    * @param _disputeId Identification number of the dispute to settle appeal deposits for
    * @param _roundId Identification number of the dispute round to settle appeal deposits for
    */
    function settleAppealDeposit(uint256 _disputeId, uint256 _roundId) external {
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

        // Load next round details
        NextRoundDetails memory nextRound = _getNextRoundDetails(dispute, round, _roundId);
        ERC20 feeToken = nextRound.feeToken;
        uint256 totalFees = nextRound.totalFees;
        uint256 appealDeposit = nextRound.appealDeposit;
        uint256 confirmAppealDeposit = nextRound.confirmAppealDeposit;

        // If the appeal wasn't confirmed, return the entire deposit to appeal maker
        IAccounting accounting = _accounting();
        if (!_isAppealConfirmed(appeal)) {
            accounting.assign(feeToken, appeal.maker, appealDeposit);
            return;
        }

        // If the appeal was confirmed and there is a winner, we transfer the total deposit to that party. Otherwise, if the final ruling wasn't
        // selected by any of the appealing parties or no juror voted in the in favor of the possible outcomes, we split it between both parties.
        // Note that we are safe to access the dispute final ruling, since we already ensured that round penalties were settled.
        uint8 finalRuling = dispute.finalRuling;
        uint256 totalDeposit = appealDeposit.add(confirmAppealDeposit);
        if (appeal.appealedRuling == finalRuling) {
            // No need for SafeMath: collateral factors > 0 => both appeal deposits > totalFees
            accounting.assign(feeToken, appeal.maker, totalDeposit - totalFees);
        } else if (appeal.opposedRuling == finalRuling) {
            // No need for SafeMath: collateral factors > 0 => both appeal deposits > totalFees
            accounting.assign(feeToken, appeal.taker, totalDeposit - totalFees);
        } else {
            uint256 feesRefund = totalFees / 2;
            // No need for SafeMath: collateral factors > 0 => both appeal deposits > totalFees
            accounting.assign(feeToken, appeal.maker, appealDeposit - feesRefund);
            accounting.assign(feeToken, appeal.taker, confirmAppealDeposit - feesRefund);
        }
    }

    /**
    * @notice Get the weight of `_voter` for vote #`_voteId` and check if votes can be committed
    * @param _voteId ID of the vote instance to request the weight of a voter for
    * @param _voter Address of the voter querying the weight of
    * @return Weight of the requested juror for the requested dispute's round
    */
    function ensureTermAndGetVoterWeightToCommit(uint256 _voteId, address _voter) external onlyVoting returns (uint64) {
        (uint256 disputeId, uint256 roundId) = _decodeVoteId(_voteId);
        Dispute storage dispute = disputes[disputeId];

        // Ensure current term and check that votes can still be committed for the given round
        _checkAdjudicationState(dispute, roundId, AdjudicationState.Committing);
        return _computeJurorWeight(dispute, roundId, _voter);
    }

    /**
    * @notice Check if votes can be leaked
    * @param _voteId ID of the vote instance to be checked
    */
    function ensureTermToLeak(uint256 _voteId) external onlyVoting {
        (uint256 disputeId, uint256 roundId) = _decodeVoteId(_voteId);
        Dispute storage dispute = disputes[disputeId];
        _checkAdjudicationState(dispute, roundId, AdjudicationState.Committing);
    }

    /**
    * @notice Get the weight of `_voter` for vote #`_voteId` and check if votes can be revealed
    * @param _voteId ID of the vote instance to request the weight of a voter for
    * @param _voter Address of the voter querying the weight of
    * @return Weight of the requested juror for the requested dispute's round
    */
    function ensureTermAndGetVoterWeightToReveal(uint256 _voteId, address _voter) external onlyVoting returns (uint64) {
        (uint256 disputeId, uint256 roundId) = _decodeVoteId(_voteId);
        Dispute storage dispute = disputes[disputeId];

        // Ensure current term and check that votes can still be revealed for the given round
        _checkAdjudicationState(dispute, roundId, AdjudicationState.Revealing);
        AdjudicationRound storage round = dispute.rounds[roundId];
        return _getStoredJurorWeight(round, _voter);
    }

    /**
    * @notice Send a heartbeat to the Court to transition up to `_maxRequestedTransitions` terms
    * @param _maxRequestedTransitions Max number of term transitions allowed by the sender
    */
    function heartbeat(uint64 _maxRequestedTransitions) external {
        IClock clock = _clock();
        (uint64 previousTermId, uint64 currentTermId) = clock.heartbeat(_maxRequestedTransitions);
        uint256 previousConfigId = configIdByTerm[previousTermId];
        emit Heartbeat(previousTermId, currentTermId, msg.sender);

        // Transition the minimum number of terms between the amount requested and the amount actually needed
        for (uint256 termId = previousTermId + 1; termId <= currentTermId; termId++) {
            // If the term being processed had no config change scheduled, keep the previous one
            uint256 configId = configIdByTerm[termId];
            if (configId == 0) {
                configId = previousConfigId;
                configIdByTerm[termId] = configId;
            }
            previousConfigId = configId;

            // Add amount of fees to be paid for the transitioned term
            FeesConfig storage config = _getConfigSafeAt(uint64(termId)).fees;
            uint256 dependingDrafts = dependingDraftsByTerm[termId];
            uint256 totalFee = config.heartbeatFee.mul(dependingDrafts);

            // Pay heartbeat fees to the caller of this function
            if (totalFee > 0) {
                IAccounting accounting = _accounting();
                accounting.assign(config.token, msg.sender, totalFee);
            }
        }
    }

    /**
    * @dev Get Court configuration parameters
    * @return token Address of the token used to pay for fees
    * @return roundStateDurations Array containing the durations in terms of the different phases a dispute goes through,
    *         in this order: commit, reveal, appeal and appeal confirm
    * @return pcts Array containing:
    *         penaltyPct ‱ of minJurorsActiveBalance that can be slashed (1/10,000)
    *         finalRoundReduction ‱ of fee reduction for the last appeal round (1/10,000)
    * @return roundParams Array containing params for rounds:
    *         firstRoundJurorsNumber Number of jurors to be drafted for the first round of disputes
    *         appealStepFactor Increasing factor for the number of jurors of each round of a dispute
    *         maxRegularAppealRounds Number of regular appeal rounds before the final round is triggered
    * @return appealCollateralParams Array containing params for appeal collateral:
    *         appealCollateralFactor Multiple of juror fees required to appeal a preliminary ruling
    *         appealConfirmCollateralFactor Multiple of juror fees required to confirm appeal
    */
    function getCourtConfig(uint64 _termId) external view
        returns (
            ERC20 feeToken,
            uint256[4] memory fees, //jurorFee, heartbeatFee, draftFee, settleFee,
            uint64[4] memory roundStateDurations, //commitTerms, revealTerms, appealTerms, appealConfirmTerms,
            uint16[2] memory pcts, // penaltyPct, finalRoundReduction,
            uint64[3] memory roundParams, // firstRoundJurorsNumber, appealStepFactor, maxRegularAppealRounds,
            uint256[2] memory appealCollateralParams // appealCollateralFactor, appealConfirmCollateralFactor
        )
    {
        CourtConfig storage config = _getConfigAt(_termId);
        FeesConfig storage feesConfig = config.fees;
        DisputesConfig storage disputesConfig = config.disputes;
        feeToken = feesConfig.token;
        fees = [ feesConfig.jurorFee, feesConfig.heartbeatFee, feesConfig.draftFee, feesConfig.settleFee ];
        roundStateDurations = [
            disputesConfig.commitTerms,
            disputesConfig.revealTerms,
            disputesConfig.appealTerms,
            disputesConfig.appealConfirmTerms
        ];
        pcts = [ disputesConfig.penaltyPct, disputesConfig.finalRoundReduction ];
        roundParams = [ disputesConfig.firstRoundJurorsNumber, disputesConfig.appealStepFactor, uint64(disputesConfig.maxRegularAppealRounds) ];
        appealCollateralParams = [ disputesConfig.appealCollateralFactor, disputesConfig.appealConfirmCollateralFactor ];
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
    function getDispute(uint256 _disputeId) external view
        returns (IArbitrable subject, uint8 possibleRulings, DisputeState state, uint8 finalRuling, uint256 lastRoundId)
    {
        disputeExists(_disputeId);
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
    function getRound(uint256 _disputeId, uint256 _roundId) external view
        returns (
            uint64 draftTerm,
            uint64 delayedTerms,
            uint64 jurorsNumber,
            uint64 selectedJurors,
            address triggeredBy,
            uint256 jurorFees,
            bool settledPenalties,
            uint256 collectedTokens,
            uint64 coherentJurors,
            AdjudicationState state
        )
    {
        disputeExists(_disputeId);
        Dispute storage dispute = disputes[_disputeId];
        roundExists(dispute, _roundId);
        state = _adjudicationStateAt(dispute, _roundId, _getCurrentTermId());

        AdjudicationRound storage round = dispute.rounds[_roundId];
        draftTerm = round.draftTermId;
        delayedTerms = round.delayedTerms;
        jurorsNumber = round.jurorsNumber;
        selectedJurors = round.selectedJurors;
        triggeredBy = round.triggeredBy;
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
    * @return feeToken ERC20 token used for the fees
    * @return jurorFees Total amount of fees to be distributed between the winning jurors of a round
    * @return totalFees Total amount of fees for a regular round at the given term
    */
    function getDisputeFees(uint64 _draftTermId) external view returns (ERC20 feeToken, uint256 jurorFees, uint256 totalFees) {
        CourtConfig storage config = _getConfigAt(_draftTermId);
        uint64 jurorsNumber = config.disputes.firstRoundJurorsNumber;
        return _getRegularRoundFees(config, jurorsNumber);
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
        disputeExists(_disputeId);
        Dispute storage dispute = disputes[_disputeId];
        roundExists(dispute, _roundId);
        CourtConfig storage config = _getDisputeConfig(dispute);
        require(_isRegularRound(_roundId, config), ERROR_ROUND_IS_FINAL);
        NextRoundDetails memory nextRound = _getNextRoundDetails(dispute, dispute.rounds[_roundId], _roundId);
        return (
            nextRound.nextRoundStartTerm,
            nextRound.nextRoundJurorsNumber,
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
    function getJuror(uint256 _disputeId, uint256 _roundId, address _juror) external view
        returns (uint64 weight, bool rewarded)
    {
        disputeExists(_disputeId);
        Dispute storage dispute = disputes[_disputeId];
        roundExists(dispute, _roundId);
        AdjudicationRound storage round = dispute.rounds[_roundId];
        CourtConfig storage config = _getDisputeConfig(dispute);

        if (_isRegularRound(_roundId, config)) {
            weight = _getStoredJurorWeight(round, _juror);
        } else {
            IJurorsRegistry jurorsRegistry = _jurorsRegistry();
            (, uint256 minActiveBalanceMultiple) = jurorsRegistry.getActiveBalanceInfoOfAt(_juror, round.draftTermId, FINAL_ROUND_WEIGHT_PRECISION);
            weight = minActiveBalanceMultiple.toUint64();
        }

        rewarded = round.jurorsStates[_juror].rewarded;
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
        dependingDraftsByTerm[_draftTermId] += 1;

        // Create new vote for the new round
        ICRVoting voting = _voting();
        uint256 voteId = _getVoteId(_disputeId, roundId);
        voting.create(voteId, dispute.possibleRulings);
        return roundId;
    }

    /**
    * @dev Internal function to check the adjudication state of a certain dispute round. This function also ensures the court terms are updated.
    * @param _dispute Dispute to be checked
    * @param _roundId Identification number of the dispute round to be checked
    * @param _state Expected adjudication state for the given dispute round
    */
    function _checkAdjudicationState(Dispute storage _dispute, uint256 _roundId, AdjudicationState _state) internal {
        uint64 termId = _ensureCurrentTerm();
        require(_roundId < _dispute.rounds.length, ERROR_ROUND_DOES_NOT_EXIST);
        require(_adjudicationStateAt(_dispute, _roundId, termId) == _state, ERROR_INVALID_ADJUDICATION_STATE);
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

        // Ensure current term and check that the last adjudication round has ended.
        // Note that there will always be at least one round.
        uint256 lastRoundId = dispute.rounds.length - 1;
        _checkAdjudicationState(dispute, lastRoundId, AdjudicationState.Ended);

        // If the last adjudication round was appealed but no-one confirmed it, the final ruling is the outcome the
        // appealer vouched for. Otherwise, fetch the winning outcome from the voting app of the last round.
        AdjudicationRound storage lastRound = dispute.rounds[lastRoundId];
        Appeal storage lastAppeal = lastRound.appeal;
        bool isRoundAppealedAndNotConfirmed = _existsAppeal(lastAppeal) && !_isAppealConfirmed(lastAppeal);
        uint8 finalRuling = isRoundAppealedAndNotConfirmed
            ? lastAppeal.appealedRuling
            : _voting().getWinningOutcome(_getVoteId(_disputeId, lastRoundId));

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
        uint64 termId = _ensureCurrentTerm();
        // The batch starts where the previous one ended, stored in _round.settledJurors
        uint256 roundSettledJurors = _round.settledJurors;
        // Compute the amount of jurors that are going to be settled in this batch, which is returned by the function for fees calculation
        // Initially we try to reach the end of the jurors array
        // No need for SafeMath: settledJurors gets added batchSettledJurors itself (see few lines below)
        uint256 batchSettledJurors = _round.jurors.length - roundSettledJurors;

        // If the requested amount of jurors is not zero and it is lower that the remaining number of jurors to be settled for the given round,
        // we cap the number of jurors that are going to be settled in this batch to the requested amount. If not, we know we have reached the
        // last batch and we are safe to mark round penalties as settled.
        if (_jurorsToSettle > 0 && batchSettledJurors > _jurorsToSettle) {
            batchSettledJurors = _jurorsToSettle;
        } else {
            _round.settledPenalties = true;
        }

        // Update the number of round settled jurors.
        // No need for SafeMath: the highest number of jurors to be settled for a round could be the `jurorsNumber` itself, which is a uint64.
        _round.settledJurors = uint64(roundSettledJurors + batchSettledJurors);

        // Prepare the list of jurors and penalties to either be slashed or returned based on their votes for the given round
        IJurorsRegistry jurorsRegistry = _jurorsRegistry();
        uint256 minActiveBalance = jurorsRegistry.minJurorsActiveBalance();
        address[] memory jurors = new address[](batchSettledJurors);
        uint256[] memory penalties = new uint256[](batchSettledJurors);
        for (uint256 i = 0; i < batchSettledJurors; i++) {
            address juror = _round.jurors[roundSettledJurors + i];
            jurors[i] = juror;
            penalties[i] = minActiveBalance.pct(_penaltyPct).mul(_round.jurorsStates[juror].weight);
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
    * @return Computed weight of the requested juror for the final round of the given dispute
    */
    function _computeJurorWeight(Dispute storage _dispute, uint256 _roundId, address _juror) internal returns (uint64) {
        AdjudicationRound storage round = _dispute.rounds[_roundId];
        CourtConfig storage config = _getDisputeConfig(_dispute);

        return _isRegularRound(_roundId, config)
            ? _getStoredJurorWeight(round, _juror)
            : _computeJurorWeightForFinalRound(config, round, _juror);
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
    function _computeJurorWeightForFinalRound(CourtConfig storage _config, AdjudicationRound storage _round, address _juror)
        internal returns (uint64)
    {
        IJurorsRegistry jurorsRegistry = _jurorsRegistry();
        (uint256 activeBalance, uint256 minActiveBalanceMultiple) = jurorsRegistry.getActiveBalanceInfoOfAt(
            _juror,
            _round.draftTermId,
            FINAL_ROUND_WEIGHT_PRECISION
        );

        // If the juror weight for the last round is zero, return zero
        if (minActiveBalanceMultiple == 0) {
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
        uint64 weight = minActiveBalanceMultiple.toUint64();
        _round.jurorsStates[_juror].weight = weight;
        _round.collectedTokens = _round.collectedTokens.add(weightedPenalty);
        return weight;
    }

    /**
    * @dev Assumes that sender it's allowed (either it's from governor or it's on init)
    * @param _currentTermId Identification number of the current Court term
    * @param _fromTermId Identification number of the term in which the config will be effective at
    * @param _feeToken Address of the token contract that is used to pay for fees.
    * @param _fees Array containing:
    *        _jurorFee The amount of _feeToken that is paid per juror per dispute
    *        _heartbeatFee The amount of _feeToken per dispute to cover maintenance costs.
    *        _draftFee The amount of _feeToken per juror to cover the drafting cost.
    *        _settleFee The amount of _feeToken per juror to cover round settlement cost.
    * @param _roundStateDurations Array containing the durations in terms of the different phases of a dispute,
    *        in this order: commit, reveal, appeal and appeal confirm
    * @param _pcts Array containing:
    *        _penaltyPct ‱ of minJurorsActiveBalance that can be slashed (1/10,000)
    *        _finalRoundReduction ‱ of fee reduction for the last appeal round (1/10,000)
    * @param _roundParams Array containing params for rounds:
    *        _firstRoundJurorsNumber Number of jurors to be drafted for the first round of disputes
    *        _appealStepFactor Increasing factor for the number of jurors of each round of a dispute
    *        _maxRegularAppealRounds Number of regular appeal rounds before the final round is triggered
    * @param _appealCollateralParams Array containing params for appeal collateral:
    *        _appealCollateralFactor Multiple of juror fees required to appeal a preliminary ruling
    *        _appealConfirmCollateralFactor Multiple of juror fees required to confirm a    */
    function _setCourtConfig(
        uint64 _currentTermId,
        uint64 _fromTermId,
        ERC20 _feeToken,
        uint256[4] memory _fees, // _jurorFee, _heartbeatFee, _draftFee, _settleFee
        uint64[4] memory _roundStateDurations,
        uint16[2] memory _pcts, //_penaltyPct, _finalRoundReduction,
        uint64[3] memory _roundParams, // _firstRoundJurorsNumber, _appealStepFactor, _maxRegularAppealRounds
        uint256[2] memory _appealCollateralParams // _appealCollateralFactor, _appealConfirmCollateralFactor
    )
        internal
    {
        // If the current term is not zero, changes must be scheduled at least 2 terms in the future.
        // This way we can ensure that disputes scheduled for the next term won't have their config changed.
        require(_currentTermId == ZERO_TERM_ID || _fromTermId > _currentTermId + 1, ERROR_TOO_OLD_TERM);

        require(_appealCollateralParams[0] > 0 && _appealCollateralParams[1] > 0, ERROR_ZERO_COLLATERAL_FACTOR);

        // Make sure the given penalty pct is not greater than 100%
        require(PctHelpers.isValid(_pcts[0]), ERROR_INVALID_PENALTY_PCT);

        // Disputes must request at least one juror to be drafted initially
        uint64 _firstRoundJurorsNumber = _roundParams[0];
        require(_firstRoundJurorsNumber > 0, ERROR_BAD_INITIAL_JURORS);

        // Prevent that further rounds have zero jurors
        // TODO: stack too deep: uint64 _appealStepFactor = _roundParams[1];
        require(_roundParams[1] > 0, ERROR_BAD_APEAL_STEP_FACTOR);

        // Make sure the max number of appeals allowed does not reach the limit
        uint256 _maxRegularAppealRounds = _roundParams[2];
        bool isMaxAppealRoundsValid = _maxRegularAppealRounds > 0 && _maxRegularAppealRounds <= MAX_REGULAR_APPEAL_ROUNDS_LIMIT;
        require(isMaxAppealRoundsValid, ERROR_INVALID_MAX_APPEAL_ROUNDS);

        // TODO: add reasonable limits for durations
        for (uint i = 0; i < _roundStateDurations.length; i++) {
            require(_roundStateDurations[i] > 0 && _roundStateDurations[i] < MAX_ADJ_STATE_DURATION, ERROR_CONFIG_PERIOD);
        }

        // If there was a config change already scheduled, reset it (in that case we will overwrite last array item).
        // Otherwise, schedule a new config.
        if (configChangeTermId > _currentTermId) {
            configIdByTerm[configChangeTermId] = 0;
        } else {
            courtConfigs.length++;
        }

        uint64 courtConfigId = uint64(courtConfigs.length - 1);
        CourtConfig storage config = courtConfigs[courtConfigId];

        config.fees = FeesConfig({
            token: _feeToken,
            jurorFee: _fees[0],
            heartbeatFee: _fees[1],
            draftFee: _fees[2],
            settleFee: _fees[3]
        });

        config.disputes = DisputesConfig({
            commitTerms: _roundStateDurations[0],
            revealTerms: _roundStateDurations[1],
            appealTerms: _roundStateDurations[2],
            appealConfirmTerms: _roundStateDurations[3],
            penaltyPct: _pcts[0],
            finalRoundReduction: _pcts[1],
            firstRoundJurorsNumber: _firstRoundJurorsNumber,
            appealStepFactor: _roundParams[1],
            maxRegularAppealRounds: _maxRegularAppealRounds,
            appealCollateralFactor: _appealCollateralParams[0],
            appealConfirmCollateralFactor: _appealCollateralParams[1]
        });

        configIdByTerm[_fromTermId] = courtConfigId;
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
            IAccounting accounting = _accounting();
            require(_token.safeTransferFrom(msg.sender, address(accounting), _amount), ERROR_DEPOSIT_FAILED);
        }
    }

    /**
    * @dev Ensure a dispute exists
    * @param _disputeId Identification number of the dispute to be ensured
    */
    function disputeExists(uint256 _disputeId) internal view {
        require(_disputeId < disputes.length, ERROR_DISPUTE_DOES_NOT_EXIST);
    }

    /**
    * @dev Ensure a dispute round exists
    * @param dispute Dispute the round should belong to
    * @param _roundId Identification number of the dispute round to be ensured
    */
    function roundExists(Dispute storage dispute, uint256 _roundId) internal view {
        require(_roundId < dispute.rounds.length, ERROR_ROUND_DOES_NOT_EXIST);
    }

    /**
    * @dev Internal function to get the stored juror weight for a round. Note that the weight of a juror is:
    *      - For a regular round: the number of times a juror was picked for the round round.
    *      - For a final round: the relative active stake of a juror's state over the total active tokens, only set after the juror has voted.
    * @param _round Dispute round to calculate the juror's weight of
    * @param _juror Address of the juror to calculate the weight of
    * @return Weight of the requested juror for the given round
    */
    function _getStoredJurorWeight(AdjudicationRound storage _round, address _juror) internal view returns (uint64) {
        return _round.jurorsStates[_juror].weight;
    }

    /**
    * @dev Internal function to tell information related to the next round due to an appeal of a certain round given. This function assumes
    *      given round can be appealed and that the given round ID corresponds to the given round pointer.
    * @param _dispute Round's dispute requesting the appeal details of
    * @param _round Round requesting the appeal details of
    * @param _roundId Identification number of the round requesting the appeal details of
    * @return Next round details
    */
    function _getNextRoundDetails(Dispute storage _dispute, AdjudicationRound storage _round, uint256 _roundId) internal view
        returns (NextRoundDetails memory)
    {
        NextRoundDetails memory nextRound;
        CourtConfig storage config = _getDisputeConfig(_dispute);
        DisputesConfig storage disputesConfig = config.disputes;

        // No need for SafeMath: round state durations are safely capped at config
        // and we assume that timestamps (and its derivatives like termId) won't reach MAX_UINT64, which would be ~5.8e11 years
        uint64 currentRoundAppealStartTerm = _round.draftTermId + _round.delayedTerms + disputesConfig.commitTerms + disputesConfig.revealTerms;
        // Next round start term is current round end term
        nextRound.nextRoundStartTerm = currentRoundAppealStartTerm + disputesConfig.appealTerms + disputesConfig.appealConfirmTerms;

        // Compute next round settings depending on if it will be the final round or not
        // No need for SafeMath: maxRegularAppealRounds > 0 is checked on setting config
        if (_roundId >= disputesConfig.maxRegularAppealRounds - 1) {
            // If the next round is the final round, no draft is needed.
            nextRound.newDisputeState = DisputeState.Adjudicating;
            // The number of jurors will be the number of times the minimum stake is hold in the registry,
            // multiplied by a precision factor to help with division rounding.
            // Total active balance is guaranteed to never be greater than
            // `2^64 * minActiveBalance / FINAL_ROUND_WEIGHT_PRECISION`. Thus, the
            // jurors number for a final round will always fit in `uint64`
            IJurorsRegistry jurorsRegistry = _jurorsRegistry();
            nextRound.nextRoundJurorsNumber = jurorsRegistry.getTotalMinActiveBalanceMultiple(
                nextRound.nextRoundStartTerm,
                FINAL_ROUND_WEIGHT_PRECISION
            ).toUint64();
            // Calculate fees for the final round using the appeal start term of the current round
            (nextRound.feeToken, nextRound.jurorFees, nextRound.totalFees) = _getFinalRoundFees(config, nextRound.nextRoundJurorsNumber);
        } else {
            // For a new regular rounds we need to draft jurors
            nextRound.newDisputeState = DisputeState.PreDraft;
            // The number of jurors will be the number of jurors of the current round multiplied by an appeal factor
            nextRound.nextRoundJurorsNumber = _getNextRegularRoundJurorsNumber(_round, disputesConfig);
            // Calculate fees for the next regular round using the appeal start term of the current round
            (nextRound.feeToken, nextRound.jurorFees, nextRound.totalFees) = _getRegularRoundFees(config, nextRound.nextRoundJurorsNumber);
        }

        // Calculate appeal collateral
        nextRound.appealDeposit = nextRound.totalFees.mul(disputesConfig.appealCollateralFactor);
        nextRound.confirmAppealDeposit = nextRound.totalFees.mul(disputesConfig.appealConfirmCollateralFactor);
        return nextRound;
    }

    /**
    * @dev Internal function to calculate the jurors number for the next regular round of a given round. This function assumes Court term is
    *      up-to-date, that the next round of the one given is regular, and the given config corresponds to the draft term of the given round.
    * @param _round Round querying the jurors number of its next round
    * @param _config Disputes config at the draft term of the first round of the dispute
    * @return Jurors number for the next regular round of the given round
    */
    function _getNextRegularRoundJurorsNumber(AdjudicationRound storage _round, DisputesConfig storage _config) internal view returns (uint64) {
        // Jurors number are increased by a step factor on each appeal
        uint64 jurorsNumber = _round.jurorsNumber.mul(_config.appealStepFactor);
        // Make sure it's odd to enforce avoiding a tie. Note that it can happen if any of the jurors don't vote anyway.
        if (uint256(jurorsNumber) % 2 == 0) {
            jurorsNumber++;
        }
        return jurorsNumber;
    }

    /**
    * @dev Internal function to get fees information for regular rounds for a certain term. This function assumes Court term is up-to-date.
    * @param _config Court config to use in order to get fees
    * @param _jurorsNumber Number of jurors participating in the round being queried
    * @return feeToken ERC20 token used for the fees
    * @return jurorFees Total amount of fees to be distributed between the winning jurors of a round
    * @return totalFees Total amount of fees for a regular round at the given term
    */
    function _getRegularRoundFees(CourtConfig storage _config, uint64 _jurorsNumber) internal view
        returns (ERC20 feeToken, uint256 jurorFees, uint256 totalFees)
    {
        feeToken = _config.fees.token;
        // For regular rounds the fees for each juror is constant and given by the config of the round
        jurorFees = uint256(_jurorsNumber).mul(_config.fees.jurorFee);
        // The total fees for regular rounds also considers the heartbeat, the number of drafts, and the number of settles
        uint256 draftAndSettleFees = (_config.fees.draftFee.add(_config.fees.settleFee)).mul(uint256(_jurorsNumber));
        totalFees = _config.fees.heartbeatFee.add(jurorFees).add(draftAndSettleFees);
    }

    /**
    * @dev Internal function to get fees information for final rounds for a certain term. This function assumes Court term is up-to-date.
    * @param _config Court config to use in order to get fees
    * @param _jurorsNumber Number of jurors participating in the round being queried
    * @return feeToken ERC20 token used for the fees
    * @return jurorFees Total amount of fees corresponding to the jurors at the given term
    * @return totalFees Total amount of fees for a final round at the given term
    */
    function _getFinalRoundFees(CourtConfig storage _config, uint64 _jurorsNumber) internal view
        returns (ERC20 feeToken, uint256 jurorFees, uint256 totalFees)
    {
        feeToken = _config.fees.token;
        // For final rounds, the jurors number is computed as the number of times the registry's minimum active balance is held in the registry
        // itself, multiplied by a precision factor. To avoid requesting a huge amount of fees, a final round discount is applied for each juror.
        jurorFees = (uint256(_jurorsNumber).mul(_config.fees.jurorFee) / FINAL_ROUND_WEIGHT_PRECISION).pct(_config.disputes.finalRoundReduction);
        // The total fees for final rounds only considers the heartbeat, there is no draft and no extra settle fees considered
        totalFees = _config.fees.heartbeatFee.add(jurorFees);
    }

    /**
    * @dev Internal function to tell adjudication state of a round at a certain term. This function assumes the given round exists.
    * @param _dispute Dispute querying the adjudication round of
    * @param _roundId Identification number of the dispute round querying the adjudication round of
    * @param _termId Identification number of the term to be used for the different round phases durations
    * @return Adjudication state of the requested dispute round for the given term
    */
    function _adjudicationStateAt(Dispute storage _dispute, uint256 _roundId, uint64 _termId) internal view returns (AdjudicationState) {
        AdjudicationRound storage round = _dispute.rounds[_roundId];
        CourtConfig storage config = _getDisputeConfig(_dispute);

        // If the dispute is executed or the given round is not the last one, we consider it ended
        uint256 numberOfRounds = _dispute.rounds.length;
        // No need for SafeMath: this function assumes the given round exists, and therfore length of rounds array is >= 1
        if (_dispute.state == DisputeState.Executed || _roundId < numberOfRounds - 1) {
            return AdjudicationState.Ended;
        }

        // If given term is before the actual term when the last round was finally drafted, then the last round adjudication state is invalid
        // No need for SafeMath: round state durations are safely capped at config
        uint64 draftFinishedTermId = round.draftTermId + round.delayedTerms;
        if (_dispute.state == DisputeState.PreDraft || _termId < draftFinishedTermId) {
            return AdjudicationState.Invalid;
        }

        // If given term is before the reveal start term of the last round, then jurors are still allowed to commit votes for the last round
        // No need for SafeMath: round state durations are safely capped at config
        uint64 revealStartTerm = draftFinishedTermId + config.disputes.commitTerms;
        if (_termId < revealStartTerm) {
            return AdjudicationState.Committing;
        }

        // If given term is before the appeal start term of the last round, then jurors are still allowed to reveal votes for the last round
        // No need for SafeMath: round state durations are safely capped at config
        uint64 appealStartTerm = revealStartTerm + config.disputes.revealTerms;
        if (_termId < appealStartTerm) {
            return AdjudicationState.Revealing;
        }

        // If the max number of appeals has been reached, then the last round is the final round and can be considered ended
        bool maxAppealReached = numberOfRounds > config.disputes.maxRegularAppealRounds;
        if (maxAppealReached) {
            return AdjudicationState.Ended;
        }

        // If the last round was not appealed yet, check if the confirmation period has started or not
        bool isLastRoundAppealed = _existsAppeal(round.appeal);
        // No need for SafeMath: round state durations are safely capped at config
        uint64 appealConfirmationStartTerm = appealStartTerm + config.disputes.appealTerms;
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
        // No need for SafeMath: round state durations are safely capped at config
        uint64 appealConfirmationEndTerm = appealConfirmationStartTerm + config.disputes.appealConfirmTerms;
        if (_termId < appealConfirmationEndTerm) {
            return AdjudicationState.ConfirmingAppeal;
        }

        // If non of the above conditions have been met, the last round is considered ended
        return AdjudicationState.Ended;
    }

    /**
    * @dev Internal function to get the Court config at the draft term of the first round of a certain round
    * @param _dispute Dispute querying the court config at its first draft term
    * @return Court config at the draft term of the given round
    */
    function _getDisputeConfig(Dispute storage _dispute) internal view returns (CourtConfig storage) {
        // Note that it is safe to access a court config directly for a past term, no need to use `_getConfigAt`
        AdjudicationRound storage round = _dispute.rounds[0];
        return _getConfigSafeAt(round.draftTermId);
    }

    /**
    * @dev Internal function to get the Court config for a given term
    * @param _termId Term querying the Court config of
    * @return Court config for the given term
    */
    function _getConfigAt(uint64 _termId) internal view returns (CourtConfig storage) {
        // If the given term is lower or equal to the last ensured Court term, it is safe to use a past Court config
        uint64 lastEnsuredTermId = _getLastEnsuredTermId();
        if (_termId <= lastEnsuredTermId) {
            return _getConfigSafeAt(_termId);
        }

        // If the given term is in the future but there is a config change scheduled before it, use the incoming config
        uint64 configChangeTermId_ = configChangeTermId;
        if (configChangeTermId_ <= _termId) {
            return _getConfigSafeAt(configChangeTermId_);
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
        uint256 configId = configIdByTerm[uint256(_termId)];
        return courtConfigs[configId];
    }

    /**
    * @dev Internal function to tell whether a round is regular or final. This function assumes the given round exists.
    * @param _roundId Identification number of the round to be checked
    * @param _config Court config to use in order to check if the given round is regular or final
    * @return True if the given round is regular, false in case its a final round
    */
    function _isRegularRound(uint256 _roundId, CourtConfig storage _config) internal view returns (bool) {
        return _roundId < _config.disputes.maxRegularAppealRounds;
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
    * @param _selectedJurors Number of jurors already selected for the dispute round
    * @param _requestedJurors Number of jurors to be drafted for the given dispute. Note that this number could be part of the jurors number.
    * @param _currentTermId Identification number of the current term of the Court
    * @param _draftTermRandomness Randomness of the term in which the dispute was requested to be drafted
    * @param _config Config of the Court at the draft term
    * @return True if all the requested jurors for the given round were drafted, false otherwise
    */
    function _draft(
        uint256  _disputeId,
        AdjudicationRound storage _round,
        uint64 _jurorsNumber,
        uint64 _selectedJurors,
        uint64 _requestedJurors,
        uint64 _currentTermId,
        bytes32 _draftTermRandomness,
        CourtConfig storage _config
    )
        private returns(bool)
    {
        // Pack draft params
        uint256[7] memory draftParams = [
            uint256(_draftTermRandomness),
            _disputeId,
            uint256(_currentTermId),
            _selectedJurors,
            _requestedJurors,
            uint256(_jurorsNumber),
            uint256(_config.disputes.penaltyPct)
        ];

        // Draft jurors for the requested round
        IJurorsRegistry jurorsRegistry = _jurorsRegistry();
        (address[] memory jurors, uint64[] memory weights, uint256 outputLength) = jurorsRegistry.draft(draftParams);

        // Update round with drafted jurors information.
        // No need for SafeMath: this cannot be greater than `jurorsNumber`.
        uint64 newSelectedJurors = _selectedJurors + _requestedJurors;
        _round.selectedJurors = newSelectedJurors;

        // Store or update drafted jurors' weight
        for (uint256 i = 0; i < outputLength; i++) {
            JurorState storage jurorState = _round.jurorsStates[jurors[i]];
            // If the juror was already registered in the list, then don't add it twice
            if (uint256(jurorState.weight) == 0) {
                _round.jurors.push(jurors[i]);
            }
            // No need for SafeMath: We assume a juror cannot be drafted 2^64 times for a round
            jurorState.weight += weights[i];
        }

        return newSelectedJurors == _jurorsNumber;
    }
}
