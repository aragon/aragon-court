pragma solidity ^0.4.24; // TODO: pin solc

// Inspired by: Kleros.sol https://github.com/kleros/kleros @ 7281e69
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


// solium-disable function-order
contract Court is IJurorsRegistryOwner, ICRVotingOwner, ISubscriptionsOwner {
    using SafeERC20 for ERC20;
    using SafeMath for uint256;
    using Uint256Helpers for uint256;

    uint8 public constant APPEAL_COLLATERAL_FACTOR = 3; // multiple of juror fees required to appeal a preliminary ruling
    uint8 public constant APPEAL_CONFIRMATION_COLLATERAL_FACTOR = 2; // multiple of juror fees required to confirm appeal

    uint256 internal constant MAX_JURORS_PER_DRAFT_BATCH = 10;      // to cap gas used on draft
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
        address[] jurors;
        mapping (address => JurorState) jurorSlotStates;
        Appealer appealMaker;
        Appealer appealTaker;
        uint64 draftTermId;
        uint64 delayTerms;
        uint64 jurorNumber;
        uint64 coherentJurors;
        uint64 nextJurorIndex;
        uint64 filledSeats;
        uint64 settledJurors;
        address triggeredBy;
        bool settledPenalties;
        bool settledAppeals;
        uint256 jurorFees;
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
    mapping (uint64 => Term) public terms;
    Dispute[] public disputes;

    string internal constant ERROR_INVALID_ADDR = "CTBAD_ADDR";
    string internal constant ERROR_DEPOSIT_FAILED = "CTDEPOSIT_FAIL";
    string internal constant ERROR_TOO_MANY_TRANSITIONS = "CTTOO_MANY_TRANSITIONS";
    string internal constant ERROR_UNFINISHED_TERM = "CTUNFINISHED_TERM";
    string internal constant ERROR_PAST_TERM_FEE_CHANGE = "CTPAST_TERM_FEE_CHANGE";
    string internal constant ERROR_OVERFLOW = "CTOVERFLOW";
    string internal constant ERROR_ROUND_ALREADY_DRAFTED = "CTROUND_ALRDY_DRAFTED";
    string internal constant ERROR_NOT_DRAFT_TERM = "CTNOT_DRAFT_TERM";
    string internal constant ERROR_TERM_RANDOMNESS_NOT_YET = "CTRANDOM_NOT_YET";
    string internal constant ERROR_WRONG_TERM = "CTBAD_TERM";
    string internal constant ERROR_TERM_RANDOMNESS_UNAVAIL = "CTRANDOM_UNAVAIL";
    string internal constant ERROR_INVALID_DISPUTE_STATE = "CTBAD_DISPUTE_STATE";
    string internal constant ERROR_INVALID_ADJUDICATION_ROUND = "CTBAD_ADJ_ROUND";
    string internal constant ERROR_INVALID_ADJUDICATION_STATE = "CTBAD_ADJ_STATE";
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
    uint64 internal constant MODIFIER_ALLOWED_TERM_TRANSITIONS = 1;
    //bytes4 private constant ARBITRABLE_INTERFACE_ID = 0xabababab; // TODO: interface id
    uint256 internal constant PCT_BASE = 10000; // ‱
    uint8 internal constant MIN_RULING_OPTIONS = 2;
    uint8 internal constant MAX_RULING_OPTIONS = MIN_RULING_OPTIONS;
    uint256 internal constant MAX_UINT16 = uint16(-1);
    uint64 internal constant MAX_UINT64 = uint64(-1);

    event NewTerm(uint64 termId, address indexed heartbeatSender);
    event NewCourtConfig(uint64 fromTermId, uint64 courtConfigId);
    event DisputeStateChanged(uint256 indexed disputeId, DisputeState indexed state);
    event NewDispute(uint256 indexed disputeId, address indexed subject, uint64 indexed draftTermId, uint64 jurorNumber);
    event RulingAppealed(uint256 indexed disputeId, uint256 indexed roundId, uint8 ruling);
    event RulingAppealConfirmed(uint256 indexed disputeId, uint256 indexed roundId, uint64 indexed draftTermId, uint256 jurorNumber);
    event RulingExecuted(uint256 indexed disputeId, uint8 indexed ruling);
    event RoundSlashingSettled(uint256 indexed disputeId, uint256 indexed roundId, uint256 collectedTokens);
    event RewardSettled(uint256 indexed disputeId, uint256 indexed roundId, address juror);

    modifier only(address _addr) {
        require(msg.sender == _addr, ERROR_INVALID_ADDR);
        _;
    }

    modifier ensureTerm {
        _ensureTerm();
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
        require(_firstTermStartTime >= _termDuration, ERROR_WRONG_TERM);

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
     * @notice Send a heartbeat to the Court to transition up to `_termTransitions`
     */
    function heartbeat(uint64 _termTransitions) public {
        require(canTransitionTerm(), ERROR_UNFINISHED_TERM);

        Term storage prevTerm = terms[termId];
        termId += 1;
        Term storage nextTerm = terms[termId];
        address heartbeatSender = msg.sender;

        // Set fee structure for term
        if (nextTerm.courtConfigId == 0) {
            nextTerm.courtConfigId = prevTerm.courtConfigId;
        } else {
            configChangeTermId = ZERO_TERM_ID; // fee structure changed in this term
        }

        // TODO: skip period if you can

        // Set the start time of the term (ensures equally long terms, regardless of heartbeats)
        nextTerm.startTime = prevTerm.startTime + termDuration;
        nextTerm.randomnessBN = _blockNumber() + 1; // randomness source set to next block (content unknown when heartbeat happens)

        CourtConfig storage courtConfig = courtConfigs[nextTerm.courtConfigId];
        uint256 totalFee = nextTerm.dependingDrafts * courtConfig.heartbeatFee;

        if (totalFee > 0) {
            accounting.assign(courtConfig.feeToken, heartbeatSender, totalFee);
        }

        emit NewTerm(termId, heartbeatSender);

        if (_termTransitions > 1 && canTransitionTerm()) {
            heartbeat(_termTransitions - 1);
        }
    }

    /**
     * @notice Create a dispute over `_subject` with `_possibleRulings` possible rulings, drafting `_jurorNumber` jurors in term `_draftTermId`
     */
    function createDispute(IArbitrable _subject, uint8 _possibleRulings, uint64 _jurorNumber, uint64 _draftTermId)
        external
        ensureTerm
        returns (uint256)
    {
        // TODO: Limit the min amount of terms before drafting (to allow for evidence submission)
        // TODO: Limit the max amount of terms into the future that a dispute can be drafted
        // TODO: Limit the max number of initial jurors
        // TODO: ERC165 check that _subject conforms to the Arbitrable interface

        // TODO: require(address(_subject) == msg.sender, ERROR_INVALID_DISPUTE_CREATOR);
        require(subscriptions.isUpToDate(address(_subject)), ERROR_SUBSCRIPTION_NOT_PAID);
        require(_possibleRulings >= MIN_RULING_OPTIONS && _possibleRulings <= MAX_RULING_OPTIONS, ERROR_INVALID_RULING_OPTIONS);

        uint256 disputeId = disputes.length;
        disputes.length = disputeId + 1;

        Dispute storage dispute = disputes[disputeId];
        dispute.subject = _subject;
        dispute.possibleRulings = _possibleRulings;

        (ERC20 feeToken, uint256 feeAmount, uint256 jurorFees) = _getFeesForRegularRound(_draftTermId, _jurorNumber);
        // pay round fees
        _payGeneric(feeToken, feeAmount);
        _createRound(disputeId, DisputeState.PreDraft, _draftTermId, _jurorNumber, jurorFees);

        emit NewDispute(disputeId, _subject, _draftTermId, _jurorNumber);

        return disputeId;
    }

    /**
     * @notice Draft jurors for the next round of dispute #`_disputeId`
     * @dev Allows for batches, so only up to MAX_JURORS_PER_DRAFT_BATCH will be drafted in each call
     */
    function draftAdjudicationRound(uint256 _disputeId)
        public
        ensureTerm
    {
        Dispute storage dispute = disputes[_disputeId];
        AdjudicationRound storage round = dispute.rounds[dispute.rounds.length - 1];
        // TODO: stack too deep: uint64 draftTermId = round.draftTermId;
        // We keep the inintial term for config, but we update it for randomness seed,
        // as otherwise it would be easier for some juror to add tokens to the registry (or remove them)
        // in order to change the result of the next draft batch
        Term storage draftTerm = terms[termId];
        CourtConfig storage config = courtConfigs[terms[round.draftTermId].courtConfigId]; // safe to use directly as it is current or past term

        require(dispute.state == DisputeState.PreDraft, ERROR_ROUND_ALREADY_DRAFTED);
        require(round.draftTermId <= termId, ERROR_NOT_DRAFT_TERM);
        // Ensure that term has randomness:
        _ensureTermRandomness(draftTerm);
        // as we already allow to move drafting to later terms, if current term has gone
        // more than 256 blocks beyond the randomness BN, it will have to wait until next term
        require(draftTerm.randomness != bytes32(0), ERROR_TERM_RANDOMNESS_UNAVAIL);

        // TODO: stack too deep
        //uint64 jurorNumber = round.jurorNumber;
        if (round.jurors.length == 0) {
            round.jurors.length = round.jurorNumber;
        }

        uint256 jurorsRequested = round.jurorNumber - round.filledSeats;
        if (jurorsRequested > MAX_JURORS_PER_DRAFT_BATCH) {
            jurorsRequested = MAX_JURORS_PER_DRAFT_BATCH;
        }

        uint256[7] memory draftParams = [
            uint256(draftTerm.randomness),
            _disputeId,
            termId,
            round.filledSeats,
            jurorsRequested,
            round.jurorNumber,
            config.penaltyPct
        ];
        (
            address[] memory jurors,
            uint64[] memory weights,
            uint256 jurorsLength,
            uint64 filledSeats
        ) = jurorsRegistry.draft(draftParams);
        uint256 nextJurorIndex = round.nextJurorIndex;
        uint256 jurorsRepeated = 0;
        for (uint256 i = 0; i < jurorsLength; i++) {
            // TODO: stack too deep: address juror = jurors[i];
            if (round.jurorSlotStates[jurors[i]].weight == 0) { // new juror
                round.jurors[nextJurorIndex + i - jurorsRepeated] = jurors[i];
            } else { // repeated juror
                jurorsRepeated++;
            }
            round.jurorSlotStates[jurors[i]].weight += weights[i];
        }
        jurorsLength -= jurorsRepeated;
        // reduce jurors array length because of repeated jurors
        // Althoguh draft function does some grouping, jurors can still be unordered and repeated
        round.jurors.length -= jurorsRequested - jurorsLength;
        // invariant: sum(weights) = jurorsRequested
        round.nextJurorIndex += uint64(jurorsLength);
        round.filledSeats = filledSeats;

        // TODO: reuse draft call (stack too deep!)
        accounting.assign(config.feeToken, msg.sender, config.draftFee * round.jurorNumber);

        // drafting is over
        if (round.filledSeats == round.jurorNumber) {
            if (round.draftTermId < termId) {
                round.delayTerms = termId - round.draftTermId;
            }
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
    function appealConfirm(uint256 _disputeId, uint256 _roundId, uint8 _ruling) external ensureTerm {
        _checkAdjudicationState(_disputeId, _roundId, AdjudicationState.AppealConfirm);

        Dispute storage dispute = disputes[_disputeId];
        AdjudicationRound storage round = dispute.rounds[_roundId];

        require(_isRoundAppealed(round), ERROR_ROUND_NOT_APPEALED);
        require(!_isRoundAppealConfirmed(round), ERROR_ROUND_APPEAL_ALREADY_CONFIRMED);

        uint256 voteId = _getVoteId(_disputeId, _roundId);
        require(round.appealMaker.ruling != _ruling && voting.isValidOutcome(voteId, _ruling), ERROR_INVALID_APPEAL_RULING);

        (uint64 appealDraftTermId, uint64 appealJurorNumber, ERC20 feeToken,, uint256 jurorFees,, uint256 appealConfirmDeposit) = _getNextAppealDetails(round, _roundId);

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
        _payGeneric(feeToken, appealConfirmDeposit);
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

        (,,ERC20 depositToken,uint256 feeAmount,,uint256 appealDeposit, uint256 appealConfirmDeposit) = _getNextAppealDetails(round, _roundId);

        // TODO: could these be real transfers instead of assignTokens?
        if (!_isRoundAppealConfirmed(round)) {
            // return entire deposit to appealer
            accounting.assign(depositToken, appealMaker.appealer, appealDeposit);
        } else {
            Appealer storage appealTaker = round.appealTaker;

            // as round penalties were settled, we are sure we already have final ruling
            uint8 finalRuling = dispute.finalRuling;
            uint256 totalDeposit = appealDeposit + appealConfirmDeposit;

            if (appealMaker.ruling == finalRuling) {
                accounting.assign(depositToken, appealMaker.appealer, totalDeposit - feeAmount);
            } else if (appealTaker.ruling == finalRuling) {
                accounting.assign(depositToken, appealTaker.appealer, totalDeposit - feeAmount);
            } else {
                // If the final ruling wasn't selected by any of the appealing parties or no jurors voted in the
                // final round, return their deposits minus half of the fees to each party
                accounting.assign(depositToken, appealMaker.appealer, appealDeposit - feeAmount / 2);
                accounting.assign(depositToken, appealTaker.appealer, appealConfirmDeposit - feeAmount / 2);
            }
        }

        round.settledAppeals = true;
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
    function _settleRegularRoundSlashing(AdjudicationRound storage _round, uint256 _voteId, uint8 _finalRuling, uint16 _penaltyPct, uint256 _jurorsToSettle)
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
            penalties[i] = _pct4(jurorsRegistry.minJurorsActiveBalance(), _penaltyPct) * _round.jurorSlotStates[juror].weight;
        }

        // Check which of the batch of jurors voted in favor of the final ruling of the dispute in this round
        // we assume `jurorsInFavor` length is equal to `batchSettledJurors`
        bool[] memory jurorsInFavor = voting.getVotersInFavorOf(_voteId, _finalRuling, jurors);

        uint256 collectedTokens = jurorsRegistry.slashOrUnlock(termId, jurors, penalties, jurorsInFavor);
        _round.collectedTokens = _round.collectedTokens.add(collectedTokens);
        return batchSettledJurors;
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

    function canTransitionTerm() public view returns (bool) {
        return neededTermTransitions() >= 1;
    }

    function neededTermTransitions() public view returns (uint64) {
        return (_time() - terms[termId].startTime) / termDuration;
    }

    function ensureAndGetTermId() external returns (uint64) {
        _ensureTerm();
        return termId;
    }

    function getLastEnsuredTermId() external view returns (uint64) {
        return termId;
    }

    function _ensureTerm() internal {
        uint64 requiredTransitions = neededTermTransitions();
        require(requiredTransitions <= MODIFIER_ALLOWED_TERM_TRANSITIONS, ERROR_TOO_MANY_TRANSITIONS);

        if (requiredTransitions > 0) {
            heartbeat(requiredTransitions);
        }
    }

    /**
     * @dev This function only works for regular rounds. For final round `filledSeats` is always zero,
     *      so the result will always be false. There is no drafting in final round.
     */
    function areAllJurorsDrafted(uint256 _disputeId, uint256 _roundId) public view returns (bool) {
        AdjudicationRound storage round = disputes[_disputeId].rounds[_roundId];
        return round.filledSeats == round.jurorNumber;
    }

    function areAllJurorsSettled(uint256 _disputeId, uint256 _roundId) public view returns (bool) {
        return disputes[_disputeId].rounds[_roundId].settledPenalties;
    }

    function getNextAppealDetails(uint256 _disputeId, uint256 _roundId)
        public
        view
        returns (
            uint64 appealDraftTermId,
            uint64 appealJurorNumber,
            ERC20 feeToken,
            uint256 feeAmount,
            uint256 jurorFees,
            uint256 appealDeposit,
            uint256 appealConfirmDeposit
        )
    {
        AdjudicationRound storage currentRound = disputes[_disputeId].rounds[_roundId];

        return _getNextAppealDetails(currentRound, _roundId);
    }

    function getDispute(uint256 _disputeId)
        external
        view
        returns (address subject, uint8 possibleRulings, DisputeState state, uint8 finalRuling)
    {
        Dispute storage dispute = disputes[_disputeId];
        return (dispute.subject, dispute.possibleRulings, dispute.state, dispute.finalRuling);
    }

    function getAdjudicationRound(uint256 _disputeId, uint256 _roundId)
        external
        view
        returns (uint64 draftTerm, uint64 jurorNumber, address triggeredBy, bool settledPenalties, uint256 slashedTokens)
    {
        AdjudicationRound storage round = disputes[_disputeId].rounds[_roundId];
        return (round.draftTermId, round.jurorNumber, round.triggeredBy, round.settledPenalties, round.collectedTokens);
    }

    // Voting interface fns

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
        uint256 weightedPenalty = _pct4(activeBalance, config.penaltyPct);
        if (!jurorsRegistry.collectTokens(_juror, weightedPenalty, termId)) {
            // If it was not possible to collect the amount to be locked, return 0 to prevent juror from voting
            return uint64(0);
        }

        // If it was possible to collect the amount of active tokens to be locked, update the final round state
        jurorState.weight = weight;
        round.collectedTokens = round.collectedTokens.add(weightedPenalty);
        return weight;
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

    function getJurorWeight(uint256 _disputeId, uint256 _roundId, address _juror) external view returns (uint64) {
        return _getJurorWeight(_disputeId, _roundId, _juror);
    }

    function _getVoteId(uint256 _disputeId, uint256 _roundId) internal pure returns (uint256) {
        return (_disputeId << 128) + _roundId;
    }

    function _decodeVoteId(uint256 _voteId) internal pure returns (uint256 disputeId, uint256 roundId) {
        disputeId = _voteId >> 128;
        roundId = _voteId & 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF;
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

    /* Subscriptions interface */
    function getCurrentTermId() external view returns (uint64) {
        return termId + neededTermTransitions();
    }

    function getTermRandomness(uint64 _termId) external view returns (bytes32) {
        require(_termId <= termId, ERROR_WRONG_TERM);
        Term storage term = terms[_termId];

        return _getTermRandomness(term);
    }

    function _getTermRandomness(Term storage _term) internal view returns (bytes32 randomness) {
        require(_blockNumber() > _term.randomnessBN, ERROR_TERM_RANDOMNESS_NOT_YET);

        randomness = blockhash(_term.randomnessBN);
    }

    function getGovernor() external view returns (address) {
        return governor;
    }

    function _payGeneric(ERC20 paymentToken, uint256 amount) internal {
        if (amount > 0) {
            require(paymentToken.safeTransferFrom(msg.sender, address(accounting), amount), ERROR_DEPOSIT_FAILED);
        }
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
            uint256 appealConfirmDeposit
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
        appealConfirmDeposit = feeAmount * APPEAL_CONFIRMATION_COLLATERAL_FACTOR;
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
    function _getFeesForRegularRound(uint64 _draftTermId, uint64 _jurorNumber)
        internal
        view
        returns (ERC20 feeToken, uint256 feeAmount, uint256 jurorFees)
    {
        CourtConfig storage config = _courtConfigForTerm(_draftTermId);

        feeToken = config.feeToken;
        jurorFees = _jurorNumber * config.jurorFee;
        feeAmount = config.heartbeatFee + jurorFees + _jurorNumber * (config.draftFee + config.settleFee);
    }

    function _getFeesForFinalRound(uint64 _draftTermId, uint64 _jurorNumber)
        internal
        view
        returns (ERC20 feeToken, uint256 feeAmount, uint256 jurorFees)
    {
        CourtConfig storage config = _courtConfigForTerm(_draftTermId);
        feeToken = config.feeToken;
        // number of jurors is the number of times the minimum stake is hold in the registry, multiplied by a precision factor for division roundings
        // besides, apply final round discount
        jurorFees = _pct4(_jurorNumber * config.jurorFee / FINAL_ROUND_WEIGHT_PRECISION, config.finalRoundReduction);
        feeAmount = config.heartbeatFee + jurorFees;
    }

    function _isRoundAppealed(AdjudicationRound storage _round) internal view returns (bool) {
        return _round.appealMaker.appealer != address(0);
    }

    function _isRoundAppealConfirmed(AdjudicationRound storage _round) internal view returns (bool) {
        return _round.appealTaker.appealer != address(0);
    }

    function _createRound(
        uint256 _disputeId,
        DisputeState _disputeState,
        uint64 _draftTermId,
        uint64 _jurorNumber,
        uint256 _jurorFees
    )
        internal
        returns (uint256 roundId)
    {
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

    function _ensureTermRandomness(Term storage _term) internal {
        if (_term.randomness == bytes32(0)) {
            _term.randomness = _getTermRandomness(_term);
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
        require(uint256(_penaltyPct) * minJurorsActiveBalance >= PCT_BASE, ERROR_WRONG_PENALTY_PCT);
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

    // TODO: stack too deep, move to a factory contract
    function _initJurorsRegistry(IJurorsRegistry _jurorsRegistry, ERC20 _jurorToken, uint256 _minJurorsActiveBalance) internal {
        _jurorsRegistry.init(IJurorsRegistryOwner(this), _jurorToken, _minJurorsActiveBalance);
    }

    function _initSubscriptions(ERC20 _feeToken, uint256[5] _subscriptionParams) internal {
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

    function _time() internal view returns (uint64) {
        return uint64(block.timestamp);
    }

    function _blockNumber() internal view returns (uint64) {
        return uint64(block.number);
    }

    function _pct4(uint256 _number, uint16 _pct) internal pure returns (uint256) {
        return _number * uint256(_pct) / PCT_BASE;
    }
}
