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

import "@aragon/os/contracts/lib/token/ERC20.sol";
import "@aragon/os/contracts/common/SafeERC20.sol";
import "@aragon/os/contracts/lib/math/SafeMath.sol";


// solium-disable function-order
contract Court is IStakingOwner, ICRVotingOwner, ISubscriptionsOwner {
    using SafeERC20 for ERC20;
    using SafeMath for uint256;

    uint256 internal constant MAX_JURORS_PER_DRAFT_BATCH = 10; // to cap gas used on draft
    uint256 internal constant MAX_REGULAR_APPEAL_ROUNDS = 4; // before the final appeal
    uint256 internal constant FINAL_ROUND_WEIGHT_PRECISION = 1000; // to improve roundings
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
        uint16 finalRoundReduction; // ‱ of reduction applied for final appeal round (1/10,000)
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
        // for the final round it contains all potential penalties from jurors that voted, as they are collected when jurors commit vote
        uint256 collectedTokens;
    }

    enum DisputeState {
        PreDraft,
        Adjudicating,
        Executed
    }

    struct Dispute {
        IArbitrable subject;
        uint8 possibleRulings;      // number of possible rulings the court can decide on
        uint8 winningRuling;
        DisputeState state;
        AdjudicationRound[] rounds;
    }

    // State constants which are set in the constructor and can't change
    uint64 public termDuration; // recomended value ~1 hour as 256 blocks (available block hash) around an hour to mine
    IStaking internal staking;
    ICRVoting internal voting;
    ISumTree internal sumTree;
    ISubscriptions internal subscriptions;

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
     * @param _tokens Array containing:
     *        _jurorToken The address of the juror work token contract.
     *        _feeToken The address of the token contract that is used to pay for fees.
     * @param _staking The address of the Staking component of the Court
     * @param _voting The address of the Commit Reveal Voting contract.
     * @param _sumTree The address of the contract storing de Sum Tree for sortitions.
     * @param _fees Array containing:
     *        _jurorFee The amount of _feeToken that is paid per juror per dispute
     *        _heartbeatFee The amount of _feeToken per dispute to cover maintenance costs.
     *        _draftFee The amount of _feeToken per juror to cover the drafting cost.
     *        _settleFee The amount of _feeToken per juror to cover round settlement cost.
     * @param _governor Address of the governor contract.
     * @param _firstTermStartTime Timestamp in seconds when the court will open (to give time for juror onboarding)
     * @param _jurorMinStake Minimum amount of juror tokens that can be activated
     * @param _roundStateDurations Number of terms that the different states a dispute round last
     * @param _pcts Array containing:
     *        _penaltyPct ‱ of jurorMinStake that can be slashed (1/10,000)
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
        IStaking _staking,
        ICRVoting _voting,
        ISumTree _sumTree,
        ISubscriptions _subscriptions,
        uint256[4] _fees, // _jurorFee, _heartbeatFee, _draftFee, _settleFee
        address _governor,
        uint64 _firstTermStartTime,
        uint256 _jurorMinStake,
        uint64[3] _roundStateDurations,
        uint16[2] _pcts, //_penaltyPct, _finalRoundReduction
        uint256[5] _subscriptionParams // _periodDuration, _feeAmount, _prePaymentPeriods, _latePaymentPenaltyPct, _governorSharePct
    ) public {
        require(_firstTermStartTime >= _termDuration, ERROR_WRONG_TERM);

        termDuration = _termDuration;
        staking = _staking;
        voting = _voting;
        sumTree = _sumTree;
        subscriptions = _subscriptions;
        jurorMinStake = _jurorMinStake;
        governor = _governor;
        //                                          _jurorToken
        staking.init(IStakingOwner(this), _sumTree, _tokens[0], _jurorMinStake);
        voting.setOwner(ICRVotingOwner(this));
        //                 _jurorToken
        _initSubscriptions(_tokens[0], _subscriptionParams, _sumTree);

        courtConfigs.length = 1; // leave index 0 empty
        _setCourtConfig(
            ZERO_TERM_ID,
            _tokens[1], // _feeToken
            _fees,
            _roundStateDurations,
            _pcts[0], // _penaltyPct
            _pcts[1]  // _finalRoundReduction
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

        // _newAdjudicationRound charges fees for starting the round
        _newAdjudicationRound(disputeId, _jurorNumber, _draftTermId);

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
     * @notice Appeal round #`_roundId` ruling in dispute #`_disputeId`
     */
    function appealRuling(uint256 _disputeId, uint256 _roundId) external ensureTerm {
        _checkAdjudicationState(_disputeId, _roundId, AdjudicationState.Appealable);

        Dispute storage dispute = disputes[_disputeId];
        AdjudicationRound storage currentRound = dispute.rounds[_roundId];

        uint64 appealJurorNumber;
        uint64 appealDraftTermId = termId + 1; // Appeals are drafted in the next term

        uint256 roundId;
        if (_roundId == MAX_REGULAR_APPEAL_ROUNDS - 1) { // final round, roundId starts at 0
            // number of jurors will be the number of times the minimum stake is hold in the tree, multiplied by a precision factor for division roundings
            (roundId, appealJurorNumber) = _newFinalAdjudicationRound(_disputeId, appealDraftTermId);
        } else {
            // no need for more checks, as final appeal won't ever be in Appealable state,
            // so it would never reach here (first check would fail), but we add this as a sanity check
            assert(_roundId < MAX_REGULAR_APPEAL_ROUNDS);
            appealJurorNumber = APPEAL_STEP_FACTOR * currentRound.jurorNumber;
            // make sure it's odd
            if (appealJurorNumber % 2 == 0) {
                appealJurorNumber++;
            }
            // _newAdjudicationRound charges fees for starting the round
            roundId = _newAdjudicationRound(_disputeId, appealJurorNumber, appealDraftTermId);
        }

        emit RulingAppealed(_disputeId, roundId, appealDraftTermId, appealJurorNumber);
    }

    /**
     * @notice Execute the final ruling of dispute #`_disputeId`
     */
    function executeRuling(uint256 _disputeId) external ensureTerm {
        Dispute storage dispute = disputes[_disputeId];

        require(dispute.state != DisputeState.Executed, ERROR_INVALID_DISPUTE_STATE);

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
        AdjudicationRound storage round = dispute.rounds[_roundId];
        CourtConfig storage config = courtConfigs[terms[round.draftTermId].courtConfigId]; // safe to use directly as it is the current term

        // Enforce that rounds are settled in order to avoid one round without incentive to settle
        // even if there is a settleFee, it may not be big enough and all jurors in the round are going to be slashed
        require(_roundId == 0 || dispute.rounds[_roundId - 1].settledPenalties, ERROR_PREV_ROUND_NOT_SETTLED);
        require(!round.settledPenalties, ERROR_ROUND_ALREADY_SETTLED);

        uint8 winningRuling = _ensureFinalRuling(_disputeId);
        uint256 voteId = _getVoteId(_disputeId, _roundId);
        // let's fetch them only the first time
        if (round.settledJurors == 0) {
            round.coherentJurors = uint64(voting.getRulingVotes(voteId, winningRuling));
        }

        uint256 collectedTokens;
        if (_roundId < MAX_REGULAR_APPEAL_ROUNDS) {
            uint256 jurorsSettled;
            (collectedTokens, jurorsSettled) = _settleRegularRoundSlashing(round, voteId, config.penaltyPct, winningRuling, _jurorsToSettle);
            round.collectedTokens = collectedTokens;
            staking.assignTokens(config.feeToken, msg.sender, config.settleFee * jurorsSettled);
        } else { // final round
            // this was accounted for on juror's vote commit
            collectedTokens = round.collectedTokens;
            round.settledPenalties = true;
            // there's no settleFee in this round
        }

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
        _checkAdjudicationState(_disputeId, lastRoundId, AdjudicationState.Ended);

        uint256 voteId = _getVoteId(_disputeId, lastRoundId);
        winningRuling = voting.getWinningRuling(voteId);
        dispute.winningRuling = winningRuling;
    }

    function _settleRegularRoundSlashing(
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

    /**
     * @dev Assumes term is up to date. This function only works for regular rounds. There is no drafting in final round.
     */
    function feeForJurorDraft(
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

    function getDispute(uint256 _disputeId)
        external
        view
        returns (address subject, uint8 possibleRulings, DisputeState state, uint8 winningRuling)
    {
        Dispute storage dispute = disputes[_disputeId];
        return (dispute.subject, dispute.possibleRulings, dispute.state, dispute.winningRuling);
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
     * @notice Check that adjudication state is correct
     * @return `_voter`'s weight
     */
    function canCommit(uint256 _voteId, address _voter) external ensureTerm only(voting) returns (uint256 weight) {
        (uint256 disputeId, uint256 roundId) = _decodeVoteId(_voteId);

        // for the final round
        if (roundId == MAX_REGULAR_APPEAL_ROUNDS) {
            return _canCommitFinalRound(disputeId, roundId, _voter);
        }

        weight = _canPerformVotingAction(disputeId, roundId, _voter, AdjudicationState.Commit);
    }

    function _canCommitFinalRound(uint256 _disputeId, uint256 _roundId, address _voter) internal returns (uint256 weight) {
        _checkAdjudicationState(_disputeId, _roundId, AdjudicationState.Commit);

        // weight is the number of times the minimum stake the juror has, multiplied by a precision factor for division roundings
        weight = FINAL_ROUND_WEIGHT_PRECISION *
            staking.getAccountPastTreeStake(_voter, disputes[_disputeId].rounds[_roundId].draftTermId) /
            jurorMinStake;

        // In the final round, when committing a vote, tokens are collected from the juror's account
        if (weight > 0) {
            AdjudicationRound storage round = disputes[_disputeId].rounds[_roundId];
            CourtConfig storage config = courtConfigs[terms[round.draftTermId].courtConfigId]; // safe to use directly as it is a past term

            // weight is the number of times the minimum stake the juror has, multiplied by a precision factor for division roundings, so we remove that factor here
            uint256 weightedPenalty = _pct4(jurorMinStake, config.penaltyPct) * weight / FINAL_ROUND_WEIGHT_PRECISION;

            // Try to lock tokens
            // If there's not enough we just return 0 (so prevent juror from voting).
            // (We could use the remaining amount instead, but we would need to re-calculate the juror's weight)
            if (!staking.collectTokens(termId, _voter, weightedPenalty)) {
                return 0;
            }

            // update round state
            round.collectedTokens += weightedPenalty;
            // This shouldn't overflow. See `_getJurorWeight` and `_newFinalAdjudicationRound`. This will always be less than `jurorNumber`, which currenty is uint64 too
            round.jurorSlotStates[_voter].weight = uint64(weight);
        }
    }

    /**
     * @notice Check that adjudication state is correct
     * @return `_voter`'s weight
     */
    function canReveal(uint256 _voteId, address _voter) external ensureTerm only(voting) returns (uint256) {
        (uint256 disputeId, uint256 roundId) = _decodeVoteId(_voteId);
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

    function _newAdjudicationRound(
        uint256 _disputeId,
        uint64 _jurorNumber,
        uint64 _draftTermId
    )
        internal
        returns (uint256 roundId)
    {
        (ERC20 feeToken, uint256 feeAmount, uint256 jurorFees) = feeForJurorDraft(_draftTermId, _jurorNumber);

        roundId = _createRound(_disputeId, DisputeState.PreDraft, _draftTermId, _jurorNumber, 0, feeToken, feeAmount, jurorFees);
    }

    function _newFinalAdjudicationRound(
        uint256 _disputeId,
        uint64 _draftTermId
    )
        internal
        returns (uint256 roundId, uint64 jurorNumber)
    {
        // the max amount of tokens the tree can hold for this to fit in an uint64 is:
        // 2^64 * jurorMinStake / FINAL_ROUND_WEIGHT_PRECISION
        // (decimals get cancelled in the division). So it seems enough.
        jurorNumber = uint64(FINAL_ROUND_WEIGHT_PRECISION * sumTree.totalSumPresent(termId) / jurorMinStake);

        CourtConfig storage config = _courtConfigForTerm(_draftTermId);
        // number of jurors is the number of times the minimum stake is hold in the tree, multiplied by a precision factor for division roundings
        // besides, apply final round discount
        uint256 jurorFees = _pct4(jurorNumber * config.jurorFee / FINAL_ROUND_WEIGHT_PRECISION, config.finalRoundReduction);
        uint256 feeAmount = config.heartbeatFee + jurorFees;

        // filledSeats is not used for final round, so we set it to zero
        roundId = _createRound(_disputeId, DisputeState.Adjudicating, _draftTermId, jurorNumber, 0, config.feeToken, feeAmount, jurorFees);
    }

    function _createRound(
        uint256 _disputeId,
        DisputeState _disputeState,
        uint64 _draftTermId,
        uint64 _jurorNumber,
        uint64 _filledSeats,
        ERC20 _feeToken,
        uint256 _feeAmount,
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
        voting.createVote(voteId, dispute.possibleRulings);
        round.draftTermId = _draftTermId;
        round.jurorNumber = _jurorNumber;
        round.filledSeats = _filledSeats;
        round.triggeredBy = msg.sender;
        round.jurorFees = _jurorFees;

        terms[_draftTermId].dependingDrafts += 1;

        if (_feeAmount > 0) {
            require(_feeToken.safeTransferFrom(msg.sender, address(staking), _feeAmount), ERROR_DEPOSIT_FAILED);
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
        uint16 _penaltyPct,
        uint16 _finalRoundReduction
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
            penaltyPct: _penaltyPct,
            finalRoundReduction: _finalRoundReduction
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
