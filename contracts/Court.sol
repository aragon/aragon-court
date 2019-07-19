pragma solidity ^0.4.24; // TODO: pin solc

// Inspired by: Kleros.sol https://github.com/kleros/kleros @ 7281e69
import "./standards/sumtree/ISumTree.sol";
import "./standards/arbitration/IArbitrable.sol";
import "./standards/erc900/IStaking.sol";
import "./standards/erc900/IStakingOwner.sol";
import "./standards/voting/ICRVoting.sol";
import "./standards/voting/ICRVotingOwner.sol";
import "./standards/subscription/ISubscriptions.sol";
import "./standards/subscription/ISubscriptionsOwner.sol";
import "./standards/finalround/IFinalRound.sol";

import "@aragon/os/contracts/lib/token/ERC20.sol";
import "@aragon/os/contracts/common/SafeERC20.sol";
import "@aragon/os/contracts/lib/math/SafeMath.sol";


// solium-disable function-order
contract Court is IStakingOwner, ICRVotingOwner, ISubscriptionsOwner {
    using SafeERC20 for ERC20;
    using SafeMath for uint256;

    uint256 internal constant MAX_JURORS_PER_DRAFT_BATCH = 10; // to cap gas used on draft
    uint256 internal constant MAX_REGULAR_APPEAL_ROUNDS = 4; // before the final appeal
    uint64 internal constant APPEAL_STEP_FACTOR = 3;
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
        uint16 penaltyPct;
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
        Appealable,
        Ended
    }

    struct JurorState {
        uint64 weight;
        bool rewarded;
    }

    struct AdjudicationRound {
        address[] jurors;
        mapping (address => JurorState) jurorSlotStates;
        uint64 draftTermId;
        uint64 delayTerms;
        uint64 jurorNumber;
        uint64 coherentJurors;
        uint64 nextJurorIndex;
        uint64 filledSeats;
        uint64 settledJurors;
        address triggeredBy;
        bool settledPenalties;
        uint256 jurorFees;
        // for regular rounds this contains penalties from non-winning jurors, collected after reveal period
        uint256 collectedTokens;
    }

    enum DisputeState {
        PreDraft,
        Adjudicating,
        FinalRound,
        Executed
    }

    struct Dispute {
        IArbitrable subject;
        uint8 possibleRulings;      // number of possible rulings the court can decide on
        uint8 winningRuling;
        DisputeState state;
        AdjudicationRound[] rounds;
    }

    // State constants which are set in the constructor/init and can't change
    address owner;
    uint64 public termDuration; // recomended value ~1 hour as 256 blocks (available block hash) around an hour to mine
    IStaking internal staking;
    ICRVoting internal voting;
    ISumTree internal sumTree;
    ISubscriptions internal subscriptions;
    IFinalRound internal finalRounds;

    // Global config, configurable by governor
    address internal governor; // TODO: consider using aOS' ACL
    // TODO: remove jurorMinStake from here, as it's duplicated in CourtStaking
    // notice that for final round the max amount the tree can hold is 2^64 * jurorMinStake / FINAL_ROUND_WEIGHT_PRECISION
    // so make sure not to set this too low (as long as it's over the unit should be fine)
    uint256 public jurorMinStake; // TODO: consider adding it to the conf
    CourtConfig[] public courtConfigs;

    // Court state
    uint64 public termId;
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

    uint64 internal constant ZERO_TERM_ID = 0; // invalid term that doesn't accept disputes
    uint64 internal constant MODIFIER_ALLOWED_TERM_TRANSITIONS = 1;
    bytes4 private constant ARBITRABLE_INTERFACE_ID = 0xabababab; // TODO: interface id
    uint256 internal constant PCT_BASE = 10000; // ‱
    uint8 internal constant MIN_RULING_OPTIONS = 2;
    uint8 internal constant MAX_RULING_OPTIONS = MIN_RULING_OPTIONS;
    uint256 internal constant MAX_UINT16 = uint16(-1);
    uint64 internal constant MAX_UINT64 = uint64(-1);

    event NewTerm(uint64 termId, address indexed heartbeatSender);
    event NewCourtConfig(uint64 fromTermId, uint64 courtConfigId);
    event DisputeStateChanged(uint256 indexed disputeId, DisputeState indexed state);
    event NewDispute(uint256 indexed disputeId, address indexed subject, uint64 indexed draftTermId, uint64 jurorNumber);
    event RulingAppealed(uint256 indexed disputeId, uint256 indexed roundId, uint64 indexed draftTermId, uint64 jurorNumber);
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
     * @param _firstTermStartTime Timestamp in seconds when the court will open (to give time for juror onboarding)
     * @param _feeToken The address of the token contract that is used to pay for fees.
     * @param _fees Array containing:
     *        _jurorFee The amount of _feeToken that is paid per juror per dispute
     *        _heartbeatFee The amount of _feeToken per dispute to cover maintenance costs.
     *        _draftFee The amount of _feeToken per juror to cover the drafting cost.
     *        _settleFee The amount of _feeToken per juror to cover round settlement cost.
     * @param _governor Address of the governor contract.
     * @param _roundStateDurations Number of terms that the different states a dispute round last
     * @param _penaltyPct ‱ of jurorMinStake that can be slashed (1/10,000)
     */
    constructor(
        uint64 _termDuration,
        uint64 _firstTermStartTime,
        ERC20 _feeToken,
        uint256[4] _fees, // _jurorFee, _heartbeatFee, _draftFee, _settleFee
        address _governor,
        uint64[3] _roundStateDurations,
        uint16 _penaltyPct
    ) public {
        require(_firstTermStartTime >= _termDuration, ERROR_WRONG_TERM);

        owner = msg.sender;

        termDuration = _termDuration;
        governor = _governor;

        courtConfigs.length = 1; // leave index 0 empty
        _setCourtConfig(
            ZERO_TERM_ID,
            _feeToken,
            _fees,
            _roundStateDurations,
            _penaltyPct
        );
        terms[ZERO_TERM_ID].startTime = _firstTermStartTime - _termDuration;
    }

    /**
     * @param _staking The address of the Staking component of the Court
     * @param _voting The address of the Commit Reveal Voting contract.
     * @param _sumTree The address of the contract storing de Sum Tree for sortitions.
     * @param _jurorToken The address of the juror work token contract.
     * @param _jurorMinStake Minimum amount of juror tokens that can be activated
     * @param _finalRoundReduction ‱ of fee reduction for the last appeal round (1/10,000)
     * @param _subscriptionParams Array containing params for Subscriptions:
     *        _periodDuration Length of Subscription periods
     *        _feeAmount Amount of periodic fees
     *        _prePaymentPeriods Max number of payments that can be done in advance
     *        _latePaymentPenaltyPct Penalty for not paying on time
     *        _governorSharePct Share of paid fees that goes to governor
     */
    function init(
        IStaking _staking,
        ICRVoting _voting,
        ISumTree _sumTree,
        ISubscriptions _subscriptions,
        IFinalRound _finalRounds,
        ERC20 _jurorToken,
        uint256 _jurorMinStake,
        uint16 _finalRoundReduction,
        uint256[5] _subscriptionParams // _periodDuration, _feeAmount, _prePaymentPeriods, _latePaymentPenaltyPct, _governorSharePct
    )
        public
        only(owner)
    {
        staking = _staking;
        voting = _voting;
        sumTree = _sumTree;
        subscriptions = _subscriptions;
        finalRounds = _finalRounds;
        jurorMinStake = _jurorMinStake;

        staking.init(IStakingOwner(this), address(_finalRounds), _sumTree, _jurorToken, _jurorMinStake);
        voting.setOwner(ICRVotingOwner(this));
        _initSubscriptions(_jurorToken, _subscriptionParams, _sumTree);
        finalRounds.init(address(this), _voting, _staking, _finalRoundReduction, MAX_REGULAR_APPEAL_ROUNDS);
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
            staking.assignTokens(courtConfig.feeToken, heartbeatSender, totalFee);
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

        // _createRound charges fees for starting the round
        _createRound(disputeId, DisputeState.PreDraft, _draftTermId, _jurorNumber);

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
        // as otherwise it would be easier for some juror to add tokens to the tree (or remove them)
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
        ) = staking.draft(draftParams);
        // reduce jurors array length because of repeated jurors
        round.jurors.length -= jurorsRequested - jurorsLength;
        uint256 nextJurorIndex = round.nextJurorIndex;
        for (uint256 i = 0; i < jurorsLength; i++) {
            // TODO: stack too deep: address juror = jurors[i];
            round.jurors[nextJurorIndex + i] = jurors[i];
            round.jurorSlotStates[jurors[i]].weight += weights[i];
        }
        // invariant: sum(weights) = jurorsRequested
        round.nextJurorIndex += uint64(jurorsLength);
        round.filledSeats = filledSeats;

        // TODO: reuse draft call (stack too deep!)
        staking.assignTokens(config.feeToken, msg.sender, config.draftFee * round.jurorNumber);

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
     * @notice Appeal last round in dispute #`_disputeId`
     */
    function appealRuling(uint256 _disputeId) external ensureTerm {

        Dispute storage dispute = disputes[_disputeId];
        uint256 nextRoundId = dispute.rounds.length;
        uint256 currentRoundId = nextRoundId - 1;

        _checkAdjudicationState(_disputeId, currentRoundId, AdjudicationState.Appealable);

        AdjudicationRound storage currentRound = dispute.rounds[currentRoundId];

        uint64 appealJurorNumber;
        uint64 appealDraftTermId = termId + 1; // Appeals are drafted in the next term

        if (nextRoundId == MAX_REGULAR_APPEAL_ROUNDS) { // final round, roundId starts at 0
            CourtConfig storage config = _courtConfigForTerm(appealDraftTermId);

            dispute.state = DisputeState.FinalRound;

            appealJurorNumber = finalRounds.createRound(
                _disputeId,
                appealDraftTermId,
                msg.sender,
                termId,
                config.feeToken,
                config.heartbeatFee,
                config.jurorFee,
                config.penaltyPct,
                config.commitTerms,
                config.revealTerms
            );
            // create vote
            uint256 voteId = _getVoteId(_disputeId, nextRoundId);
            voting.createVote(voteId, dispute.possibleRulings);
        } else {
            // no need for more checks, as final appeal won't ever be in Appealable state,
            // so it would never reach here (first check would fail), but we add this as a sanity check
            assert(nextRoundId < MAX_REGULAR_APPEAL_ROUNDS);
            appealJurorNumber = _getRegularAdjudicationRoundJurorNumber(currentRound.jurorNumber);
            _createRound(_disputeId, DisputeState.PreDraft, appealDraftTermId, appealJurorNumber);
        }

        emit RulingAppealed(_disputeId, nextRoundId, appealDraftTermId, appealJurorNumber);
    }

    /**
     * @notice Execute the final ruling of dispute #`_disputeId`
     */
    function executeRuling(uint256 _disputeId) external ensureTerm {
        Dispute storage dispute = disputes[_disputeId];

        uint8 winningRuling = _ensureFinalRuling(_disputeId);
        dispute.state = DisputeState.Executed;

        dispute.subject.rule(_disputeId, uint256(winningRuling));

        emit RulingExecuted(_disputeId, winningRuling);
    }

    /**
     * @notice Execute the final ruling of dispute #`_disputeId`
     * @dev Just executes penalties, jurors must manually claim their rewards
     */
    function settleRoundSlashing(uint256 _disputeId, uint256 _roundId, uint256 _jurorsToSettle) external ensureTerm {
        Dispute storage dispute = disputes[_disputeId];
        // Enforce that rounds are settled in order to avoid one round without incentive to settle
        // even if there is a settleFee, it may not be big enough and all jurors in the round are going to be slashed
        require(_roundId == 0 || dispute.rounds[_roundId - 1].settledPenalties, ERROR_PREV_ROUND_NOT_SETTLED);

        uint256 collectedTokens;
        if (_roundId < MAX_REGULAR_APPEAL_ROUNDS) {
            _settleRegularRoundSlashing(dispute, _disputeId, _roundId, _jurorsToSettle);
        } else { // final round
            // TODO: call directly in CourtFinalRound??
            collectedTokens = finalRounds.settleFinalRoundSlashing(_disputeId, termId);
            // there's no settleFee in this round

            emit RoundSlashingSettled(_disputeId, _roundId, collectedTokens);
        }
    }

    function _settleRegularRoundSlashing(Dispute storage _dispute, uint256 _disputeId, uint256 _roundId, uint256 _jurorsToSettle) internal {
        AdjudicationRound storage round = _dispute.rounds[_roundId];
        CourtConfig storage config = courtConfigs[terms[round.draftTermId].courtConfigId]; // safe to use directly as it is the current term

        require(!round.settledPenalties, ERROR_ROUND_ALREADY_SETTLED);

        uint8 winningRuling = _ensureFinalRuling(_disputeId);
        uint256 voteId = _getVoteId(_disputeId, _roundId);
        // let's fetch them only the first time
        if (round.settledJurors == 0) {
            round.coherentJurors = uint64(voting.getRulingVotes(voteId, winningRuling));
        }

        (
            uint256 collectedTokens,
            uint256 jurorsSettled
        ) = _settleRegularRoundSlashingBatch(
            round,
            voteId,
            config.penaltyPct,
            winningRuling,
            _jurorsToSettle
        );
        round.collectedTokens = collectedTokens;
        staking.assignTokens(config.feeToken, msg.sender, config.settleFee * jurorsSettled);
        if (round.settledPenalties) {
            // No juror was coherent in the round
            if (round.coherentJurors == 0) {
                // refund fees and burn ANJ
                staking.assignTokens(config.feeToken, round.triggeredBy, round.jurorFees);
                staking.burnJurorTokens(collectedTokens);
            }

            emit RoundSlashingSettled(_disputeId, _roundId, collectedTokens);
        }
    }

    function _ensureFinalRuling(uint256 _disputeId) internal returns (uint8 winningRuling) {
        Dispute storage dispute = disputes[_disputeId];

        if (dispute.winningRuling > 0) {
            return dispute.winningRuling; // winning ruling was already set
        }

        // ensure the last round adjudication period already ended
        uint256 lastRoundId = dispute.rounds.length - 1;
        if (dispute.state == DisputeState.FinalRound) {
            require(finalRounds.isFinalRoundEnded(_disputeId, termId), ERROR_INVALID_ADJUDICATION_STATE);
            lastRoundId = MAX_REGULAR_APPEAL_ROUNDS;
        } else {
            _checkAdjudicationState(_disputeId, lastRoundId, AdjudicationState.Ended);
            lastRoundId = dispute.rounds.length - 1;
        }

        uint256 voteId = _getVoteId(_disputeId, lastRoundId);
        winningRuling = voting.getWinningRuling(voteId);
        dispute.winningRuling = winningRuling;
    }

    function _settleRegularRoundSlashingBatch(
        AdjudicationRound storage _round,
        uint256 _voteId,
        uint16 _penaltyPct,
        uint8 _winningRuling,
        uint256 _jurorsToSettle // 0 means all
    )
        internal
        returns (uint256 collectedTokens, uint256 batchSettledJurors)
    {
        // TODO: stack too deep uint64 slashingUpdateTermId = termId + 1;
        // The batch starts at where the previous one ended, stored in _round.settledJurors
        uint256 roundSettledJurors = _round.settledJurors;
        // Here we compute the amount of jurors that are going to be selected in this call, which is returned by the function for fees calculation
        // Initially we try to reach the end of the jurors array
        batchSettledJurors = _round.jurors.length - roundSettledJurors;
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
            penalties[i] = _pct4(jurorMinStake, _penaltyPct) * _round.jurorSlotStates[juror].weight;
        }
        uint8[] memory castVotes = voting.getCastVotes(_voteId, jurors);
        // we assume:
        //require(castVotes.length == batchSettledJurors);
        collectedTokens = staking.slash(termId, jurors, penalties, castVotes, _winningRuling);

        _round.collectedTokens = _round.collectedTokens.add(collectedTokens);
    }

    /**
     * @notice Claim reward for round #`_roundId` of dispute #`_disputeId` for juror `_juror`
     */
    function settleReward(uint256 _disputeId, uint256 _roundId, address _juror) external ensureTerm {
        require(_roundId < MAX_REGULAR_APPEAL_ROUNDS, ERROR_INVALID_ADJUDICATION_ROUND);

        Dispute storage dispute = disputes[_disputeId];
        AdjudicationRound storage round = dispute.rounds[_roundId];
        JurorState storage jurorState = round.jurorSlotStates[_juror];

        require(round.settledPenalties, ERROR_ROUND_NOT_SETTLED);
        require(jurorState.weight > 0, ERROR_INVALID_JUROR);
        require(!jurorState.rewarded, ERROR_JUROR_ALREADY_REWARDED);

        jurorState.rewarded = true;

        uint256 voteId = _getVoteId(_disputeId, _roundId);
        uint256 coherentJurors = round.coherentJurors;
        uint8 jurorRuling = voting.getCastVote(voteId, _juror);

        require(jurorRuling == dispute.winningRuling, ERROR_JUROR_NOT_COHERENT);

        uint256 collectedTokens = round.collectedTokens;

        if (collectedTokens > 0) {
            staking.assignJurorTokens(_juror, jurorState.weight * collectedTokens / coherentJurors);
        }

        uint256 jurorFee = round.jurorFees * jurorState.weight / coherentJurors;
        CourtConfig storage config = courtConfigs[terms[round.draftTermId].courtConfigId]; // safe to use directly as it is a past term
        staking.assignTokens(config.feeToken, _juror, jurorFee);

        emit RewardSettled(_disputeId, _roundId, _juror);
    }

    function canTransitionTerm() public view returns (bool) {
        return neededTermTransitions() >= 1;
    }

    function neededTermTransitions() public view returns (uint64) {
        return (_time() - terms[termId].startTime) / termDuration;
    }

    function ensureAndGetTerm() external returns (uint64) {
        _ensureTerm();
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
     * @dev This function only works for regular rounds.
     */
    function areAllJurorsDrafted(uint256 _disputeId, uint256 _roundId) public view returns (bool) {
        AdjudicationRound storage round = disputes[_disputeId].rounds[_roundId];
        return round.filledSeats == round.jurorNumber;
    }

    function areAllJurorsSettled(uint256 _disputeId, uint256 _roundId) public view returns (bool) {
        return disputes[_disputeId].rounds[_roundId].settledPenalties;
    }

    /**
     * @dev Assumes term is up to date. This function only works for regular rounds.
     */
    function feeForRegularRound(
        uint64 _draftTermId,
        uint64 _jurorNumber
    )
        public
        view
        returns (ERC20 feeToken, uint256 feeAmount, uint256 jurorFees)
    {
        CourtConfig storage config = _courtConfigForTerm(_draftTermId);
        feeToken = config.feeToken;
        jurorFees = _jurorNumber * config.jurorFee;
        feeAmount = config.heartbeatFee + jurorFees + _jurorNumber * (config.draftFee + config.settleFee);
    }

    // Voting interface fns

    /**
     * @notice Check that adjudication state is correct
     * @return `_voter`'s weight
     */
    function canCommit(uint256 _voteId, address _voter) external ensureTerm only(voting) returns (uint256 weight) {
        (uint256 disputeId, uint256 roundId) = _decodeVoteId(_voteId);

        // for the final round
        if (roundId == MAX_REGULAR_APPEAL_ROUNDS) {
            require(disputes[disputeId].state == DisputeState.FinalRound, ERROR_INVALID_DISPUTE_STATE);

            return finalRounds.canCommitFinalRound(disputeId, _voter, termId);
        }

        weight = _canPerformVotingAction(disputeId, roundId, _voter, AdjudicationState.Commit);
    }

    /**
     * @notice Check that adjudication state is correct
     * @return `_voter`'s weight
     */
    function canReveal(uint256 _voteId, address _voter) external ensureTerm only(voting) returns (uint256) {
        (uint256 disputeId, uint256 roundId) = _decodeVoteId(_voteId);
        // for the final round
        if (roundId == MAX_REGULAR_APPEAL_ROUNDS) {
            require(disputes[disputeId].state == DisputeState.FinalRound, ERROR_INVALID_DISPUTE_STATE);

            return finalRounds.canRevealFinalRound(disputeId, _voter, termId);
        }

        return _canPerformVotingAction(disputeId, roundId, _voter, AdjudicationState.Reveal);
    }

    function _canPerformVotingAction(
        uint256 _disputeId,
        uint256 _roundId,
        address _voter,
        AdjudicationState _state
    )
        internal
        view
        returns (uint256)
    {
        _checkAdjudicationState(_disputeId, _roundId, _state);

        return _getJurorWeight(_disputeId, _roundId, _voter);
    }

    function getJurorWeight(uint256 _disputeId, uint256 _roundId, address _juror) external view returns (uint256) {
        return _getJurorWeight(_disputeId, _roundId, _juror);
    }

    function _getVoteId(uint256 _disputeId, uint256 _roundId) internal pure returns (uint256) {
        return (_disputeId << 128) + _roundId;
    }

    function _decodeVoteId(uint256 _voteId) internal pure returns (uint256 disputeId, uint256 roundId) {
        disputeId = _voteId >> 128;
        roundId = _voteId & 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF;
    }

    function _getJurorWeight(uint256 _disputeId, uint256 _roundId, address _juror) internal view returns (uint256) {
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

    function getAccountSumTreeId(address _juror) external view returns (uint256) {
        return staking.getAccountSumTreeId(_juror);
    }

    function getGovernor() external view returns (address) {
        return governor;
    }

    function _createRound(
        uint256 _disputeId,
        DisputeState _disputeState,
        uint64 _draftTermId,
        uint64 _jurorNumber
    )
        internal
    {
        Dispute storage dispute = disputes[_disputeId];
        dispute.state = _disputeState;

        uint256 roundId = dispute.rounds.length;
        dispute.rounds.length = roundId + 1;

        AdjudicationRound storage round = dispute.rounds[roundId];

        (ERC20 feeToken, uint256 feeAmount, uint256 jurorFees) = feeForRegularRound(_draftTermId, _jurorNumber);

        // create vote
        uint256 voteId = _getVoteId(_disputeId, roundId);
        voting.createVote(voteId, dispute.possibleRulings);

        round.draftTermId = _draftTermId;
        round.jurorNumber = _jurorNumber;
        //round.filledSeats = 0;
        round.triggeredBy = msg.sender;
        round.jurorFees = jurorFees;

        terms[_draftTermId].dependingDrafts += 1;

        if (feeAmount > 0) {
            require(feeToken.safeTransferFrom(msg.sender, address(staking), feeAmount), ERROR_DEPOSIT_FAILED);
        }
    }

    function _getRegularAdjudicationRoundJurorNumber(uint64 _currentRoundJurorNumber) internal pure returns (uint64 appealJurorNumber) {
        appealJurorNumber = APPEAL_STEP_FACTOR * _currentRoundJurorNumber;
        // make sure it's odd
        if (appealJurorNumber % 2 == 0) {
            appealJurorNumber++;
        }
    }

    function _checkAdjudicationState(uint256 _disputeId, uint256 _roundId, AdjudicationState _state) internal view {
        Dispute storage dispute = disputes[_disputeId];
        DisputeState disputeState = dispute.state;

        require(disputeState == DisputeState.Adjudicating, ERROR_INVALID_DISPUTE_STATE);
        require(_roundId == dispute.rounds.length - 1, ERROR_INVALID_ADJUDICATION_ROUND);
        require(_adjudicationStateAtTerm(_disputeId, _roundId, termId) == _state, ERROR_INVALID_ADJUDICATION_STATE);
    }

    function _adjudicationStateAtTerm(uint256 _disputeId, uint256 _roundId, uint64 _termId) internal view returns (AdjudicationState) {
        AdjudicationRound storage round = disputes[_disputeId].rounds[_roundId];

        // we use the config for the original draft term and only use the delay for the timing of the rounds
        uint64 draftTermId = round.draftTermId;
        uint64 configId = terms[draftTermId].courtConfigId;
        uint64 draftFinishedTermId = draftTermId + round.delayTerms;
        CourtConfig storage config = courtConfigs[uint256(configId)];

        uint64 revealStart = draftFinishedTermId + config.commitTerms;
        uint64 appealStart = revealStart + config.revealTerms;
        uint64 appealEnd = appealStart + config.appealTerms;

        if (_termId < draftFinishedTermId) {
            return AdjudicationState.Invalid;
        } else if (_termId < revealStart) {
            return AdjudicationState.Commit;
        } else if (_termId < appealStart) {
            return AdjudicationState.Reveal;
        } else if (_termId < appealEnd && _roundId < MAX_REGULAR_APPEAL_ROUNDS) {
            return AdjudicationState.Appealable;
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
        uint64[3] _roundStateDurations,
        uint16 _penaltyPct
    )
        internal
    {
        // TODO: Require config changes happening at least X terms in the future
        // Where X is the amount of terms in the future a dispute can be scheduled to be drafted at

        require(configChangeTermId > termId || termId == ZERO_TERM_ID, ERROR_PAST_TERM_FEE_CHANGE);

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
            penaltyPct: _penaltyPct
        });

        uint64 courtConfigId = uint64(courtConfigs.push(courtConfig) - 1);
        terms[configChangeTermId].courtConfigId = courtConfigId;
        configChangeTermId = _fromTermId;

        emit NewCourtConfig(_fromTermId, courtConfigId);
    }

    function _initSubscriptions(ERC20 _feeToken, uint256[5] _subscriptionParams, ISumTree _sumTree) internal {
        require(_subscriptionParams[0] <= MAX_UINT64, ERROR_OVERFLOW); // _periodDuration
        require(_subscriptionParams[3] <= MAX_UINT16, ERROR_OVERFLOW); // _latePaymentPenaltyPct
        require(_subscriptionParams[4] <= MAX_UINT16, ERROR_OVERFLOW); // _governorSharePct
        subscriptions.init(
            ISubscriptionsOwner(this),
            _sumTree,
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
