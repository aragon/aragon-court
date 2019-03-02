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

    struct Account {
        mapping (address => uint256) balances; // token addr -> balance
        AccountState state;     // whether the account is not a juror, a current juror or a past juror
        uint64 fromTerm;        // first term in which the juror can be drawn
        uint64 toTerm;          // last term in which the juror can be drawn
        uint64 pendingDisputes; // disputes in which the juror was drawn which haven't resolved
        uint256 sumTreeId;      // key in the sum tree used for sortition
    }

    // TODO: Rename to TermConfig
    struct FeeStructure {
        ERC20 feeToken;
        uint16 governanceShare;  // ‱ of fees going to the governor (1/10,000)
        uint256 jurorFee;        // per juror, total dispute fee = jurorFee * jurors drawn
        uint256 heartbeatFee;    // per dispute, total heartbeat fee = heartbeatFee * disputes/appeals in term
        uint256 draftFee;        // per dispute
        // TODO: add commit/reveal/appeal durations
    }

    struct Term {
        uint64 startTime;       // timestamp when the term started 
        uint64 dependingDrafts;  // disputes or appeals pegged to this term for randomness
        uint64 feeStructureId;  // fee structure for this term (index in feeStructures array)
        uint64 randomnessBN;    // block number for entropy
        uint256 randomness;     // entropy from randomnessBN block hash
        address[] ingressQueue; // jurors that will be added to the juror tree
        address[] egressQueue;  // jurors that will be removed from to the juror tree
        address[] updatesQueue; // jurors whose stake has been updated
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
    uint64 public jurorCooldownTerms;
    uint256 public jurorActivationDust;
    uint256 public maxAppeals = 5;
    FeeStructure[] public feeStructures;

    // Court state
    uint64 public term;
    uint64 public feeChangeTerm;
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
    string internal constant ERROR_TOKENS_BELOW_DUST = "COURT_TOKENS_BELOW_DUST";
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


    uint64 internal constant ZERO_TERM = 0; // invalid term that doesn't accept disputes
    uint64 public constant MANUAL_DEACTIVATION = uint64(-1);
    uint64 internal constant MODIFIER_ALLOWED_TERM_TRANSITIONS = 1;
    bytes4 private constant ARBITRABLE_INTERFACE_ID = 0xabababab; // TODO: interface id
    uint16 internal constant GOVERNANCE_FEE_DIVISOR = 10000; // ‱
    uint8 public constant MIN_RULING_OPTIONS = 2;
    uint8 public constant MAX_RULING_OPTIONS = 254;

    // TODO: Move into term configuration (currently fee schedule)
    uint64 public constant COMMIT_TERMS = 72;
    uint64 public constant REVEAL_TERMS = 24;

    event NewTerm(uint64 term, address indexed heartbeatSender);
    event NewFeeStructure(uint64 fromTerm, uint64 feeStructureId);
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

    /** @dev Constructor.
     *  @param _termDuration Duration in seconds per term (recommended 1 hour)
     *  @param _jurorToken The address of the juror work token contract.
     *  @param _feeToken The address of the token contract that is used to pay for fees.
     *  @param _jurorFee The amount of _feeToken that is paid per juror per dispute
     *  @param _heartbeatFee The amount of _feeToken per dispute to cover maintenance costs.
     *  @param _draftFee The amount of _feeToken per juror to cover the drafting cost.
     *  @param _governanceShare Share in ‱ of fees that are paid to the governor.
     *  @param _governor Address of the governor contract.
     *  @param _firstTermStartTime Timestamp in seconds when the court will open (to give time for juror onboarding)
     *  @param _jurorActivationDust Minimum amount of juror tokens that can be activated
     *  @param _jurorCooldownTerms Number of terms before a juror tokens can be withdrawn after deactivation ()
     */
    constructor(
        uint64 _termDuration,
        ERC20 _jurorToken,
        ERC20 _feeToken,
        uint256 _jurorFee,
        uint256 _heartbeatFee,
        uint256 _draftFee,
        uint16 _governanceShare,
        address _governor,
        uint64 _firstTermStartTime,
        uint256 _jurorActivationDust,
        uint64 _jurorCooldownTerms
    ) public {
        termDuration = _termDuration;
        jurorToken = _jurorToken;
        jurorActivationDust = _jurorActivationDust;
        governor = _governor;
        jurorCooldownTerms = _jurorCooldownTerms;
        
        feeStructures.length = 1; // leave index 0 empty
        _setFeeStructure(
            ZERO_TERM,
            _feeToken,
            _jurorFee,
            _heartbeatFee,
            _draftFee,
            _governanceShare
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
        if (nextTerm.feeStructureId == 0) {
            nextTerm.feeStructureId = prevTerm.feeStructureId;
        } else {
            feeChangeTerm = ZERO_TERM; // fee structure changed in this term
        }

        // TODO: skip period if you can

        // Set the start time of the term (ensures equally long terms, regardless of heartbeats)
        nextTerm.startTime = prevTerm.startTime + termDuration;
        nextTerm.randomnessBN = blockNumber() + 1; // randomness source set to next block (unknown when heartbeat happens)
        _processJurorQueues(nextTerm);

        FeeStructure storage feeStructure = feeStructures[nextTerm.feeStructureId];
        uint256 totalFee = nextTerm.dependingDrafts * feeStructure.heartbeatFee;

        if (totalFee > 0) {
            _payFees(feeStructure.feeToken, heartbeatSender, totalFee, feeStructure.governanceShare);
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
        (ERC20 feeToken, uint256 feeAmount, uint16 governanceShare) = feeForJurorDraft(round.draftTerm, round.jurorNumber);
        _payFees(feeToken, round.triggeredBy, feeAmount, governanceShare);

        emit DisputeStateChanged(_disputeId, dispute.state);
    }

    function draftAdjudicationRound(uint256 _disputeId)
        public
        ensureTerm
    {
        Dispute storage dispute = disputes[_disputeId];
        uint256 roundId = dispute.rounds.length - 1;
        AdjudicationRound storage round = dispute.rounds[roundId];
        Term storage draftTerm = terms[term];

        // TODO: Work on recovery if draft doesn't occur in the term it was supposed to
        // it should be scheduled for a future draft and require to pay the heartbeat fee for the term
        require(round.draftTerm == term, ERROR_NOT_DRAFT_TERM);
        require(dispute.state == DisputeState.PreDraft, ERROR_ROUND_ALREADY_DRAFTED);

        // TODO: actually draft jurors
        if (draftTerm.randomness == 0) {
            // the blockhash could be 0 if the first dispute draft happens 256 blocks after the term starts
            draftTerm.randomness = uint256(block.blockhash(draftTerm.randomnessBN));
        }

        uint256[] memory jurorKeys = sumTree.randomSortition(round.jurorNumber, draftTerm.randomness);
        assert(jurorKeys.length == round.jurorNumber);

        for (uint256 i = 0; i < jurorKeys.length; i++) {
            address juror = jurorsByTreeId[jurorKeys[i]];

            accounts[juror].pendingDisputes += 1;

            JurorVote memory vote;
            vote.juror = juror;
            round.votes.push(vote);

            emit JurorDrafted(_disputeId, juror, i);
        }

        dispute.state = DisputeState.Adjudicating;

        FeeStructure storage fees = feeStructureForTerm(term);
        _payFees(fees.feeToken, msg.sender, fees.draftFee * round.jurorNumber, fees.governanceShare);

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
        ensureAdjudicationState(_disputeId, _roundId, AdjudicationState.Commit)
        ensureDraft(_disputeId, _roundId, _draftId, msg.sender)
    {
        JurorVote storage vote = getJurorVote(_disputeId, _roundId, _draftId);
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
        ensureAdjudicationState(_disputeId, _roundId, AdjudicationState.Commit)
        ensureDraft(_disputeId, _roundId, _draftId, _juror)
        ensureNoReveal(_disputeId, _roundId, _draftId, _leakedRuling, _salt)
    {
        uint8 ruling = uint8(Ruling.RefusedRuling);
        JurorVote storage vote = getJurorVote(_disputeId, _roundId, _draftId);
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
        ensureAdjudicationState(_disputeId, _roundId, AdjudicationState.Reveal)
        ensureDraft(_disputeId, _roundId, _draftId, msg.sender)
        ensureNoReveal(_disputeId, _roundId, _draftId, _ruling, _salt)
    {
        Dispute storage dispute = disputes[_disputeId];
        JurorVote storage vote = getJurorVote(_disputeId, _roundId, _draftId);

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

    modifier ensureNoReveal(uint256 _disputeId, uint256 _roundId, uint256 _draftId, uint8 _ruling, bytes32 _salt) {
        JurorVote storage vote = getJurorVote(_disputeId, _roundId, _draftId);
        bytes32 commit = encryptVote(_ruling, _salt);
        require(vote.commitment == commit && vote.ruling == uint8(Ruling.Missing), ERROR_ALREADY_VOTED);

        _;
    }

    modifier ensureAdjudicationState(uint256 _disputeId, uint256 _roundId, AdjudicationState _state) {
        Dispute storage dispute = disputes[_disputeId];
        if (dispute.state == DisputeState.PreDraft) {
            draftAdjudicationRound(_disputeId);
        }

        require(dispute.state == DisputeState.Adjudicating, ERROR_INVALID_DISPUTE_STATE);
        require(_roundId == dispute.rounds.length - 1, ERROR_INVALID_ADJUDICATION_ROUND);

        AdjudicationRound storage round = dispute.rounds[_roundId];

        // fromTerm is inclusive, toTerm is exclusive
        uint256 fromTerm = _state == AdjudicationState.Commit ? round.draftTerm : round.draftTerm + COMMIT_TERMS;
        uint256 toTerm   = fromTerm + (_state == AdjudicationState.Commit ? COMMIT_TERMS : REVEAL_TERMS);

        require(term >= fromTerm && term < toTerm, ERROR_INVALID_ADJUDICATION_STATE);

        _;
    }

    modifier ensureDraft(uint256 _disputeId, uint256 _roundId, uint256 _draftId, address _juror) {
        require(getJurorVote(_disputeId, _roundId, _draftId).juror == _juror, ERROR_INVALID_JUROR);

        _;
    }

    function getJurorVote(uint256 _disputeId, uint256 _roundId, uint256 _draftId) internal view returns (JurorVote storage) {
        return disputes[_disputeId].rounds[_roundId].votes[_draftId];
    }

    function encryptVote(uint8 _ruling, bytes32 _salt) public view returns (bytes32) {
        return keccak256(abi.encodePacked(_ruling, _salt));
    }

    /**
     * @dev Assumes term is up to date
     */
    function feeForJurorDraft(uint64 _draftTerm, uint64 _jurorNumber) public view returns (ERC20 feeToken, uint256 feeAmount, uint16 governanceShare) {
        FeeStructure storage fees = feeStructureForTerm(_draftTerm);

        feeToken = fees.feeToken;
        governanceShare = fees.governanceShare;
        feeAmount = fees.heartbeatFee + _jurorNumber * (fees.jurorFee + fees.draftFee);
    }

    function feeStructureForTerm(uint64 _term) internal view returns (FeeStructure storage) {
        uint64 feeTerm;

        if (_term <= term) {
            feeTerm = _term; // for past terms, use the fee structure of the specific term
        } else if (feeChangeTerm <= _term) {
            feeTerm = feeChangeTerm; // if fees are changing before the draft, use the incoming fee schedule
        } else {
            feeTerm = term; // if no changes are scheduled, use the current term fee schedule (which CANNOT change for this term)
        }

        uint256 feeStructureId = uint256(terms[feeTerm].feeStructureId);
        return feeStructures[feeStructureId];
    }

    function _payFees(ERC20 _feeToken, address _to, uint256 _amount, uint16 _governanceShare) internal {
        if (_amount == 0) return;
        _assignTokens(_feeToken, _to, _amount * uint256(GOVERNANCE_FEE_DIVISOR - _governanceShare) / GOVERNANCE_FEE_DIVISOR);

        if (_governanceShare == 0) return;
        _assignTokens(_feeToken, governor, _amount * uint256(_governanceShare) / GOVERNANCE_FEE_DIVISOR);
    }

    // TODO: should we charge heartbeat fees to jurors?
    function activate(uint64 _fromTerm, uint64 _toTerm) external ensureTerm {
        address jurorAddress = msg.sender;
        Account storage account = accounts[jurorAddress];

        require(_fromTerm > term, ERROR_INVALID_ACTIVATION_TERM);
        require(_toTerm > _fromTerm, ERROR_INVALID_DEACTIVATION_TERM);
        require(account.state == AccountState.NotJuror, ERROR_INVALID_ACCOUNT_STATE);
        require(account.balances[jurorToken] >= jurorActivationDust, ERROR_TOKENS_BELOW_DUST);

        if (term == ZERO_TERM && _fromTerm == ZERO_TERM + 1) {
            // allow direct juror onboardings before term 1 starts (no disputes depend on term 0)
            _insertJurorToSumTree(jurorAddress);
        } else {
            // TODO: check queue size limit
            terms[_fromTerm].ingressQueue.push(jurorAddress);
        }

        if (_toTerm != MANUAL_DEACTIVATION) {
            // TODO: check queue size limit
            terms[_toTerm].egressQueue.push(jurorAddress);
        }

        account.fromTerm = _fromTerm;
        account.toTerm = _toTerm;
        account.state = AccountState.Juror;

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
            terms[account.fromTerm].ingressQueue.deleteItem(jurorAddress);
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
        return accounts[_addr].balances[jurorToken];
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
                require(isJurorBalanceUnlocked(addr), ERROR_JUROR_TOKENS_AT_STAKE);
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
        if (account.state == AccountState.Juror) {
            if (!isJurorBalanceUnlocked(_addr)) {
                return 0;
            }
        }
        return account.balances[jurorToken];
    }

    function sortition(uint256 v) public view returns (address) {
        return jurorsByTreeId[sumTree.sortition(v)];
    }

    function treeTotalSum() public view returns (uint256) {
        return sumTree.totalSum();
    }

    function _processJurorQueues(Term storage _incomingTerm) internal {
        uint256 ingressLength = _incomingTerm.ingressQueue.length;
        uint256 egressLength = _incomingTerm.egressQueue.length;
        uint256 updatesLength = _incomingTerm.updatesQueue.length;

        // Insert cost = 40k + tree insertion
        for (uint256 i = 0; i < ingressLength; i++) {
            _insertJurorToSumTree(_incomingTerm.ingressQueue[i]);
        }
        for (uint256 j = 0; j < egressLength; j++) {
            address jurorEgress = _incomingTerm.egressQueue[j];

            if (accounts[jurorEgress].sumTreeId != 0) {
                sumTree.set(accounts[jurorEgress].sumTreeId, 0);
                delete accounts[jurorEgress].sumTreeId;
            }
        }
        for (uint256 k = 0; k < updatesLength; k++) {
            address jurorUpdate = _incomingTerm.updatesQueue[k];
            sumTree.set(accounts[jurorUpdate].sumTreeId, totalStakedFor(jurorUpdate));
        }

        if (ingressLength > 0) {
            delete _incomingTerm.ingressQueue;
        }
        if (egressLength > 0) {
            delete _incomingTerm.egressQueue;
        }
        if (updatesLength > 0) {
            delete _incomingTerm.updatesQueue;
        }
    }

    function _insertJurorToSumTree(address _jurorAddress) internal {
        uint256 sumTreeId = sumTree.insert(totalStakedFor(_jurorAddress));
        accounts[_jurorAddress].sumTreeId = sumTreeId;
        jurorsByTreeId[sumTreeId] = _jurorAddress;
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

    function _setFeeStructure(
        uint64 _fromTerm,
        ERC20 _feeToken,
        uint256 _jurorFee,
        uint256 _heartbeatFee,
        uint256 _draftFee,
        uint16 _governanceShare
    ) internal {
        // TODO: Require fee changes happening at least X terms in the future
        // Where X is the amount of terms in the future a dispute can be scheduled to be drafted at

        require(feeChangeTerm > term || term == ZERO_TERM, ERROR_PAST_TERM_FEE_CHANGE);
        require(_governanceShare <= GOVERNANCE_FEE_DIVISOR, ERROR_GOVENANCE_FEE_TOO_HIGH);

        if (feeChangeTerm != ZERO_TERM) {
            terms[feeChangeTerm].feeStructureId = 0; // reset previously set fee structure change
        }

        FeeStructure memory feeStructure = FeeStructure({
            feeToken: _feeToken,
            governanceShare: _governanceShare,
            jurorFee: _jurorFee,
            heartbeatFee: _heartbeatFee,
            draftFee: _draftFee
        });

        uint64 feeStructureId = uint64(feeStructures.push(feeStructure) - 1);
        terms[feeChangeTerm].feeStructureId = feeStructureId;
        feeChangeTerm = _fromTerm;

        emit NewFeeStructure(_fromTerm, feeStructureId);
    }

    function time() internal view returns (uint64) {
        return uint64(block.timestamp);
    }

    function blockNumber() internal view returns (uint64) {
        return uint64(block.number);
    }

    function isJurorBalanceUnlocked(address _jurorAddress) internal view returns (bool) {
        Account storage account = accounts[_jurorAddress];
        return term > account.toTerm + jurorCooldownTerms && account.pendingDisputes == 0;
    }
}

