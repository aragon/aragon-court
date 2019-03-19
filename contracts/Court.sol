pragma solidity ^0.4.24; // TODO: pin solc

// Inspired by: Kleros.sol https://github.com/kleros/kleros @ 7281e69
import "./lib/HexSumTree.sol";
import "./lib/ArrayUtils.sol";
import "./standards/arbitration/IArbitrable.sol";
import "./standards/erc900/ERC900.sol";

import { ApproveAndCallFallBack } from "@aragon/apps-shared-minime/contracts/MiniMeToken.sol";
import "@aragon/os/contracts/lib/token/ERC20.sol";
import "@aragon/os/contracts/common/SafeERC20.sol";


contract Court is ERC900, ApproveAndCallFallBack {
    using HexSumTree for HexSumTree.Tree;
    using ArrayUtils for address[];
    using SafeERC20 for ERC20;

    enum AccountState {
        NotJuror,
        Juror,
        PastJuror
    }

    struct AccountUpdate {
        bool positive; // TODO: optimize gas
        uint256 delta;
    }

    struct Account {
        mapping (address => uint256) balances; // token addr -> balance
        AccountState state;     // whether the account is not a juror, a current juror or a past juror
        uint64 fromTerm;        // first term in which the juror can be drawn
        uint64 toTerm;          // last term in which the juror can be drawn
        uint256 tokensAtStake;  // disputes in which the juror was drawn which haven't resolved
        uint64 pendingDisputes; // TODO: remove
        uint256 sumTreeId;      // key in the sum tree used for sortition
        AccountUpdate update;   // next account update
    }

    struct CourtConfig {
        // Fee structure
        ERC20 feeToken;
        uint16 governanceFeeShare; // ‱ of fees going to the governor (1/10,000)
        uint256 jurorFee;          // per juror, total dispute fee = jurorFee * jurors drawn
        uint256 heartbeatFee;      // per dispute, total heartbeat fee = heartbeatFee * disputes/appeals in term
        uint256 draftFee;          // per dispute
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
        address[] updateQueue;  // jurors whose stake needs to be updated
        address[] egressQueue;  // jurors that will be removed from to the juror tree
    }

    struct JurorVote {
        bytes32 commitment;
        uint8 ruling;
        address juror;
    }

    struct AdjudicationRound {
        JurorVote[] votes;
        mapping (uint8 => uint256) rulingVotes;
        uint8 winningRuling;
        uint64 draftTerm;
        uint64 jurorNumber;
        address triggeredBy;
    }

    enum Ruling {
        Missing,
        RefusedRuling
        // ruling options are dispute specific
    }

    enum DisputeState {
        PreDraft,
        Adjudicating,
        Appealable,   // TODO: do we need to store this state?
        Executable,   // TODO: do we need to store this state?
        Executed,
        Dismissed
    }

    struct Dispute {
        IArbitrable subject;
        uint8 possibleRulings;      // number of possible rulings the court can decide on
        DisputeState state;
        AdjudicationRound[] rounds;
    }

    enum AdjudicationState {
        Commit,
        Reveal
    }

    // State constants which are set in the constructor and can't change
    ERC20 public jurorToken;
    uint64 public termDuration; // recomended value ~1 hour as 256 blocks (available block hash) around an hour to mine

    // Global config, configurable by governor
    address public governor; // TODO: consider using aOS' ACL
    uint256 public jurorMinStake; // TODO: consider adding it to the conf
    uint256 public maxAppeals = 5;
    CourtConfig[] public courtConfigs;

    // Court state
    uint64 public term;
    uint64 public configChangeTerm;
    mapping (address => Account) public accounts;
    mapping (uint256 => address) public jurorsByTreeId;
    mapping (uint64 => Term) public terms;
    HexSumTree.Tree internal sumTree;
    Dispute[] public disputes;

    string internal constant ERROR_INVALID_ADDR = "COURT_INVALID_ADDR";
    string internal constant ERROR_DEPOSIT_FAILED = "COURT_DEPOSIT_FAILED";
    string internal constant ERROR_ZERO_TRANSFER = "COURT_ZERO_TRANSFER";
    string internal constant ERROR_LOCKED_TOKENS = "COURT_LOCKED_TOKENS";
    string internal constant ERROR_ACTIVATED_TOKENS = "COURT_ACTIVATED_TOKENS";
    string internal constant ERROR_TOO_MANY_TRANSITIONS = "COURT_TOO_MANY_TRANSITIONS";
    string internal constant ERROR_FIRST_TERM_NOT_STARTED = "COURT_FIRST_TERM_NOT_STARTED";
    string internal constant ERROR_UNFINISHED_TERM = "COURT_UNFINISHED_TERM";
    string internal constant ERROR_PAST_TERM_FEE_CHANGE = "COURT_PAST_TERM_FEE_CHANGE";
    string internal constant ERROR_INVALID_ACCOUNT_STATE = "COURT_INVALID_ACCOUNT_STATE";
    string internal constant ERROR_TOKENS_BELOW_MIN_STAKE = "COURT_TOKENS_BELOW_MIN_STAKE";
    string internal constant ERROR_INVALID_ACTIVATION_TERM = "COURT_INVALID_ACTIVATION_TERM";
    string internal constant ERROR_INVALID_DEACTIVATION_TERM = "COURT_INVALID_DEACTIVATION_TERM";
    string internal constant ERROR_JUROR_TOKENS_AT_STAKE = "COURT_JUROR_TOKENS_AT_STAKE";
    string internal constant ERROR_BALANCE_TOO_LOW = "COURT_BALANCE_TOO_LOW";
    string internal constant ERROR_TOKEN_TRANSFER_FAILED = "COURT_TOKEN_TRANSFER_FAILED";
    string internal constant ERROR_GOVENANCE_FEE_TOO_HIGH = "COURT_GOVENANCE_FEE_TOO_HIGH";
    string internal constant ERROR_ENTITY_CANT_DISMISS = "COURT_ENTITY_CANT_DISMISS";
    string internal constant ERROR_CANT_DISMISS_AFTER_DRAFT = "COURT_CANT_DISMISS_AFTER_DRAFT";
    string internal constant ERROR_ROUND_ALREADY_DRAFTED = "COURT_ROUND_ALREADY_DRAFTED";
    string internal constant ERROR_NOT_DRAFT_TERM = "COURT_NOT_DRAFT_TERM";
    string internal constant ERROR_INVALID_DISPUTE_STATE = "COURT_INVALID_DISPUTE_STATE";
    string internal constant ERROR_INVALID_ADJUDICATION_ROUND = "COURT_INVALID_ADJUDICATION_ROUND";
    string internal constant ERROR_INVALID_ADJUDICATION_STATE = "COURT_INVALID_ADJUDICATION_STATE";
    string internal constant ERROR_INVALID_JUROR = "COURT_INVALID_JUROR";
    string internal constant ERROR_ALREADY_VOTED = "COURT_ALREADY_VOTED";
    string internal constant ERROR_INVALID_VOTE = "COURT_INVALID_VOTE";
    string internal constant ERROR_INVALID_RULING_OPTIONS = "COURT_INVALID_RULING_OPTIONS";
    string internal constant ERROR_FAILURE_COMMITMENT_CHECK = "COURT_FAILURE_COMMITMENT_CHECK";
    string internal constant ERROR_CONFIG_PERIOD_ZERO_TERMS = "COURT_CONFIG_PERIOD_ZERO_TERMS";

    uint64 internal constant ZERO_TERM = 0; // invalid term that doesn't accept disputes
    uint64 public constant MANUAL_DEACTIVATION = uint64(-1);
    uint64 internal constant MODIFIER_ALLOWED_TERM_TRANSITIONS = 1;
    bytes4 private constant ARBITRABLE_INTERFACE_ID = 0xabababab; // TODO: interface id
    uint16 internal constant PCT_BASE = 10000; // ‱
    uint8 public constant MIN_RULING_OPTIONS = 2;
    uint8 public constant MAX_RULING_OPTIONS = 254;

    event NewTerm(uint64 term, address indexed heartbeatSender);
    event NewCourtConfig(uint64 fromTerm, uint64 courtConfigId);
    event TokenBalanceChange(address indexed token, address indexed owner, uint256 amount, bool positive);
    event JurorActivate(address indexed juror, uint64 fromTerm, uint64 toTerm);
    event JurorDeactivate(address indexed juror, uint64 lastTerm);
    event JurorDrafted(uint256 indexed disputeId, address indexed juror, uint256 draftId);
    event DisputeStateChanged(uint256 indexed disputeId, DisputeState indexed state);
    event NewDispute(uint256 indexed disputeId, address indexed subject, uint64 indexed draftTerm, uint64 jurorNumber);
    event TokenWithdrawal(address indexed token, address indexed account, uint256 amount);
    event VoteCommitted(uint256 indexed disputeId, uint256 indexed roundId, address indexed juror, bytes32 commitment);
    event VoteRevealed(uint256 indexed disputeId, uint256 indexed roundId, address indexed juror, uint8 ruling);
    event VoteLeaked(uint256 indexed disputeId, uint256 indexed roundId, address indexed juror, address leaker);

    modifier only(address _addr) {
        require(msg.sender == _addr, ERROR_INVALID_ADDR);
        _;
    }

    modifier ensureTerm {
        uint64 requiredTransitions = neededTermTransitions();
        require(requiredTransitions <= MODIFIER_ALLOWED_TERM_TRANSITIONS, ERROR_TOO_MANY_TRANSITIONS);

        if (requiredTransitions > 0) {
            heartbeat(requiredTransitions);
        }

        _;
    }

    modifier ensureDrafted(
        uint256 _disputeId,
        uint256 _roundId,
        uint256 _draftId,
        address _juror,
        AdjudicationState _state
    ) {
        checkDisputeState(_disputeId, _roundId);
        checkAdjudicationState(_disputeId, _roundId, _state);
        require(_getJurorVote(_disputeId, _roundId, _draftId).juror == _juror, ERROR_INVALID_JUROR);

        _;
    }

    /** @dev Constructor.
     *  @param _termDuration Duration in seconds per term (recommended 1 hour)
     *  @param _jurorToken The address of the juror work token contract.
     *  @param _feeToken The address of the token contract that is used to pay for fees.
     *  @param _jurorFee The amount of _feeToken that is paid per juror per dispute
     *  @param _heartbeatFee The amount of _feeToken per dispute to cover maintenance costs.
     *  @param _draftFee The amount of _feeToken per juror to cover the drafting cost.
     *  @param _governanceFeeShare Share in ‱ of fees that are paid to the governor.
     *  @param _governor Address of the governor contract.
     *  @param _firstTermStartTime Timestamp in seconds when the court will open (to give time for juror onboarding)
     *  @param _jurorMinStake Minimum amount of juror tokens that can be activated
     *  @param _commitTerms Number of terms that the vote commit period lasts in an adjudication round
     *  @param _revealTerms Number of terms that the vote reveal period lasts in an adjudication round
     *  @param _appealTerms Number of terms during which a court ruling can be appealed
     *  @param _penaltyPct ‱ of jurorMinStake that can be slashed (1/10,000)
     */
    constructor(
        uint64 _termDuration,
        ERC20 _jurorToken,
        ERC20 _feeToken,
        uint256 _jurorFee,
        uint256 _heartbeatFee,
        uint256 _draftFee,
        uint16 _governanceFeeShare,
        address _governor,
        uint64 _firstTermStartTime,
        uint256 _jurorMinStake,
        uint64 _commitTerms,
        uint64 _revealTerms,
        uint64 _appealTerms,
        uint16 _penaltyPct
    ) public {
        termDuration = _termDuration;
        jurorToken = _jurorToken;
        jurorMinStake = _jurorMinStake;
        governor = _governor;
        
        courtConfigs.length = 1; // leave index 0 empty
        _setCourtConfig(
            ZERO_TERM,
            _feeToken,
            _jurorFee,
            _heartbeatFee,
            _draftFee,
            _governanceFeeShare,
            _commitTerms,
            _revealTerms,
            _appealTerms,
            _penaltyPct
        );
        terms[ZERO_TERM].startTime = _firstTermStartTime - _termDuration;

        sumTree.init();
        assert(sumTree.insert(0) == 0); // first tree item is an empty juror
    }

    function heartbeat(uint64 _termTransitions) public {
        require(canTransitionTerm(), ERROR_UNFINISHED_TERM);

        Term storage prevTerm = terms[term];
        Term storage nextTerm = terms[term + 1];
        address heartbeatSender = msg.sender;

        // Set fee structure for term
        if (nextTerm.courtConfigId == 0) {
            nextTerm.courtConfigId = prevTerm.courtConfigId;
        } else {
            configChangeTerm = ZERO_TERM; // fee structure changed in this term
        }

        // TODO: skip period if you can

        // Set the start time of the term (ensures equally long terms, regardless of heartbeats)
        nextTerm.startTime = prevTerm.startTime + termDuration;
        nextTerm.randomnessBN = blockNumber() + 1; // randomness source set to next block (unknown when heartbeat happens)
        _processJurorQueues(nextTerm);

        CourtConfig storage courtConfig = courtConfigs[nextTerm.courtConfigId];
        uint256 totalFee = nextTerm.dependingDrafts * courtConfig.heartbeatFee;

        if (totalFee > 0) {
            _payFees(courtConfig.feeToken, heartbeatSender, totalFee, courtConfig.governanceFeeShare);
        }

        term += 1;
        emit NewTerm(term, heartbeatSender);

        if (_termTransitions > 0 && canTransitionTerm()) {
            heartbeat(_termTransitions - 1);
        }
    }

    function createDispute(IArbitrable _subject, uint8 _possibleRulings, uint64 _jurorNumber, uint64 _draftTerm)
        external
        ensureTerm
        returns (uint256)
    {   
        // TODO: Limit the min amount of terms before drafting (to allow for evidence submission)
        // TODO: Limit the max amount of terms into the future that a dispute can be drafted
        // TODO: Limit the max number of initial jurors
        // TODO: ERC165 check that _subject conforms to the interface

        require(_possibleRulings >= MIN_RULING_OPTIONS && _possibleRulings <= MAX_RULING_OPTIONS, ERROR_INVALID_RULING_OPTIONS);

        (ERC20 feeToken, uint256 feeAmount,) = feeForJurorDraft(_draftTerm, _jurorNumber);
        if (feeAmount > 0) {
            require(feeToken.safeTransferFrom(msg.sender, this, feeAmount), ERROR_DEPOSIT_FAILED);
        }

        uint256 disputeId = disputes.length;
        disputes.length = disputeId + 1;

        Dispute storage dispute = disputes[disputeId];
        dispute.subject = _subject;
        dispute.state = DisputeState.PreDraft;
        dispute.rounds.length = 1;
        dispute.possibleRulings = _possibleRulings;

        AdjudicationRound storage round = dispute.rounds[0];
        round.draftTerm = _draftTerm;
        round.jurorNumber = _jurorNumber;
        round.triggeredBy = msg.sender;

        terms[_draftTerm].dependingDrafts += 1;

        emit NewDispute(disputeId, _subject, _draftTerm, _jurorNumber);

        return disputeId;
    }

    function dismissDispute(uint256 _disputeId)
        external
        ensureTerm
    {
        Dispute storage dispute = disputes[_disputeId];
        uint256 roundId = dispute.rounds.length - 1;
        AdjudicationRound storage round = dispute.rounds[roundId];

        require(round.triggeredBy == msg.sender, ERROR_ENTITY_CANT_DISMISS);
        require(dispute.state == DisputeState.PreDraft && round.draftTerm > term, ERROR_CANT_DISMISS_AFTER_DRAFT);

        dispute.state = roundId == 0 ? DisputeState.Dismissed : DisputeState.Appealable;

        terms[round.draftTerm].dependingDrafts -= 1;

        // refund fees
        (ERC20 feeToken, uint256 feeAmount, uint16 governanceFeeShare) = feeForJurorDraft(round.draftTerm, round.jurorNumber);
        _payFees(feeToken, round.triggeredBy, feeAmount, governanceFeeShare);

        emit DisputeStateChanged(_disputeId, dispute.state);
    }

    function draftAdjudicationRound(uint256 _disputeId)
        public
        ensureTerm
    {
        Dispute storage dispute = disputes[_disputeId];
        AdjudicationRound storage round = dispute.rounds[dispute.rounds.length - 1];
        Term storage draftTerm = terms[term];
        CourtConfig storage config = courtConfigs[draftTerm.courtConfigId]; // safe to use directly as it is the current term

        // TODO: Work on recovery if draft doesn't occur in the term it was supposed to
        // it should be scheduled for a future draft and require to pay the heartbeat fee for the term
        require(round.draftTerm == term, ERROR_NOT_DRAFT_TERM);
        require(dispute.state == DisputeState.PreDraft, ERROR_ROUND_ALREADY_DRAFTED);

        if (draftTerm.randomness == bytes32(0)) {
            // the blockhash could be 0 if the first dispute draft happens 256 blocks after the term starts
            draftTerm.randomness = block.blockhash(draftTerm.randomnessBN);
        }

        uint256 maxPenalty = _pct4(jurorMinStake, config.penaltyPct);
        uint256 jurorNumber = round.jurorNumber;
        uint256 skippedJurors = 0;
        round.votes.length = jurorNumber;

        for (uint256 i = 0; i < jurorNumber; i++) {
            (uint256 jurorKey, uint256 stake) = treeSearch(draftTerm.randomness, _disputeId, i + skippedJurors);
            address juror = jurorsByTreeId[jurorKey];

            // Account storage jurorAccount = accounts[juror]; // Hitting stack too deep
            uint256 newAtStake = accounts[juror].tokensAtStake + maxPenalty;
            if (stake >= newAtStake) {
                accounts[juror].tokensAtStake += newAtStake;
            } else {
                // SECURITY: This has a chance of bricking the round depending on the state of the court
                skippedJurors++;
                i--;
                continue;
            }
            round.votes[i].juror = juror;
            emit JurorDrafted(_disputeId, juror, i);
        }

        dispute.state = DisputeState.Adjudicating;

        _payFees(config.feeToken, msg.sender, config.draftFee * jurorNumber, config.governanceFeeShare);

        emit DisputeStateChanged(_disputeId, dispute.state);
    }

    function commitVote(
        uint256 _disputeId,
        uint256 _roundId,
        uint256 _draftId,
        bytes32 _commitment
    )
        external
        ensureTerm
        ensureDrafted(_disputeId, _roundId, _draftId, msg.sender, AdjudicationState.Commit)
    {
        JurorVote storage vote = _getJurorVote(_disputeId, _roundId, _draftId);
        require(vote.commitment == bytes32(0) && vote.ruling == uint8(Ruling.Missing), ERROR_ALREADY_VOTED);

        vote.commitment = _commitment;

        emit VoteCommitted(_disputeId, _roundId, msg.sender, _commitment);
    }

    function leakVote(
        uint256 _disputeId,
        uint256 _roundId,
        uint256 _draftId,
        address _juror,
        uint8 _leakedRuling,
        bytes32 _salt
    )
        external
        ensureTerm
        ensureDrafted(_disputeId, _roundId, _draftId, _juror, AdjudicationState.Commit)
    {
        checkVote(_disputeId, _roundId, _draftId, _leakedRuling, _salt);

        uint8 ruling = uint8(Ruling.RefusedRuling);
        JurorVote storage vote = _getJurorVote(_disputeId, _roundId, _draftId);
        vote.ruling = ruling;

        // TODO: slash juror

        updateTally(_disputeId, _roundId, ruling);

        emit VoteLeaked(_disputeId, _roundId, _juror, msg.sender);
        emit VoteRevealed(_disputeId, _roundId, _juror, ruling);
    }

    function revealVote(
        uint256 _disputeId,
        uint256 _roundId,
        uint256 _draftId,
        uint8 _ruling,
        bytes32 _salt
    )
        external
        ensureTerm
        ensureDrafted(_disputeId, _roundId, _draftId, msg.sender, AdjudicationState.Reveal)
    {
        checkVote(_disputeId, _roundId, _draftId, _ruling, _salt);

        Dispute storage dispute = disputes[_disputeId];
        JurorVote storage vote = _getJurorVote(_disputeId, _roundId, _draftId);

        require(_ruling > uint8(Ruling.Missing) && _ruling <= dispute.possibleRulings + 1, ERROR_INVALID_VOTE);
        
        vote.ruling = _ruling;
        updateTally(_disputeId, _roundId, _ruling);

        emit VoteRevealed(_disputeId, _roundId, msg.sender, _ruling);
    }

    function updateTally(uint256 _disputeId, uint256 _roundId, uint8 _ruling) internal {
        AdjudicationRound storage round = disputes[_disputeId].rounds[_roundId];

        uint256 rulingVotes = round.rulingVotes[_ruling] + 1;
        round.rulingVotes[_ruling] = rulingVotes;

        uint8 winningRuling = round.winningRuling;
        uint256 winningSupport = round.rulingVotes[winningRuling];

        // If it passes the currently winning option
        // Or if there is a tie, the lowest ruling option is set as the winning ruling
        if (rulingVotes > winningSupport || (rulingVotes == winningSupport && _ruling < winningRuling)) {
            round.winningRuling = _ruling;
        }
    }

    function checkVote(uint256 _disputeId, uint256 _roundId, uint256 _draftId, uint8 _ruling, bytes32 _salt) internal {
        JurorVote storage jurorVote = _getJurorVote(_disputeId, _roundId, _draftId);

        require(jurorVote.commitment == encryptVote(_ruling, _salt), ERROR_FAILURE_COMMITMENT_CHECK);
        require(jurorVote.ruling == uint8(Ruling.Missing), ERROR_ALREADY_VOTED);
    }

    function checkDisputeState(uint256 _disputeId, uint256 _roundId) internal {
        Dispute storage dispute = disputes[_disputeId];
        if (dispute.state == DisputeState.PreDraft) {
            draftAdjudicationRound(_disputeId);
        }

        require(dispute.state == DisputeState.Adjudicating, ERROR_INVALID_DISPUTE_STATE);
        require(_roundId == dispute.rounds.length - 1, ERROR_INVALID_ADJUDICATION_ROUND);
    }

    function checkAdjudicationState(uint256 _disputeId, uint256 _roundId, AdjudicationState _state) internal {
        AdjudicationRound storage round = disputes[_disputeId].rounds[_roundId];
        uint64 configId = terms[round.draftTerm].courtConfigId;
        CourtConfig storage config = courtConfigs[uint256(configId)];

        uint64 commitTerms = config.commitTerms;
        uint64 revealTerms = config.revealTerms;

        // fromTerm is inclusive, toTerm is exclusive
        uint256 fromTerm = _state == AdjudicationState.Commit ? round.draftTerm : round.draftTerm + commitTerms;
        uint256 toTerm   = fromTerm + (_state == AdjudicationState.Commit ? commitTerms : revealTerms);

        require(term >= fromTerm && term < toTerm, ERROR_INVALID_ADJUDICATION_STATE);
    }

    function getJurorVote(uint256 _disputeId, uint256 _roundId, uint256 _draftId) public view returns (address juror, uint8 ruling) {
        JurorVote storage jurorVote = _getJurorVote(_disputeId, _roundId, _draftId);

        return (jurorVote.juror, jurorVote.ruling);
    }

    function _getJurorVote(uint256 _disputeId, uint256 _roundId, uint256 _draftId) internal view returns (JurorVote storage) {
        return disputes[_disputeId].rounds[_roundId].votes[_draftId];
    }

    function encryptVote(uint8 _ruling, bytes32 _salt) public view returns (bytes32) {
        return keccak256(abi.encodePacked(_ruling, _salt));
    }

    function treeSearch(bytes32 _termRandomness, uint256 _disputeId, uint256 _iteration) internal returns (uint256 key, uint256 value) {
        bytes32 seed = keccak256(abi.encodePacked(_termRandomness, _disputeId, _iteration));
        // TODO: optimize by caching tree.totalSum(), and perform a `tree.unsafeSortition(seed % totalSum)` (unimplemented)
        return sumTree.randomSortition(uint256(seed));
    }

    /**
     * @dev Assumes term is up to date
     */
    function feeForJurorDraft(uint64 _draftTerm, uint64 _jurorNumber) public view returns (ERC20 feeToken, uint256 feeAmount, uint16 governanceFeeShare) {
        CourtConfig storage fees = courtConfigForTerm(_draftTerm);

        feeToken = fees.feeToken;
        governanceFeeShare = fees.governanceFeeShare;
        feeAmount = fees.heartbeatFee + _jurorNumber * (fees.jurorFee + fees.draftFee);
    }

    function courtConfigForTerm(uint64 _term) internal view returns (CourtConfig storage) {
        uint64 feeTerm;

        if (_term <= term) {
            feeTerm = _term; // for past terms, use the fee structure of the specific term
        } else if (configChangeTerm <= _term) {
            feeTerm = configChangeTerm; // if fees are changing before the draft, use the incoming fee schedule
        } else {
            feeTerm = term; // if no changes are scheduled, use the current term fee schedule (which CANNOT change for this term)
        }

        uint256 courtConfigId = uint256(terms[feeTerm].courtConfigId);
        return courtConfigs[courtConfigId];
    }

    function _payFees(ERC20 _feeToken, address _to, uint256 _amount, uint16 _governanceFeeShare) internal {
        if (_amount == 0) {
            return;
        }

        uint256 governanceFee = _pct4(_amount, _governanceFeeShare);
        _assignTokens(_feeToken, _to, _amount - governanceFee);

        if (governanceFee == 0) {
            return;
        }

        _assignTokens(_feeToken, governor, governanceFee);
    }

    // TODO: should we charge heartbeat fees to jurors?
    function activate(uint64 _fromTerm, uint64 _toTerm) external ensureTerm {
        address jurorAddress = msg.sender;
        Account storage account = accounts[jurorAddress];
        uint256 balance = account.balances[jurorToken];

        require(_fromTerm > term, ERROR_INVALID_ACTIVATION_TERM);
        require(_toTerm > _fromTerm, ERROR_INVALID_DEACTIVATION_TERM);
        require(account.state == AccountState.NotJuror, ERROR_INVALID_ACCOUNT_STATE);
        require(balance >= jurorMinStake, ERROR_TOKENS_BELOW_MIN_STAKE);

        uint256 sumTreeId = account.sumTreeId;
        if (sumTreeId == 0) {
            sumTreeId = sumTree.insert(0);
            accounts[jurorAddress].sumTreeId = sumTreeId;
            jurorsByTreeId[sumTreeId] = jurorAddress;
        }

        if (term == ZERO_TERM && _fromTerm == ZERO_TERM + 1) {
            // allow direct juror onboardings before term 1 starts (no disputes depend on term 0)
            sumTree.update(sumTreeId, balance, true);
        } else {
            // TODO: check queue size limit
            account.update = AccountUpdate({ delta: balance, positive: true });
            terms[_fromTerm].updateQueue.push(jurorAddress);
        }

        if (_toTerm != MANUAL_DEACTIVATION) {
            // TODO: check queue size limit
            terms[_toTerm].egressQueue.push(jurorAddress);
        }

        account.fromTerm = _fromTerm;
        account.toTerm = _toTerm;
        account.state = AccountState.Juror;
        account.balances[jurorToken] = 0;   // tokens are either pending the update or in the tree

        emit JurorActivate(jurorAddress, _fromTerm, _toTerm);
    }

    // TODO: activate more tokens

    // this can't called if the juror is deactivated on the schedule specified when calling activate
    // can be called many times to modify the deactivation date
    function deactivate(uint64 _lastTerm) external ensureTerm {
        address jurorAddress = msg.sender;
        Account storage account = accounts[jurorAddress];

        require(account.state == AccountState.Juror, ERROR_INVALID_ACCOUNT_STATE);
        require(_lastTerm > term, ERROR_INVALID_DEACTIVATION_TERM);

        // Juror didn't actually become activated
        if (term < account.fromTerm && term != ZERO_TERM) {
            terms[account.fromTerm].updateQueue.deleteItem(jurorAddress);
            assert(account.update.positive); // If the juror didn't activate, its update can only be positive
            account.balances[jurorToken] += account.update.delta;
            delete account.update;
        }

        if (account.toTerm != MANUAL_DEACTIVATION) {
            terms[account.toTerm].egressQueue.deleteItem(jurorAddress);
        }

        terms[_lastTerm].egressQueue.push(jurorAddress);
        account.toTerm = _lastTerm;

        emit JurorDeactivate(jurorAddress, _lastTerm);
    }

    function canTransitionTerm() public view returns (bool) {
        return neededTermTransitions() >= 1;
    }

    function neededTermTransitions() public view returns (uint64) {
        return (time() - terms[term].startTime) / termDuration;
    }

    // ERC900

    function stake(uint256 _amount, bytes) external {
        _stake(msg.sender, msg.sender, _amount);
    }

    function stakeFor(address _to, uint256 _amount, bytes) external {
        _stake(msg.sender, _to, _amount);
    }

    /** @dev Callback of approveAndCall - transfer jurorTokens of a juror in the contract. Should be called by the jurorToken contract. TRUSTED.
     *  @param _from The address making the transfer.
     *  @param _amount Amount of tokens to transfer to Kleros (in basic units).
     */
    function receiveApproval(address _from, uint256 _amount, address token, bytes)
        public
        only(token)
    {
        if (token == address(jurorToken)) {
            _stake(_from, _from, _amount);
        }
    }

    function unstake(uint256 _amount, bytes) external {
        return withdraw(jurorToken, _amount);
    }

    function totalStakedFor(address _addr) public view returns (uint256) {
        uint256 sumTreeId = accounts[_addr].sumTreeId;
        uint256 activeTokens = sumTreeId > 0 ? sumTree.getItem(sumTreeId) : 0;
        AccountUpdate storage update = accounts[_addr].update;
        uint256 pendingTokens = update.positive ? update.delta : -update.delta;

        return accounts[_addr].balances[jurorToken] + activeTokens + pendingTokens;
    }

    function totalStaked() external view returns (uint256) {
        return jurorToken.balanceOf(this);
    }

    function token() external view returns (address) {
        return address(jurorToken);
    }

    function supportsHistory() external pure returns (bool) {
        return false;
    }

    /** @dev Withdraw tokens. Note that we can't withdraw the tokens which are still atStake. 
     *  Jurors can't withdraw their tokens if they have deposited some during this term.
     *  This is to prevent jurors from withdrawing tokens they could lose.
     *  @param _token Token to withdraw
     *  @param _amount The amount to withdraw.
     */
    function withdraw(ERC20 _token, uint256 _amount) public ensureTerm {
        require(_amount > 0, ERROR_ZERO_TRANSFER);

        address addr = msg.sender;
        Account storage account = accounts[addr];
        uint256 balance = account.balances[_token];
        require(balance >= _amount, ERROR_BALANCE_TOO_LOW);
        
        if (_token == jurorToken) {
            if (account.state == AccountState.Juror) {
                require(_amount <= unlockedBalanceOf(addr), ERROR_JUROR_TOKENS_AT_STAKE);
                account.state = AccountState.PastJuror;
            }

            emit Unstaked(addr, _amount, totalStakedFor(addr), "");
        }
        
        account.balances[_token] -= _amount;
        require(_token.safeTransfer(addr, _amount), ERROR_TOKEN_TRANSFER_FAILED);

        emit TokenWithdrawal(_token, addr, _amount);
    }

    function unlockedBalanceOf(address _addr) public view returns (uint256) {
        Account storage account = accounts[_addr];
        // TODO: safe math
        return account.balances[jurorToken] - account.tokensAtStake;
    }

    function _processJurorQueues(Term storage _incomingTerm) internal {
        uint256 egressLength = _incomingTerm.egressQueue.length;
        uint256 updatesLength = _incomingTerm.updateQueue.length;

        for (uint256 i = 0; i < updatesLength; i++) {
            address jurorUpdate = _incomingTerm.updateQueue[i];
            AccountUpdate storage update = accounts[jurorUpdate].update;

            if (update.delta > 0) {
                sumTree.update(accounts[jurorUpdate].sumTreeId, update.delta, update.positive);
                delete accounts[jurorUpdate].update;
            }
        }
        for (uint256 j = 0; j < egressLength; j++) {
            address jurorEgress = _incomingTerm.egressQueue[j];

            uint256 sumTreeId = accounts[jurorEgress].sumTreeId;
            if (sumTreeId != 0) {
                uint256 treeBalance = sumTree.getItem(sumTreeId);
                accounts[jurorEgress].balances[jurorToken] += treeBalance;
                sumTree.set(sumTreeId, 0);
                delete accounts[jurorEgress].sumTreeId;
            }
        }

        if (egressLength > 0) {
            delete _incomingTerm.egressQueue;
        }
        if (updatesLength > 0) {
            delete _incomingTerm.updateQueue;
        }
    }

    function _stake(address _from, address _to, uint256 _amount) internal {
        require(_amount > 0, ERROR_ZERO_TRANSFER);
        require(jurorToken.safeTransferFrom(_from, this, _amount), ERROR_DEPOSIT_FAILED);

        accounts[_to].balances[jurorToken] += _amount;

        emit Staked(_to, _amount, totalStakedFor(_to), "");
    }

    function _assignTokens(ERC20 _token, address _to, uint256 _amount) internal {
        accounts[_to].balances[_token] += _amount;

        emit TokenBalanceChange(_token, _to, _amount, true);
    }

    function _setCourtConfig(
        uint64 _fromTerm,
        ERC20 _feeToken,
        uint256 _jurorFee,
        uint256 _heartbeatFee,
        uint256 _draftFee,
        uint16 _governanceFeeShare,
        uint64 _commitTerms,
        uint64 _revealTerms,
        uint64 _appealTerms,
        uint16 _penaltyPct
    ) internal {
        // TODO: Require config changes happening at least X terms in the future
        // Where X is the amount of terms in the future a dispute can be scheduled to be drafted at

        require(configChangeTerm > term || term == ZERO_TERM, ERROR_PAST_TERM_FEE_CHANGE);
        require(_governanceFeeShare <= PCT_BASE, ERROR_GOVENANCE_FEE_TOO_HIGH);

        require(_commitTerms > 0, ERROR_CONFIG_PERIOD_ZERO_TERMS);
        require(_revealTerms > 0, ERROR_CONFIG_PERIOD_ZERO_TERMS);
        require(_appealTerms > 0, ERROR_CONFIG_PERIOD_ZERO_TERMS);

        if (configChangeTerm != ZERO_TERM) {
            terms[configChangeTerm].courtConfigId = 0; // reset previously set fee structure change
        }

        CourtConfig memory courtConfig = CourtConfig({
            feeToken: _feeToken,
            governanceFeeShare: _governanceFeeShare,
            jurorFee: _jurorFee,
            heartbeatFee: _heartbeatFee,
            draftFee: _draftFee,
            commitTerms: _commitTerms,
            revealTerms: _revealTerms,
            appealTerms: _appealTerms,
            penaltyPct: _penaltyPct
        });

        uint64 courtConfigId = uint64(courtConfigs.push(courtConfig) - 1);
        terms[configChangeTerm].courtConfigId = courtConfigId;
        configChangeTerm = _fromTerm;

        emit NewCourtConfig(_fromTerm, courtConfigId);
    }

    function time() internal view returns (uint64) {
        return uint64(block.timestamp);
    }

    function blockNumber() internal view returns (uint64) {
        return uint64(block.number);
    }

    function _pct4(uint256 _number, uint16 _pct) internal pure returns (uint256) {
        return _number * uint256(_pct) / uint256(PCT_BASE);
    }
}

