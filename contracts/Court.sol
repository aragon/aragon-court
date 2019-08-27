pragma solidity ^0.4.24; // TODO: pin solc

// Inspired by: Kleros.sol https://github.com/kleros/kleros @ 7281e69
import "./lib/PctHelpers.sol";
import "./standards/arbitration/IArbitrable.sol";
import "./standards/erc900/IJurorsRegistry.sol";
import "./standards/erc900/IJurorsRegistryOwner.sol";
import "./standards/accounting/IAccounting.sol";
import "./standards/voting/ICRVoting.sol";
import "./standards/voting/ICRVotingOwner.sol";
import "./standards/subscription/ISubscriptions.sol";
import "./standards/subscription/ISubscriptionsOwner.sol";

import "@aragon/os/contracts/lib/token/ERC20.sol";
import "@aragon/os/contracts/common/SafeERC20.sol";
import "@aragon/os/contracts/lib/math/SafeMath.sol";
import "@aragon/os/contracts/common/Uint256Helpers.sol";
import "@aragon/os/contracts/common/TimeHelpers.sol";


contract Court is IJurorsRegistryOwner, ICRVotingOwner, ISubscriptionsOwner, TimeHelpers {
    using SafeERC20 for ERC20;
    using SafeMath for uint256;
    using PctHelpers for uint256;
    using Uint256Helpers for uint256;

    uint8 internal constant APPEAL_COLLATERAL_FACTOR = 3; // multiple of juror fees required to appeal a preliminary ruling
    uint8 internal constant APPEAL_CONFIRMATION_COLLATERAL_FACTOR = 2; // multiple of juror fees required to confirm appeal

    uint256 internal constant MAX_REGULAR_APPEAL_ROUNDS_LIMIT = 10; // to cap the max number of regular appeal rounds
    uint256 internal constant FINAL_ROUND_WEIGHT_PRECISION = 1000;  // to improve rounding
    // TODO: move all other constants up here

    struct CourtConfig {
        // Fee structure
        ERC20 feeToken;
        uint256 jurorFee;           // per juror, total round juror fee = jurorFee * jurors drawn
        uint256 heartbeatFee;       // per dispute, total heartbeat fee = heartbeatFee * disputes/appeals in term
        uint256 draftFee;           // per juror, total round draft fee = draftFee * jurors drawn
        uint256 settleFee;          // per juror, total round draft fee = settleFee * jurors drawn
        // Dispute config
        uint64 commitTerms;
        uint64 revealTerms;
        uint64 appealTerms;
        uint64 appealConfirmTerms;
        uint16 penaltyPct;
        uint16 finalRoundReduction; // ‱ of reduction applied for final appeal round (1/10,000)
        uint64 appealStepFactor;
        uint32 maxRegularAppealRounds; // before the final appeal
    }

    struct Term {
        uint64 startTime;       // timestamp when the term started
        uint64 dependingDrafts; // disputes or appeals pegged to this term for randomness
        uint64 courtConfigId;   // fee structure for this term (index in courtConfigs array)
        uint64 randomnessBN;    // block number for entropy
        bytes32 randomness;     // entropy from randomnessBN block hash
    }

    enum AdjudicationState {
        Invalid,
        Commit,
        Reveal,
        Appeal,
        AppealConfirm,
        Ended
    }

    struct JurorState {
        uint64 weight;
        bool rewarded;
    }

    struct AdjudicationRound {
        address[] jurors; // TODO: draft
        mapping (address => JurorState) jurorSlotStates; // TODO: draft
        Appealer appealMaker;
        Appealer appealTaker;
        uint64 draftTermId; // meta
        uint64 delayTerms;  // TODO: draft
        uint64 jurorNumber; // meta
        uint64 coherentJurors; // TODO: result
        uint64 filledSeats;    // TODO: draft
        uint64 settledJurors;  // TODO: draft
        address triggeredBy;  // meta
        bool settledPenalties; // result
        bool settledAppeals;
        uint256 jurorFees; // meta
        // for regular rounds this contains penalties from non-winning jurors, collected after reveal period
        // for the final round it contains all potential penalties from jurors that voted, as they are collected when jurors commit vote
        uint256 collectedTokens;
    }

    struct Appealer {
        address appealer;
        uint8 ruling;
    }

    enum DisputeState {
        PreDraft,
        Adjudicating,
        Executed
    }

    struct Dispute {
        IArbitrable subject;
        uint8 possibleRulings;      // number of possible rulings the court can decide on
        uint8 finalRuling;
        DisputeState state;
        AdjudicationRound[] rounds;
    }

    // State constants which are set in the constructor and can't change
    uint64 public termDuration; // recomended value ~1 hour as 256 blocks (available block hash) around an hour to mine
    IJurorsRegistry internal jurorsRegistry;
    IAccounting internal accounting;
    ICRVoting internal voting;
    ISubscriptions internal subscriptions;

    // Global config, configurable by governor
    address internal governor; // TODO: consider using aOS' ACL
    CourtConfig[] public courtConfigs;

    // Court state
    uint64 internal termId;
    uint64 public configChangeTermId;
    mapping (uint64 => Term) internal terms;
    Dispute[] internal disputes;

    string internal constant ERROR_INVALID_ADDR = "CTBAD_ADDR";
    string internal constant ERROR_DEPOSIT_FAILED = "CTDEPOSIT_FAIL";
    string internal constant ERROR_TOO_MANY_TRANSITIONS = "CTTOO_MANY_TRANSITIONS";
    string internal constant ERROR_INVALID_TRANSITION_TERMS = "CT_INVALID_TRANSITION_TERMS";
    string internal constant ERROR_PAST_TERM_FEE_CHANGE = "CTPAST_TERM_FEE_CHANGE";
    string internal constant ERROR_OVERFLOW = "CTOVERFLOW";
    string internal constant ERROR_ROUND_ALREADY_DRAFTED = "CTROUND_ALRDY_DRAFTED";
    string internal constant ERROR_NOT_DRAFT_TERM = "CTNOT_DRAFT_TERM";
    string internal constant ERROR_TERM_RANDOMNESS_NOT_YET = "CTRANDOM_NOT_YET";
    string internal constant ERROR_WRONG_TERM = "CTBAD_TERM";
    string internal constant ERROR_BAD_FIRST_TERM_START_TIME = "CT_BAD_FIRST_TERM_START_TIME";
    string internal constant ERROR_TERM_RANDOMNESS_NOT_AVAILABLE = "CT_TERM_RANDOMNESS_NOT_AVAILABLE";
    string internal constant ERROR_INVALID_DISPUTE_STATE = "CTBAD_DISPUTE_STATE";
    string internal constant ERROR_INVALID_ADJUDICATION_ROUND = "CTBAD_ADJ_ROUND";
    string internal constant ERROR_INVALID_ADJUDICATION_STATE = "CTBAD_ADJ_STATE";
    string internal constant ERROR_DISPUTE_DOES_NOT_EXIST = "CT_DISPUTE_DOES_NOT_EXIST";
    string internal constant ERROR_CANNOT_CREATE_DISPUTE = "CT_CANNOT_CREATE_DISPUTE";
    string internal constant ERROR_ROUND_DOES_NOT_EXIST = "CT_ROUND_DOES_NOT_EXIST";
    string internal constant ERROR_ROUND_ALREADY_APPEALED = "CTROUND_ALRDY_APPEALED";
    string internal constant ERROR_ROUND_NOT_APPEALED = "CTROUND_NOT_APPEALED";
    string internal constant ERROR_ROUND_APPEAL_ALREADY_SETTLED = "CTAPPEAL_ALRDY_SETTLED";
    string internal constant ERROR_ROUND_APPEAL_ALREADY_CONFIRMED = "CTAPPEAL_ALRDY_CONFIRMED";
    string internal constant ERROR_INVALID_APPEAL_RULING = "CTBAD_APPEAL_RULING";
    string internal constant ERROR_INVALID_JUROR = "CTBAD_JUROR";
    // TODO: string internal constant ERROR_INVALID_DISPUTE_CREATOR = "CTBAD_DISPUTE_CREATOR";
    string internal constant ERROR_SUBSCRIPTION_NOT_PAID = "CTSUBSC_UNPAID";
    string internal constant ERROR_INVALID_RULING_OPTIONS = "CTBAD_RULING_OPTS";
    string internal constant ERROR_CONFIG_PERIOD_ZERO_TERMS = "CTCONFIG_PERIOD_0";
    string internal constant ERROR_PREV_ROUND_NOT_SETTLED = "CTPREV_ROUND_NOT_SETTLED";
    string internal constant ERROR_ROUND_ALREADY_SETTLED = "CTROUND_ALRDY_SETTLED";
    string internal constant ERROR_ROUND_NOT_SETTLED = "CTROUND_NOT_SETTLED";
    string internal constant ERROR_JUROR_ALREADY_REWARDED = "CTJUROR_ALRDY_REWARDED";
    string internal constant ERROR_JUROR_NOT_COHERENT = "CTJUROR_INCOHERENT";
    string internal constant ERROR_WRONG_PENALTY_PCT = "CTBAD_PENALTY";
    string internal constant ERROR_INVALID_MAX_APPEAL_ROUNDS = "CTINVALID_MAX_APPEAL_ROUNDS";

    uint64 internal constant ZERO_TERM_ID = 0; // invalid term that doesn't accept disputes
    uint64 internal constant MAX_AUTO_TERM_TRANSITIONS_ALLOWED = 1;
    //bytes4 private constant ARBITRABLE_INTERFACE_ID = 0xabababab; // TODO: interface id

    uint8 internal constant MIN_RULING_OPTIONS = 2;
    uint8 internal constant MAX_RULING_OPTIONS = MIN_RULING_OPTIONS;
    uint256 internal constant MAX_UINT16 = uint16(-1);
    uint64 internal constant MAX_UINT64 = uint64(-1);

    event NewTerm(uint64 termId, address indexed heartbeatSender);
    event NewCourtConfig(uint64 fromTermId, uint64 courtConfigId);
    event DisputeStateChanged(uint256 indexed disputeId, DisputeState indexed state);
    event NewDispute(uint256 indexed disputeId, address indexed subject, uint64 indexed draftTermId, uint64 jurorsNumber);
    event RulingAppealed(uint256 indexed disputeId, uint256 indexed roundId, uint8 ruling);
    event RulingAppealConfirmed(uint256 indexed disputeId, uint256 indexed roundId, uint64 indexed draftTermId, uint256 jurorNumber);
    event RulingExecuted(uint256 indexed disputeId, uint8 indexed ruling);
    event RoundSlashingSettled(uint256 indexed disputeId, uint256 indexed roundId, uint256 collectedTokens);
    event RewardSettled(uint256 indexed disputeId, uint256 indexed roundId, address juror);

    modifier only(address _addr) {
        require(msg.sender == _addr, ERROR_INVALID_ADDR);
        _;
    }

    /**
    * @dev Modifier to ensure the current term of the Court. If the Court term is outdated by one term it will be updated. Note that this
    *      function only allows updating the Court by one term, if more terms are required, users will have to call the heartbeat function manually.
    */
    modifier ensureTerm {
        _ensureTerm();
        _;
    }

    modifier disputeExists(uint256 _id) {
        require(_id < disputes.length, ERROR_DISPUTE_DOES_NOT_EXIST);
        _;
    }

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
        ERC20[2] _tokens, // _jurorToken, _feeToken
        IJurorsRegistry _jurorsRegistry,
        IAccounting _accounting,
        ICRVoting _voting,
        ISubscriptions _subscriptions,
        uint256[4] _fees, // _jurorFee, _heartbeatFee, _draftFee, _settleFee
        address _governor,
        uint64 _firstTermStartTime,
        uint256 _minJurorsActiveBalance,
        uint64[4] _roundStateDurations,
        uint16[2] _pcts, //_penaltyPct, _finalRoundReduction
        uint64 _appealStepFactor,
        uint32 _maxRegularAppealRounds,
        uint256[5] _subscriptionParams // _periodDuration, _feeAmount, _prePaymentPeriods, _latePaymentPenaltyPct, _governorSharePct
    ) public {
        require(_firstTermStartTime >= _termDuration, ERROR_BAD_FIRST_TERM_START_TIME);
        require(_firstTermStartTime >= getTimestamp64(), ERROR_BAD_FIRST_TERM_START_TIME);

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
     * @param _draftTermId Term in which the jurors for the dispute will be drafted
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
        require(termId > ZERO_TERM_ID, ERROR_CANNOT_CREATE_DISPUTE);
        require(subscriptions.isUpToDate(address(_subject)), ERROR_SUBSCRIPTION_NOT_PAID);
        require(_possibleRulings >= MIN_RULING_OPTIONS && _possibleRulings <= MAX_RULING_OPTIONS, ERROR_INVALID_RULING_OPTIONS);

        // Create the dispute
        uint256 disputeId = disputes.length++;
        Dispute storage dispute = disputes[disputeId];
        dispute.subject = _subject;
        dispute.possibleRulings = _possibleRulings;
        emit NewDispute(disputeId, _subject, _draftTermId, _jurorsNumber);

        // Create first adjudication round of the dispute
        (ERC20 feeToken, uint256 feeAmount, uint256 jurorFees) = _getFeesForRegularRound(_draftTermId, _jurorsNumber);
        _createRound(disputeId, DisputeState.PreDraft, _draftTermId, _jurorsNumber, jurorFees);

        // Pay round fees and return dispute id
        _payGeneric(feeToken, feeAmount);
        return disputeId;
    }

    /**
     * @notice Draft jurors for the next round of dispute #`_disputeId`
     * @param _disputeId Identification number of the dispute to be drafted
     * @param _maxJurorsToBeDrafted Max number of jurors to be drafted, it will be capped to the requested number of jurors of the dispute
     */
    function draft(uint256 _disputeId, uint64 _maxJurorsToBeDrafted) external ensureTerm {
        // Ensure dispute has not been drafted yet
        Dispute storage dispute = disputes[_disputeId];
        require(dispute.state == DisputeState.PreDraft, ERROR_ROUND_ALREADY_DRAFTED);

        // Ensure round can be drafted in the current term
        AdjudicationRound storage round = dispute.rounds[dispute.rounds.length - 1];
        require(round.draftTermId <= termId, ERROR_NOT_DRAFT_TERM);

        // Ensure current term randomness can be ensured for the current block number
        Term storage draftTerm = terms[termId];
        _ensureTermRandomness(draftTerm);

        // Draft the min number of jurors between the one requested by the sender and the one requested by the disputer
        uint64 jurorsNumber = round.jurorNumber;
        uint256 jurorsRequested = jurorsNumber < _maxJurorsToBeDrafted ? jurorsNumber : _maxJurorsToBeDrafted;

        // Note that it is safe to access a court config directly for a past term
        CourtConfig storage config = courtConfigs[terms[round.draftTermId].courtConfigId];

        // Draft jurors for the given dispute and reimburse fees
        _draft(jurorsRequested, _disputeId, round, draftTerm, config);
        accounting.assign(config.feeToken, msg.sender, config.draftFee * jurorsRequested);

        // If the drafting is over, update its state
        if (round.filledSeats == round.jurorNumber) {
            // Note that we can avoid using SafeMath here since we already ensured `termId` is greater than or equal to `round.draftTermId`
            round.delayTerms = termId - round.draftTermId;
            dispute.state = DisputeState.Adjudicating;
            emit DisputeStateChanged(_disputeId, dispute.state);
        }
    }

    /**
     * @notice Appeal round #`_roundId` ruling in dispute #`_disputeId`
     */
    function appeal(uint256 _disputeId, uint256 _roundId, uint8 _ruling) external ensureTerm {
        _checkAdjudicationState(_disputeId, _roundId, AdjudicationState.Appeal);

        Dispute storage dispute = disputes[_disputeId];
        AdjudicationRound storage round = dispute.rounds[_roundId];
        require(!_isRoundAppealed(round), ERROR_ROUND_ALREADY_APPEALED);

        uint256 voteId = _getVoteId(_disputeId, _roundId);
        uint8 roundWinningRuling = voting.getWinningOutcome(voteId);
        require(roundWinningRuling != _ruling && voting.isValidOutcome(voteId, _ruling), ERROR_INVALID_APPEAL_RULING);

        round.appealMaker.appealer = msg.sender;
        round.appealMaker.ruling = _ruling;
        emit RulingAppealed(_disputeId, _roundId, _ruling);

        // pay round collateral (fees are included in appeal collateral, which is a multiple of them)
        (, , ERC20 feeToken, , , uint256 appealDeposit,) = _getNextAppealDetails(round, _roundId);
        _payGeneric(feeToken, appealDeposit);
    }

    /**
     * @notice Confirm appeal for #`_roundId` ruling in dispute #`_disputeId`
     */
    function confirmAppeal(uint256 _disputeId, uint256 _roundId, uint8 _ruling) external ensureTerm {
        _checkAdjudicationState(_disputeId, _roundId, AdjudicationState.AppealConfirm);

        Dispute storage dispute = disputes[_disputeId];
        AdjudicationRound storage round = dispute.rounds[_roundId];

        require(_isRoundAppealed(round), ERROR_ROUND_NOT_APPEALED);
        require(!_isRoundAppealConfirmed(round), ERROR_ROUND_APPEAL_ALREADY_CONFIRMED);

        uint256 voteId = _getVoteId(_disputeId, _roundId);
        require(round.appealMaker.ruling != _ruling && voting.isValidOutcome(voteId, _ruling), ERROR_INVALID_APPEAL_RULING);

        (uint64 appealDraftTermId,
        uint64 appealJurorNumber,
        ERC20 feeToken,
        ,
        uint256 jurorFees,
        ,
        uint256 confirmAppealDeposit) = _getNextAppealDetails(round, _roundId);

        // Note that it is safe to access a court config directly for a past term
        CourtConfig storage config = courtConfigs[terms[round.draftTermId].courtConfigId];

        uint256 newRoundId;
        if (_roundId >= config.maxRegularAppealRounds - 1) { // final round, roundId starts at 0
            // number of jurors will be the number of times the minimum stake is hold in the registry, multiplied by a precision factor for division roundings
            newRoundId = _createRound(_disputeId, DisputeState.Adjudicating, appealDraftTermId, appealJurorNumber, jurorFees);
        } else {
            // _roundId < max regular appeal rounds is checked in _getNextAppealDetails,
            newRoundId = _createRound(_disputeId, DisputeState.PreDraft, appealDraftTermId, appealJurorNumber, jurorFees);
        }

        round.appealTaker.appealer = msg.sender;
        round.appealTaker.ruling = _ruling;
        emit RulingAppealConfirmed(_disputeId, newRoundId, appealDraftTermId, appealJurorNumber);

        // pay round collateral (fees are included in appeal collateral, which is a multiple of them)
        _payGeneric(feeToken, confirmAppealDeposit);
    }

    /**
     * @notice Execute the final ruling of dispute #`_disputeId`
     */
    function executeRuling(uint256 _disputeId) external ensureTerm {
        Dispute storage dispute = disputes[_disputeId];
        require(dispute.state != DisputeState.Executed, ERROR_INVALID_DISPUTE_STATE);

        uint8 finalRuling = _ensureFinalRuling(_disputeId);
        dispute.state = DisputeState.Executed;
        dispute.subject.rule(_disputeId, uint256(finalRuling));
        emit RulingExecuted(_disputeId, finalRuling);
    }

    /**
     * @notice Execute the final ruling of dispute #`_disputeId`
     * @dev Just executes penalties, jurors must manually claim their rewards
     */
    function settleRoundSlashing(uint256 _disputeId, uint256 _roundId, uint256 _jurorsToSettle) external ensureTerm {
        Dispute storage dispute = disputes[_disputeId];
        AdjudicationRound storage round = dispute.rounds[_roundId];
        CourtConfig storage config = courtConfigs[terms[round.draftTermId].courtConfigId]; // safe to use directly as it is the current term

        // Enforce that rounds are settled in order to avoid one round without incentive to settle
        // even if there is a settleFee, it may not be big enough and all jurors in the round are going to be slashed
        require(_roundId == 0 || dispute.rounds[_roundId - 1].settledPenalties, ERROR_PREV_ROUND_NOT_SETTLED);
        require(!round.settledPenalties, ERROR_ROUND_ALREADY_SETTLED);

        // Set the number of jurors that voted in favor of the final ruling if we haven't started settling yet
        uint8 finalRuling = _ensureFinalRuling(_disputeId);
        uint256 voteId = _getVoteId(_disputeId, _roundId);
        if (round.settledJurors == 0) {
            // TODO: review casting, could this overflow?
            round.coherentJurors = uint64(voting.getOutcomeTally(voteId, finalRuling));
        }

        if (_roundId < config.maxRegularAppealRounds) {
            // For regular appeal rounds we compute the amount of locked tokens that needs to get burned in batches.
            // The callers of this function will get rewarded in this case.
            uint256 jurorsSettled = _settleRegularRoundSlashing(round, voteId, finalRuling, config.penaltyPct, _jurorsToSettle);
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
            emit RoundSlashingSettled(_disputeId, _roundId, collectedTokens);

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
     */
    function settleReward(uint256 _disputeId, uint256 _roundId, address _juror) external ensureTerm {
        Dispute storage dispute = disputes[_disputeId];
        AdjudicationRound storage round = dispute.rounds[_roundId];
        JurorState storage jurorState = round.jurorSlotStates[_juror];

        require(!jurorState.rewarded, ERROR_JUROR_ALREADY_REWARDED);
        require(round.settledPenalties, ERROR_ROUND_NOT_SETTLED);
        require(jurorState.weight > uint256(0), ERROR_INVALID_JUROR);
        jurorState.rewarded = true;

        // Check if the given juror has voted in favor of the final ruling of the dispute in this round
        uint256 voteId = _getVoteId(_disputeId, _roundId);
        require(voting.hasVotedInFavorOf(voteId, dispute.finalRuling, _juror), ERROR_JUROR_NOT_COHERENT);

        // Note that it is safe to access a court config directly for a past term
        CourtConfig storage config = courtConfigs[terms[round.draftTermId].courtConfigId];

        // Distribute the collected tokens of the jurors that were slashed weighted by the winning jurors. Note that
        // we are penalizing jurors that refused intentionally their vote for the final round.
        uint256 coherentJurors = round.coherentJurors;
        uint256 collectedTokens = round.collectedTokens;
        if (collectedTokens > 0) {
            jurorsRegistry.assignTokens(_juror, jurorState.weight * collectedTokens / coherentJurors);
        }

        // Reward the winning juror
        uint256 jurorFee = round.jurorFees * jurorState.weight / coherentJurors;
        accounting.assign(config.feeToken, _juror, jurorFee);
        emit RewardSettled(_disputeId, _roundId, _juror);
    }

    /**
     * @notice Settle appeal deposits for #`_roundId` ruling in dispute #`_disputeId`
     */
    function settleAppealDeposit(uint256 _disputeId, uint256 _roundId) external ensureTerm {
        Dispute storage dispute = disputes[_disputeId];
        AdjudicationRound storage round = dispute.rounds[_roundId];
        Appealer storage appealMaker = round.appealMaker;

        require(round.settledPenalties, ERROR_ROUND_NOT_SETTLED);
        require(_isRoundAppealed(round), ERROR_ROUND_NOT_APPEALED);
        require(!round.settledAppeals, ERROR_ROUND_APPEAL_ALREADY_SETTLED);

        (,,ERC20 depositToken,uint256 feeAmount,,uint256 appealDeposit, uint256 confirmAppealDeposit) = _getNextAppealDetails(round, _roundId);

        // TODO: could these be real transfers instead of assignTokens?
        if (!_isRoundAppealConfirmed(round)) {
            // return entire deposit to appealer
            accounting.assign(depositToken, appealMaker.appealer, appealDeposit);
        } else {
            Appealer storage appealTaker = round.appealTaker;

            // as round penalties were settled, we are sure we already have final ruling
            uint8 finalRuling = dispute.finalRuling;
            uint256 totalDeposit = appealDeposit + confirmAppealDeposit;

            if (appealMaker.ruling == finalRuling) {
                accounting.assign(depositToken, appealMaker.appealer, totalDeposit - feeAmount);
            } else if (appealTaker.ruling == finalRuling) {
                accounting.assign(depositToken, appealTaker.appealer, totalDeposit - feeAmount);
            } else {
                // If the final ruling wasn't selected by any of the appealing parties or no jurors voted in the
                // final round, return their deposits minus half of the fees to each party
                accounting.assign(depositToken, appealMaker.appealer, appealDeposit - feeAmount / 2);
                accounting.assign(depositToken, appealTaker.appealer, confirmAppealDeposit - feeAmount / 2);
            }
        }

        round.settledAppeals = true;
    }

    /**
    * @notice Get the weight of `_voter` for vote #`_voteId` and check if votes can be committed
    * @param _voteId ID of the vote instance to request the weight of a voter for
    * @param _voter Address of the voter querying the weight of
    * @return Weight of the requested juror for the requested dispute's round
    */
    function getVoterWeightToCommit(uint256 _voteId, address _voter) external ensureTerm only(voting) returns (uint64) {
        (uint256 disputeId, uint256 roundId) = _decodeVoteId(_voteId);
        _checkAdjudicationState(disputeId, roundId, AdjudicationState.Commit);
        return _computeJurorWeight(disputeId, roundId, _voter);
    }

    /**
    * @notice Get the weight of `_voter` for vote #`_voteId` and check if votes can be revealed
    * @param _voteId ID of the vote instance to request the weight of a voter for
    * @param _voter Address of the voter querying the weight of
    * @return Weight of the requested juror for the requested dispute's round
    */
    function getVoterWeightToReveal(uint256 _voteId, address _voter) external ensureTerm only(voting) returns (uint64) {
        (uint256 disputeId, uint256 roundId) = _decodeVoteId(_voteId);
        _checkAdjudicationState(disputeId, roundId, AdjudicationState.Reveal);
        return _computeJurorWeight(disputeId, roundId, _voter);
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
    * @dev Tell the current term identification number. Note that the current term may not be ensured yet.
    * @return Identification number of the current term
    */
    function getCurrentTermId() external view returns (uint64) {
        // We assume the term identification will never reach 2^64
        return termId + neededTermTransitions();
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
    function getTerm(uint64 _termId) external view returns (uint64, uint64, uint64, uint64, bytes32) {
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
        require(_termId <= termId, ERROR_WRONG_TERM);
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
    */
    function getDispute(uint256 _disputeId) external disputeExists(_disputeId) view
        returns (address subject, uint8 possibleRulings, DisputeState state, uint8 finalRuling)
    {
        Dispute storage dispute = disputes[_disputeId];
        return (dispute.subject, dispute.possibleRulings, dispute.state, dispute.finalRuling);
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
    * @return settledPenalties TODO
    * @return slashedTokens TODO
    */
    function getAdjudicationRound(uint256 _disputeId, uint256 _roundId) external view
        returns (
            uint64 draftTerm,
            uint64 delayedTerms,
            uint64 jurorsNumber,
            uint64 selectedJurors,
            address triggeredBy,
            bool settledPenalties,
            uint256 slashedTokens
        )
    {
        // TODO: could not add round exists modifier due to size limit
        AdjudicationRound storage round = disputes[_disputeId].rounds[_roundId];
        return (
            round.draftTermId,
            round.delayTerms,
            round.jurorNumber,
            round.filledSeats,
            round.triggeredBy,
            round.settledPenalties,
            round.collectedTokens
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
    function getJuror(uint256 _disputeId, uint256 _roundId, address _juror) external roundExists(_disputeId, _roundId) view
        returns (uint64 weight, bool rewarded)
    {
        weight = _getJurorWeight(_disputeId, _roundId, _juror);
        rewarded = disputes[_disputeId].rounds[_roundId].jurorSlotStates[_juror].rewarded;
    }

    /**
    * @notice Send a heartbeat to the Court to transition up to `_maxRequestedTransitions` terms
    * @param _maxRequestedTransitions Max number of term transitions allowed by the sender
    */
    function heartbeat(uint64 _maxRequestedTransitions) public {
        uint64 neededTransitions = neededTermTransitions();
        uint256 transitions = uint256(_maxRequestedTransitions < neededTransitions ? _maxRequestedTransitions : neededTransitions);
        require(transitions > uint256(0), ERROR_INVALID_TRANSITION_TERMS);

        // Transition the minimum number of terms between the amount requested and the amount actually needed
        uint256 totalFee;
        for (uint256 transition = 1; transition <= transitions; transition++) {
            Term storage previousTerm = terms[termId++];
            Term storage currentTerm = terms[termId];

            // TODO: allow config to be changed for a future term id
            currentTerm.courtConfigId = previousTerm.courtConfigId;
            // Set the start time of the new term. Note that we are using a constant term duration value to guarantee
            // equally long terms, regardless of heartbeats.
            currentTerm.startTime = previousTerm.startTime + termDuration;
            // In order to draft a random number of jurors in a term, we use a randomness factor for each term based on a
            // block number that is set once the term has started. Note that this information could not be known beforehand.
            currentTerm.randomnessBN = getBlockNumber64() + 1;
            emit NewTerm(termId, msg.sender);

            // Add amount of fees to be paid for the transitioned term
            CourtConfig storage config = courtConfigs[currentTerm.courtConfigId];
            totalFee = totalFee.add(config.heartbeatFee.mul(uint256(currentTerm.dependingDrafts)));
        }

        // Pay heartbeat fees to the caller of this function
        if (totalFee > uint256(0)) {
            accounting.assign(config.feeToken, msg.sender, totalFee);
        }
    }

    /**
    * @dev Tells the number of terms the Court should transition to be up-to-date
    * @return Number of terms the Court should transition to be up-to-date
    */
    function neededTermTransitions() public view returns (uint64) {
        // Note that the Court is always initialized at least for the current initialization time or more likely a
        // in the future. If that the case, no term transitions are needed.
        uint64 currentTermStartTime = terms[termId].startTime;
        if (getTimestamp64() < currentTermStartTime) {
            return uint64(0);
        }

        // We already know that the start time of the current term is in the past, we are safe to avoid SafeMath here
        return (getTimestamp64() - currentTermStartTime) / termDuration;
    }

    function getNextAppealDetails(uint256 _disputeId, uint256 _roundId) public view
        returns (
            uint64 appealDraftTermId,
            uint64 appealJurorNumber,
            ERC20 feeToken,
            uint256 feeAmount,
            uint256 jurorFees,
            uint256 appealDeposit,
            uint256 confirmAppealDeposit
        )
    {
        AdjudicationRound storage currentRound = disputes[_disputeId].rounds[_roundId];

        return _getNextAppealDetails(currentRound, _roundId);
    }

    /**
    * @dev Internal function to ensure the current term. If the Court term is outdated it will update it. Note that this function
    *      only allows updating the Court by one term, if more terms are required, users will have to call the heartbeat function manually.
    */
    function _ensureTerm() internal {
        uint64 requiredTransitions = neededTermTransitions();
        require(requiredTransitions <= MAX_AUTO_TERM_TRANSITIONS_ALLOWED, ERROR_TOO_MANY_TRANSITIONS);

        if (requiredTransitions > uint256(0)) {
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

    function _createRound(uint256 _disputeId, DisputeState _disputeState, uint64 _draftTermId, uint64 _jurorNumber, uint256 _jurorFees) internal
        returns (uint256 roundId)
    {
        // TODO: ensure we cannot create rounds for term zero
        Dispute storage dispute = disputes[_disputeId];
        dispute.state = _disputeState;

        roundId = dispute.rounds.length;
        dispute.rounds.length = roundId + 1;

        AdjudicationRound storage round = dispute.rounds[roundId];
        uint256 voteId = _getVoteId(_disputeId, roundId);
        voting.create(voteId, dispute.possibleRulings);
        round.draftTermId = _draftTermId;
        round.jurorNumber = _jurorNumber;
        // TODO: review this commented line
        // round.filledSeats = 0;
        round.triggeredBy = msg.sender;
        round.jurorFees = _jurorFees;

        terms[_draftTermId].dependingDrafts += 1;
    }

    function _ensureFinalRuling(uint256 _disputeId) internal returns (uint8) {
        // Check if there was a final ruling already cached
        Dispute storage dispute = disputes[_disputeId];
        if (dispute.finalRuling > 0) {
            return dispute.finalRuling;
        }

        // Ensure the last adjudication round has ended. Note that there will always be at least one round.
        uint256 lastRoundId = dispute.rounds.length - 1;
        _checkAdjudicationState(_disputeId, lastRoundId, AdjudicationState.Ended);

        // If the last adjudication round was appealed but no-one confirmed it, the final ruling is the outcome the
        // appealer vouched for. Otherwise, fetch the winning outcome from the voting app of the last round.
        AdjudicationRound storage lastRound = disputes[_disputeId].rounds[lastRoundId];
        bool isRoundAppealedAndNotConfirmed = _isRoundAppealed(lastRound) && !_isRoundAppealConfirmed(lastRound);
        uint8 finalRuling = isRoundAppealedAndNotConfirmed
        ? lastRound.appealMaker.ruling
        : voting.getWinningOutcome(_getVoteId(_disputeId, lastRoundId));

        // Store the winning ruling as the final decision for the given dispute
        dispute.finalRuling = finalRuling;
        return finalRuling;
    }

    // @dev zero `_jurorsToSettle` means all
    function _settleRegularRoundSlashing(
        AdjudicationRound storage _round,
        uint256 _voteId,
        uint8 _finalRuling,
        uint16 _penaltyPct,
        uint256 _jurorsToSettle
    )
        internal
        returns (uint256)
    {
        // TODO: stack too deep uint64 slashingUpdateTermId = termId + 1;
        // The batch starts at where the previous one ended, stored in _round.settledJurors
        uint256 roundSettledJurors = _round.settledJurors;
        // Here we compute the amount of jurors that are going to be selected in this call, which is returned by the function for fees calculation
        // Initially we try to reach the end of the jurors array
        uint256 batchSettledJurors = _round.jurors.length - roundSettledJurors;
        // If the jurors that are going to be settled in this call are more than the requested number,
        // we reduce that amount and the end position in the jurors array
        // (_jurorsToSettle = 0 means settle them all)
        if (_jurorsToSettle > 0 && batchSettledJurors > _jurorsToSettle) {
            batchSettledJurors = _jurorsToSettle;
            // If we don't reach the end
            _round.settledJurors = uint64(roundSettledJurors + _jurorsToSettle); // TODO: check overflow
        } else { // otherwise, we are reaching the end of the array, so it's the last batch
            _round.settledPenalties = true;
            // No need to set _round.settledJurors, as it's the last batch
        }

        address[] memory jurors = new address[](batchSettledJurors);
        uint256[] memory penalties = new uint256[](batchSettledJurors);
        for (uint256 i = 0; i < batchSettledJurors; i++) {
            address juror = _round.jurors[roundSettledJurors + i];
            jurors[i] = juror;
            // TODO: stack too deep
            penalties[i] = jurorsRegistry.minJurorsActiveBalance().pct(_penaltyPct) * _round.jurorSlotStates[juror].weight;
        }

        // Check which of the batch of jurors voted in favor of the final ruling of the dispute in this round
        // we assume `jurorsInFavor` length is equal to `batchSettledJurors`
        bool[] memory jurorsInFavor = voting.getVotersInFavorOf(_voteId, _finalRuling, jurors);

        uint256 collectedTokens = jurorsRegistry.slashOrUnlock(termId, jurors, penalties, jurorsInFavor);
        _round.collectedTokens = _round.collectedTokens.add(collectedTokens);
        return batchSettledJurors;
    }

    /**
    * @dev Internal function to compute the juror weight for a dispute's round
    * @param _disputeId ID of the dispute to calculate the juror's weight of
    * @param _roundId ID of the dispute's round to calculate the juror's weight of
    * @param _juror Address of the juror to calculate the weight of
    * @return Computed weight of the requested juror for the final round of the given dispute
    */
    function _computeJurorWeight(uint256 _disputeId, uint256 _roundId, address _juror) internal returns (uint64) {
        // Note that it is safe to access a court config directly for a past term
        CourtConfig storage config = courtConfigs[terms[disputes[_disputeId].rounds[_roundId].draftTermId].courtConfigId];

        return (_roundId < config.maxRegularAppealRounds)
        ? _getJurorWeightForRegularRound(_disputeId, _roundId, _juror)
        : _computeJurorWeightForFinalRound(_disputeId, _roundId, _juror);
    }

    /**
    * @dev Internal function to compute the juror weight for the final round. Note that for a final round the weight of
    *      each juror is equal to the number of times the min active balance the juror has. This function will try to
    *      collect said amount from the active balance of a juror, acting as a lock to allow them to vote.
    * @param _disputeId ID of the dispute to calculate the juror's weight of
    * @param _roundId ID of the dispute's round to calculate the juror's weight of
    * @param _juror Address of the juror to calculate the weight of
    * @return Weight of the requested juror for the final round of the given dispute
    */
    function _computeJurorWeightForFinalRound(uint256 _disputeId, uint256 _roundId, address _juror) internal returns (uint64) {
        AdjudicationRound storage round = disputes[_disputeId].rounds[_roundId];
        JurorState storage jurorState = round.jurorSlotStates[_juror];

        // If the juror weight for the last round was already computed, return that value
        if (jurorState.weight != uint64(0)) {
            return jurorState.weight;
        }

        // If the juror weight for the last round is zero, return zero
        uint64 weight = _getJurorWeightForFinalRound(_disputeId, _roundId, _juror);
        if (weight == uint64(0)) {
            return uint64(0);
        }

        // Note that it is safe to access a court config directly for a past term
        uint64 draftTermId = round.draftTermId;
        CourtConfig storage config = courtConfigs[terms[draftTermId].courtConfigId];

        // To guarantee scalability of the final round, since all jurors may vote, we try to collect the amount of
        // active tokens that needs to be locked for each juror when they try to commit their vote.
        uint256 activeBalance = jurorsRegistry.activeBalanceOfAt(_juror, draftTermId);
        uint256 weightedPenalty = activeBalance.pct(config.penaltyPct);
        if (!jurorsRegistry.collectTokens(_juror, weightedPenalty, termId)) {
            // If it was not possible to collect the amount to be locked, return 0 to prevent juror from voting
            return uint64(0);
        }

        // If it was possible to collect the amount of active tokens to be locked, update the final round state
        jurorState.weight = weight;
        round.collectedTokens = round.collectedTokens.add(weightedPenalty);
        return weight;
    }

    // TODO: Expose external function to change config
    function _setCourtConfig(
        uint64 _fromTermId,
        ERC20 _feeToken,
        uint256[4] _fees, // _jurorFee, _heartbeatFee, _draftFee, _settleFee
        uint64[4] _roundStateDurations,
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
        // We make sure that when applying penalty pct to juror min stake it doesn't result in zero
        uint256 minJurorsActiveBalance = jurorsRegistry.minJurorsActiveBalance();
        require(uint256(_penaltyPct) * minJurorsActiveBalance >= PctHelpers.base(), ERROR_WRONG_PENALTY_PCT);
        require(
            _maxRegularAppealRounds > uint32(0) && _maxRegularAppealRounds <= MAX_REGULAR_APPEAL_ROUNDS_LIMIT,
            ERROR_INVALID_MAX_APPEAL_ROUNDS
        );

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

    function _payGeneric(ERC20 _paymentToken, uint256 _amount) internal {
        if (_amount > uint256(0)) {
            require(_paymentToken.safeTransferFrom(msg.sender, address(accounting), _amount), ERROR_DEPOSIT_FAILED);
        }
    }

    /**
    * @dev Internal function to get the juror weight for a dispute's round
    * @param _disputeId ID of the dispute to calculate the juror's weight of
    * @param _roundId ID of the dispute's round to calculate the juror's weight of
    * @param _juror Address of the juror to calculate the weight of
    * @return Weight of the requested juror for the final round of the given dispute
    */
    function _getJurorWeight(uint256 _disputeId, uint256 _roundId, address _juror) internal view returns (uint64) {
        // Note that it is safe to access a court config directly for a past term
        CourtConfig storage config = courtConfigs[terms[disputes[_disputeId].rounds[_roundId].draftTermId].courtConfigId];

        return (_roundId < config.maxRegularAppealRounds)
            ? _getJurorWeightForRegularRound(_disputeId, _roundId, _juror)
            : _getJurorWeightForFinalRound(_disputeId, _roundId, _juror);
    }

    /**
    * @dev Internal function to get the juror weight for a regular round. Note that the weight of a juror for a regular
    *      round is the number of times a juror was picked for the round draft.
    * @param _disputeId ID of the dispute to calculate the juror's weight of
    * @param _roundId ID of the dispute's round to calculate the juror's weight of
    * @param _juror Address of the juror to calculate the weight of
    * @return Weight of the requested juror for the final round of the given dispute
    */
    function _getJurorWeightForRegularRound(uint256 _disputeId, uint256 _roundId, address _juror) internal view returns (uint64) {
        return disputes[_disputeId].rounds[_roundId].jurorSlotStates[_juror].weight;
    }

    /**
    * @dev Internal function to get the juror weight for the final round. Note that for the final round the weight of
    *      each juror is equal to the number of times the min active balance the juror has, multiplied by a precision
    *      factor to deal with division rounding.
    * @param _disputeId ID of the dispute to calculate the juror's weight of
    * @param _roundId ID of the dispute's round to calculate the juror's weight of
    * @param _juror Address of the juror to calculate the weight of
    * @return Weight of the requested juror for the final round of the given dispute
    */
    function _getJurorWeightForFinalRound(uint256 _disputeId, uint256 _roundId, address _juror) internal view returns (uint64) {
        AdjudicationRound storage round = disputes[_disputeId].rounds[_roundId];
        uint256 activeBalance = jurorsRegistry.activeBalanceOfAt(_juror, round.draftTermId);
        uint256 minJurorsActiveBalance = jurorsRegistry.minJurorsActiveBalance();

        // Note that jurors may not reach the minimum active balance since some might have been slashed. If that occurs,
        // these jurors cannot vote in the final round.
        if (activeBalance < minJurorsActiveBalance) {
            return uint64(0);
        }

        // Otherwise, return the times the active balance of the juror fits in the min active balance, multiplying
        // it by a round factor to ensure a better precision rounding.
        return (FINAL_ROUND_WEIGHT_PRECISION.mul(activeBalance) / minJurorsActiveBalance).toUint64();
    }

    function _endTermForAdjudicationRound(AdjudicationRound storage round) internal view returns (uint64) {
        uint64 draftTermId = round.draftTermId;
        uint64 configId = terms[draftTermId].courtConfigId;
        CourtConfig storage config = courtConfigs[uint256(configId)];

        return draftTermId + round.delayTerms + config.commitTerms + config.revealTerms + config.appealTerms + config.appealConfirmTerms;
    }

    function _getNextAppealDetails(AdjudicationRound storage _currentRound, uint256 _roundId) internal view
        returns (
            uint64 appealDraftTermId,
            uint64 appealJurorNumber,
            ERC20 feeToken,
            uint256 feeAmount,
            uint256 jurorFees,
            uint256 appealDeposit,
            uint256 confirmAppealDeposit
        )
    {
        CourtConfig storage config = courtConfigs[terms[_currentRound.draftTermId].courtConfigId];
        require(_roundId < config.maxRegularAppealRounds, ERROR_INVALID_ADJUDICATION_ROUND);

        appealDraftTermId = _endTermForAdjudicationRound(_currentRound);

        if (_roundId >= config.maxRegularAppealRounds - 1) { // next round is the final round
            // number of jurors will be the number of times the minimum stake is hold in the tree, multiplied by a precision factor for division roundings
            appealJurorNumber = _getFinalAdjudicationRoundJurorNumber();
            (feeToken, feeAmount, jurorFees) = _getFeesForFinalRound(appealDraftTermId, appealJurorNumber);
        } else { // next round is a regular round
            appealJurorNumber = _getRegularAdjudicationRoundJurorNumber(config.appealStepFactor, _currentRound.jurorNumber);
            (feeToken, feeAmount, jurorFees) = _getFeesForRegularRound(appealDraftTermId, appealJurorNumber);
        }

        // collateral
        appealDeposit = feeAmount * APPEAL_COLLATERAL_FACTOR;
        confirmAppealDeposit = feeAmount * APPEAL_CONFIRMATION_COLLATERAL_FACTOR;
    }

    function _getRegularAdjudicationRoundJurorNumber(uint64 _appealStepFactor, uint64 _currentRoundJurorNumber) internal pure
        returns (uint64 appealJurorNumber)
    {
        appealJurorNumber = _appealStepFactor * _currentRoundJurorNumber;
        // make sure it's odd
        if (appealJurorNumber % 2 == 0) {
            appealJurorNumber++;
        }
    }

    // TODO: gives different results depending on when it's called!! (as it depends on current `termId`)
    function _getFinalAdjudicationRoundJurorNumber() internal view returns (uint64 appealJurorNumber) {
        // the max amount of tokens the registry can hold for this to fit in an uint64 is:
        // 2^64 * minJurorsActiveBalance / FINAL_ROUND_WEIGHT_PRECISION
        // (decimals get cancelled in the division). So it seems enough.
        appealJurorNumber = uint64(
            FINAL_ROUND_WEIGHT_PRECISION *
            jurorsRegistry.totalActiveBalanceAt(termId) /
            jurorsRegistry.minJurorsActiveBalance()
        );
    }

    /**
     * @dev Assumes term is up to date. This function only works for regular rounds.
     */
    function _getFeesForRegularRound(uint64 _draftTermId, uint64 _jurorNumber) internal view
        returns (ERC20 feeToken, uint256 feeAmount, uint256 jurorFees)
    {
        CourtConfig storage config = _courtConfigForTerm(_draftTermId);

        feeToken = config.feeToken;
        jurorFees = _jurorNumber * config.jurorFee;
        feeAmount = config.heartbeatFee + jurorFees + _jurorNumber * (config.draftFee + config.settleFee);
    }

    function _getFeesForFinalRound(uint64 _draftTermId, uint64 _jurorNumber) internal view
        returns (ERC20 feeToken, uint256 feeAmount, uint256 jurorFees)
    {
        CourtConfig storage config = _courtConfigForTerm(_draftTermId);
        feeToken = config.feeToken;
        // number of jurors is the number of times the minimum stake is hold in the registry, multiplied by a precision factor for division roundings
        // besides, apply final round discount
        jurorFees = (_jurorNumber * config.jurorFee / FINAL_ROUND_WEIGHT_PRECISION).pct(config.finalRoundReduction);
        feeAmount = config.heartbeatFee + jurorFees;
    }

    function _isRoundAppealed(AdjudicationRound storage _round) internal view returns (bool) {
        return _round.appealMaker.appealer != address(0);
    }

    function _isRoundAppealConfirmed(AdjudicationRound storage _round) internal view returns (bool) {
        return _round.appealTaker.appealer != address(0);
    }

    function _checkAdjudicationState(uint256 _disputeId, uint256 _roundId, AdjudicationState _state) internal view {
        Dispute storage dispute = disputes[_disputeId];
        DisputeState disputeState = dispute.state;

        require(disputeState == DisputeState.Adjudicating, ERROR_INVALID_DISPUTE_STATE);
        require(_roundId == dispute.rounds.length - 1, ERROR_INVALID_ADJUDICATION_ROUND);
        require(_adjudicationStateAtTerm(_disputeId, _roundId, termId) == _state, ERROR_INVALID_ADJUDICATION_STATE);
    }

    function _adjudicationStateAtTerm(uint256 _disputeId, uint256 _roundId, uint64 _termId) internal view returns (AdjudicationState) {
        Dispute storage dispute = disputes[_disputeId];
        AdjudicationRound storage round = dispute.rounds[_roundId];

        // we use the config for the original draft term and only use the delay for the timing of the rounds
        uint64 draftTermId = round.draftTermId;
        uint64 configId = terms[draftTermId].courtConfigId;
        uint64 draftFinishedTermId = draftTermId + round.delayTerms;
        CourtConfig storage config = courtConfigs[uint256(configId)];

        uint64 revealStart = draftFinishedTermId + config.commitTerms;
        uint64 appealStart = revealStart + config.revealTerms;
        uint64 appealConfStart = appealStart + config.appealTerms;
        uint64 appealConfEnded = appealConfStart + config.appealConfirmTerms;

        if (_termId < draftFinishedTermId) {
            return AdjudicationState.Invalid;
        } else if (_termId < revealStart) {
            return AdjudicationState.Commit;
        } else if (_termId < appealStart) {
            return AdjudicationState.Reveal;
        } else if (_termId < appealConfStart && _roundId < config.maxRegularAppealRounds) {
            return AdjudicationState.Appeal;
        } else if (_termId < appealConfEnded && _roundId < config.maxRegularAppealRounds) {
            return AdjudicationState.AppealConfirm;
        } else {
            return AdjudicationState.Ended;
        }
    }

    function _courtConfigForTerm(uint64 _termId) internal view returns (CourtConfig storage) {
        uint64 feeTermId;

        if (_termId <= termId) {
            feeTermId = _termId; // for past terms, use the fee structure of the specific term
        } else if (configChangeTermId <= _termId) {
            feeTermId = configChangeTermId; // if fees are changing before the draft, use the incoming fee schedule
        } else {
            feeTermId = termId; // if no changes are scheduled, use the current term fee schedule (which CANNOT change for this term)
        }

        uint256 courtConfigId = uint256(terms[feeTermId].courtConfigId);
        return courtConfigs[courtConfigId];
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

    function _getVoteId(uint256 _disputeId, uint256 _roundId) internal pure returns (uint256) {
        return (_disputeId << 128) + _roundId;
    }

    function _decodeVoteId(uint256 _voteId) internal pure returns (uint256 disputeId, uint256 roundId) {
        disputeId = _voteId >> 128;
        roundId = _voteId & 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF;
    }

    /**
    * @dev Private function to draft jurors for a given dispute and round. It assumes the given data is correct
    * @param _jurorsRequested Number of jurors to be drafted for the given dispute. Note that the drafter might have requested part of the jurors number
    * @param _disputeId Identification number of the dispute to be drafted
    * @param _round Round of the dispute to be drafted
    * @param _draftTerm Term in which the dispute was requested to be drafted
    * @param _config Config of the Court at the draft term
    */
    function _draft(uint256 _jurorsRequested, uint256 _disputeId, AdjudicationRound storage _round, Term storage _draftTerm, CourtConfig storage _config) private {
        // Draft jurors for the requested round
        uint256[7] memory draftParams = [
            uint256(_draftTerm.randomness),
            _disputeId,
            termId,
            _round.filledSeats,
            _jurorsRequested,
            _round.jurorNumber,
            _config.penaltyPct
        ];
        (address[] memory jurors, uint64[] memory weights, uint256 outputLength, uint64 selectedJurors) = jurorsRegistry.draft(draftParams);

        // Update round with drafted jurors information
        _round.filledSeats = selectedJurors;
        for (uint256 i = 0; i < outputLength; i++) {
            // If the juror was already registered in the list, then don't add it twice
            address juror = jurors[i];
            if (_round.jurorSlotStates[juror].weight == uint64(0)) {
                _round.jurors.push(juror);
            }
            // We assume a juror cannot be drafted 2^64 times for a round
            _round.jurorSlotStates[juror].weight += weights[i];
        }
    }

    // TODO: move to a factory contract
    function _initJurorsRegistry(IJurorsRegistry _jurorsRegistry, ERC20 _jurorToken, uint256 _minJurorsActiveBalance) private {
        _jurorsRegistry.init(IJurorsRegistryOwner(this), _jurorToken, _minJurorsActiveBalance);
    }

    // TODO: move to a factory contract
    function _initSubscriptions(ERC20 _feeToken, uint256[5] _subscriptionParams) private {
        require(_subscriptionParams[0] <= MAX_UINT64, ERROR_OVERFLOW); // _periodDuration
        require(_subscriptionParams[3] <= MAX_UINT16, ERROR_OVERFLOW); // _latePaymentPenaltyPct
        require(_subscriptionParams[4] <= MAX_UINT16, ERROR_OVERFLOW); // _governorSharePct
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
