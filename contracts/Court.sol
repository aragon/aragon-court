pragma solidity ^0.4.24; // TODO: pin solc

// Inspired by: Kleros.sol https://github.com/kleros/kleros @ 7281e69
import "./lib/HexSumTree.sol";
import "./lib/ArrayUtils.sol";
import "./standards/arbitration/IArbitrable.sol";
import "./standards/erc900/ERC900.sol";

import { ApproveAndCallFallBack } from "@aragon/apps-shared-minime/contracts/MiniMeToken.sol";
import "@aragon/os/contracts/lib/token/ERC20.sol";
import "@aragon/os/contracts/common/SafeERC20.sol";
import "@aragon/os/contracts/lib/math/SafeMath.sol";


contract Court is ERC900, ApproveAndCallFallBack {
    using HexSumTree for HexSumTree.Tree;
    using ArrayUtils for address[];
    using SafeERC20 for ERC20;
    using SafeMath for uint256;

    enum AccountState {
        NotJuror,
        Juror,
        PastJuror
    }

    struct AccountUpdate {
        uint64 term;
        bool positive; // TODO: optimize gas
        uint256 delta;
    }

    struct Account {
        mapping (address => uint256) balances; // token addr -> balance
        AccountState state;      // whether the account is not a juror, a current juror or a past juror
        uint64 fromTerm;         // first term in which the juror can be drawn
        uint64 toTerm;           // last term in which the juror can be drawn
        uint256 atStakeTokens;   // maximum amount of juror tokens that the juror could be slashed given their drafts
        uint256 sumTreeId;       // key in the sum tree used for sortition
        AccountUpdate update;    // next account update
    }

    struct CourtConfig {
        // Fee structure
        ERC20 feeToken;
        uint16 governanceFeeShare; // ‱ of fees going to the governor (1/10,000)
        uint256 jurorFee;          // per juror, total round juror fee = jurorFee * jurors drawn
        uint256 heartbeatFee;      // per dispute, total heartbeat fee = heartbeatFee * disputes/appeals in term
        uint256 draftFee;          // per juror, total round draft fee = draftFee * jurors drawn
        uint256 settleFee;         // per juror, total round draft fee = settleFee * jurors drawn
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
        bool rewarded;
        address juror;
    }

    struct AdjudicationRound {
        JurorVote[] votes;
        mapping (uint8 => uint256) rulingVotes;
        uint8 winningRuling;
        uint64 draftTerm;
        uint64 jurorNumber;
        address triggeredBy;
        bool settledPenalties;
        uint256 slashedTokens;
    }

    enum Ruling {
        Missing,
        RefusedRuling
        // ruling options are dispute specific
    }

    enum DisputeState {
        PreDraft,
        Adjudicating,
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
        Invalid,
        Commit,
        Reveal,
        Appealable,
        Ended
    }

    // State constants which are set in the constructor and can't change
    ERC20 public jurorToken;
    uint64 public termDuration; // recomended value ~1 hour as 256 blocks (available block hash) around an hour to mine

    // Global config, configurable by governor
    address public governor; // TODO: consider using aOS' ACL
    uint256 public jurorMinStake; // TODO: consider adding it to the conf
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
    string internal constant ERROR_TERM_RANDOMNESS_UNAVAIL = "COURT_TERM_RANDOMNESS_UNAVAIL";
    string internal constant ERROR_INVALID_DISPUTE_STATE = "COURT_INVALID_DISPUTE_STATE";
    string internal constant ERROR_INVALID_ADJUDICATION_ROUND = "COURT_INVALID_ADJUDICATION_ROUND";
    string internal constant ERROR_INVALID_ADJUDICATION_STATE = "COURT_INVALID_ADJUDICATION_STATE";
    string internal constant ERROR_INVALID_JUROR = "COURT_INVALID_JUROR";
    string internal constant ERROR_ALREADY_VOTED = "COURT_ALREADY_VOTED";
    string internal constant ERROR_INVALID_VOTE = "COURT_INVALID_VOTE";
    string internal constant ERROR_INVALID_RULING_OPTIONS = "COURT_INVALID_RULING_OPTIONS";
    string internal constant ERROR_FAILURE_COMMITMENT_CHECK = "COURT_FAILURE_COMMITMENT_CHECK";
    string internal constant ERROR_CONFIG_PERIOD_ZERO_TERMS = "COURT_CONFIG_PERIOD_ZERO_TERMS";
    string internal constant ERROR_CANT_DISMISS_APPEAL = "COURT_CANT_DISMISS_APPEAL";
    string internal constant ERROR_PREV_ROUND_NOT_SETTLED = "COURT_PREV_ROUND_NOT_SETTLED";
    string internal constant ERROR_ROUND_ALREADY_SETTLED = "COURT_ROUND_ALREADY_SETTLED";
    string internal constant ERROR_ROUND_NOT_SETTLED = "COURT_ROUND_NOT_SETTLED";
    string internal constant ERROR_JUROR_ALREADY_REWARDED = "COURT_JUROR_ALREADY_REWARDED";
    string internal constant ERROR_JUROR_NOT_COHERENT = "COURT_JUROR_NOT_COHERENT";

    uint64 internal constant ZERO_TERM = 0; // invalid term that doesn't accept disputes
    uint64 public constant MANUAL_DEACTIVATION = uint64(-1);
    uint64 internal constant MODIFIER_ALLOWED_TERM_TRANSITIONS = 1;
    bytes4 private constant ARBITRABLE_INTERFACE_ID = 0xabababab; // TODO: interface id
    uint16 internal constant PCT_BASE = 10000; // ‱
    uint8 public constant MIN_RULING_OPTIONS = 2;
    uint8 public constant MAX_RULING_OPTIONS = MIN_RULING_OPTIONS;
    address internal constant BURN_ACCOUNT = 0xdead;

    event NewTerm(uint64 term, address indexed heartbeatSender);
    event NewCourtConfig(uint64 fromTerm, uint64 courtConfigId);
    event TokenBalanceChange(address indexed token, address indexed owner, uint256 amount, bool positive);
    event JurorActivated(address indexed juror, uint64 fromTerm, uint64 toTerm);
    event JurorDeactivated(address indexed juror, uint64 lastTerm);
    event JurorDrafted(uint256 indexed disputeId, address indexed juror, uint256 draftId);
    event DisputeStateChanged(uint256 indexed disputeId, DisputeState indexed state);
    event NewDispute(uint256 indexed disputeId, address indexed subject, uint64 indexed draftTerm, uint64 jurorNumber);
    event TokenWithdrawal(address indexed token, address indexed account, uint256 amount);
    event VoteCommitted(uint256 indexed disputeId, uint256 indexed roundId, address indexed juror, uint256 draftId, bytes32 commitment);
    event VoteRevealed(uint256 indexed disputeId, uint256 indexed roundId, address indexed juror, uint256 draftId, uint8 ruling);
    event VoteLeaked(uint256 indexed disputeId, uint256 indexed roundId, address indexed juror, uint256 draftId, address leaker);
    event RulingAppealed(uint256 indexed disputeId, uint256 indexed roundId, uint64 indexed draftTerm, uint256 jurorNumber);
    event RulingExecuted(uint256 indexed disputeId, uint8 indexed ruling);
    event RoundSlashingSettled(uint256 indexed disputeId, uint256 indexed roundId, uint256 slashedTokens);
    event RewardSettled(uint256 indexed disputeId, uint256 indexed roundId, address indexed juror, uint256 draftId);

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
        _checkAdjudicationState(_disputeId, _roundId, _state);
        require(_getJurorVote(_disputeId, _roundId, _draftId).juror == _juror, ERROR_INVALID_JUROR);

        _;
    }

    /**
     * @param _termDuration Duration in seconds per term (recommended 1 hour)
     * @param _jurorToken The address of the juror work token contract.
     * @param _feeToken The address of the token contract that is used to pay for fees.
     * @param _jurorFee The amount of _feeToken that is paid per juror per dispute
     * @param _heartbeatFee The amount of _feeToken per dispute to cover maintenance costs.
     * @param _draftFee The amount of _feeToken per juror to cover the drafting cost.
     * @param _settleFee The amount of _feeToken per juror to cover round settlement cost.
     * @param _governanceFeeShare Share in ‱ of fees that are paid to the governor.
     * @param _governor Address of the governor contract.
     * @param _firstTermStartTime Timestamp in seconds when the court will open (to give time for juror onboarding)
     * @param _jurorMinStake Minimum amount of juror tokens that can be activated
     * @param _roundStateDurations Number of terms that the different states a dispute round last
     * @param _penaltyPct ‱ of jurorMinStake that can be slashed (1/10,000)
     */
    constructor(
        uint64 _termDuration,
        ERC20 _jurorToken,
        ERC20 _feeToken,
        uint256 _jurorFee,
        uint256 _heartbeatFee,
        uint256 _draftFee,
        uint256 _settleFee,
        uint16 _governanceFeeShare,
        address _governor,
        uint64 _firstTermStartTime,
        uint256 _jurorMinStake,
        uint64[3] _roundStateDurations,
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
            _settleFee,
            _governanceFeeShare,
            _roundStateDurations,
            _penaltyPct
        );
        terms[ZERO_TERM].startTime = _firstTermStartTime - _termDuration;

        sumTree.init();
        assert(sumTree.insert(0) == 0); // first tree item is an empty juror
    }

    /**
     * @notice Send a heartbeat to the Court to transition up to `_termTransitions`
     */
    function heartbeat(uint64 _termTransitions) public {
        require(canTransitionTerm(), ERROR_UNFINISHED_TERM);

        uint64 prevTermId = term;
        Term storage prevTerm = terms[prevTermId];
        Term storage nextTerm = terms[prevTermId + 1];
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
        nextTerm.randomnessBN = _blockNumber() + 1; // randomness source set to next block (unknown when heartbeat happens)
        _processJurorQueues(prevTermId, nextTerm);

        CourtConfig storage courtConfig = courtConfigs[nextTerm.courtConfigId];
        uint256 totalFee = nextTerm.dependingDrafts * courtConfig.heartbeatFee;

        if (totalFee > 0) {
            _payFees(courtConfig.feeToken, heartbeatSender, totalFee, courtConfig.governanceFeeShare);
        }

        term += 1;
        emit NewTerm(term, heartbeatSender);

        if (_termTransitions > 1 && canTransitionTerm()) {
            heartbeat(_termTransitions - 1);
        }
    }

    /**
     * @notice Stake `@tokenAmount(self.jurorToken(), _amount)` to the Court
     */
    function stake(uint256 _amount, bytes) external {
        _stake(msg.sender, msg.sender, _amount);
    }

    /**
     * @notice Stake `@tokenAmount(self.jurorToken(), _amount)` for `_to` to the Court
     */
    function stakeFor(address _to, uint256 _amount, bytes) external {
        _stake(msg.sender, _to, _amount);
    }

    /**
     * @notice Unstake `@tokenAmount(self.jurorToken(), _amount)` for `_to` from the Court
     */
    function unstake(uint256 _amount, bytes) external {
        return withdraw(jurorToken, _amount); // withdraw() ensures the correct term
    }

    /**
     * @notice Withdraw `@tokenAmount(_token, _amount)` from the Court
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

        _removeTokens(_token, addr, _amount);
        require(_token.safeTransfer(addr, _amount), ERROR_TOKEN_TRANSFER_FAILED);

        emit TokenWithdrawal(_token, addr, _amount);
    }

    /**
     * @notice Become an active juror on term `_fromTerm` until term `_toTerm`
     */
    function activate(uint64 _fromTerm, uint64 _toTerm) external ensureTerm {
        // TODO: Charge activation fee to juror

        address jurorAddress = msg.sender;
        Account storage account = accounts[jurorAddress];
        uint256 balance = account.balances[jurorToken];

        require(_fromTerm > term, ERROR_INVALID_ACTIVATION_TERM);
        require(_toTerm > _fromTerm, ERROR_INVALID_DEACTIVATION_TERM);
        require(account.state == AccountState.NotJuror, ERROR_INVALID_ACCOUNT_STATE);
        require(balance >= jurorMinStake, ERROR_TOKENS_BELOW_MIN_STAKE);

        uint256 sumTreeId = account.sumTreeId;
        if (sumTreeId == 0) {
            sumTreeId = sumTree.insert(0); // Always > 0 (as constructor inserts the first item)
            account.sumTreeId = sumTreeId;
            jurorsByTreeId[sumTreeId] = jurorAddress;
        }

        if (term == ZERO_TERM && _fromTerm == ZERO_TERM + 1) {
            // allow direct juror onboardings before term 1 starts (no disputes depend on term 0)
            sumTree.update(sumTreeId, balance, true);
        } else {
            // TODO: check queue size limit
            account.update = AccountUpdate({ delta: balance, positive: true, term: _fromTerm });
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

        emit JurorActivated(jurorAddress, _fromTerm, _toTerm);
    }

    // TODO: Activate more tokens as a juror

    /**
     * @notice Stop being an active juror on term `_lastTerm`
     */
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

        // TODO: check queue size limit
        terms[_lastTerm].egressQueue.push(jurorAddress);
        account.toTerm = _lastTerm;

        emit JurorDeactivated(jurorAddress, _lastTerm);
    }

    /**
     * @notice Create a dispute over `_subject` with `_possibleRulings` possible rulings, drafting `_jurorNumber` jurors in term `_draftTerm`
     */
    function createDispute(IArbitrable _subject, uint8 _possibleRulings, uint64 _jurorNumber, uint64 _draftTerm)
        external
        ensureTerm
        returns (uint256)
    {   
        // TODO: Limit the min amount of terms before drafting (to allow for evidence submission)
        // TODO: Limit the max amount of terms into the future that a dispute can be drafted
        // TODO: Limit the max number of initial jurors
        // TODO: ERC165 check that _subject conforms to the Arbitrable interface
        // TODO: Consider requiring that only the contract being arbitred can create a dispute

        require(_possibleRulings >= MIN_RULING_OPTIONS && _possibleRulings <= MAX_RULING_OPTIONS, ERROR_INVALID_RULING_OPTIONS);

        uint256 disputeId = disputes.length;
        disputes.length = disputeId + 1;

        Dispute storage dispute = disputes[disputeId];
        dispute.subject = _subject;
        dispute.possibleRulings = _possibleRulings;

        // _newAdjudicationRound charges fees for starting the round
        _newAdjudicationRound(dispute, _jurorNumber, _draftTerm);

        emit NewDispute(disputeId, _subject, _draftTerm, _jurorNumber);

        return disputeId;
    }

    /**
     * @notice Dismissing dispute #`_disputeId`
     */
    function dismissDispute(uint256 _disputeId)
        external
        ensureTerm
    {
        Dispute storage dispute = disputes[_disputeId];
        uint256 roundId = dispute.rounds.length - 1;
        AdjudicationRound storage round = dispute.rounds[roundId];

        require(round.triggeredBy == msg.sender, ERROR_ENTITY_CANT_DISMISS);
        require(dispute.state == DisputeState.PreDraft && round.draftTerm > term, ERROR_CANT_DISMISS_AFTER_DRAFT);
        require(roundId == 0, ERROR_CANT_DISMISS_APPEAL);

        dispute.state = DisputeState.Dismissed;

        terms[round.draftTerm].dependingDrafts -= 1;

        // refund fees
        (ERC20 feeToken, uint256 feeAmount, uint16 governanceFeeShare) = feeForJurorDraft(round.draftTerm, round.jurorNumber);
        _payFees(feeToken, round.triggeredBy, feeAmount, governanceFeeShare);

        emit DisputeStateChanged(_disputeId, dispute.state);
    }

    /**
     * @notice Draft jurors for the next round of dispute #`_disputeId`
     */
    function draftAdjudicationRound(uint256 _disputeId)
        public
        ensureTerm
    {
        Dispute storage dispute = disputes[_disputeId];
        AdjudicationRound storage round = dispute.rounds[dispute.rounds.length - 1];
        Term storage draftTerm = terms[term];
        CourtConfig storage config = courtConfigs[draftTerm.courtConfigId]; // safe to use directly as it is the current term

        require(round.draftTerm == term, ERROR_NOT_DRAFT_TERM);
        require(dispute.state == DisputeState.PreDraft, ERROR_ROUND_ALREADY_DRAFTED);
        require(draftTerm.randomnessBN >= _blockNumber(), ERROR_TERM_RANDOMNESS_UNAVAIL);

        if (draftTerm.randomness == bytes32(0)) {
            draftTerm.randomness = block.blockhash(draftTerm.randomnessBN);
        }

        uint256 maxPenalty = _pct4(jurorMinStake, config.penaltyPct);
        uint256 jurorNumber = round.jurorNumber;
        uint256 skippedJurors = 0;
        round.votes.length = jurorNumber;

        for (uint256 i = 0; i < jurorNumber; i++) {
            (uint256 jurorKey, uint256 stake) = _treeSearch(draftTerm.randomness, _disputeId, i + skippedJurors);
            address juror = jurorsByTreeId[jurorKey];

            // Account storage jurorAccount = accounts[juror]; // Hitting stack too deep
            uint256 newAtStake = accounts[juror].atStakeTokens + maxPenalty;
            if (stake >= newAtStake) {
                accounts[juror].atStakeTokens += newAtStake;
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

    /**
     * @notice Commit juror vote for dispute #`_disputeId` (round #`_roundId`)
     */
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

        emit VoteCommitted(_disputeId, _roundId, msg.sender, _draftId, _commitment);
    }

    /**
     * @notice Leak vote for `_juror` in dispute #`_disputeId` (round #`_roundId`)
     */
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
        _checkVote(_disputeId, _roundId, _draftId, _leakedRuling, _salt);

        uint8 ruling = uint8(Ruling.RefusedRuling);
        JurorVote storage vote = _getJurorVote(_disputeId, _roundId, _draftId);
        vote.ruling = ruling;

        // TODO: slash juror

        _updateTally(_disputeId, _roundId, ruling);

        emit VoteLeaked(_disputeId, _roundId, _juror, _draftId, msg.sender);
        emit VoteRevealed(_disputeId, _roundId, _juror, _draftId, ruling);
    }

    /**
     * @notice Reveal juror `_ruling` vote in dispute #`_disputeId` (round #`_roundId`)
     */
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
        _checkVote(_disputeId, _roundId, _draftId, _ruling, _salt);

        Dispute storage dispute = disputes[_disputeId];
        JurorVote storage vote = _getJurorVote(_disputeId, _roundId, _draftId);

        require(_ruling > uint8(Ruling.Missing) && _ruling <= dispute.possibleRulings + 1, ERROR_INVALID_VOTE);
        
        vote.ruling = _ruling;
        _updateTally(_disputeId, _roundId, _ruling);

        emit VoteRevealed(_disputeId, _roundId, msg.sender, _draftId, _ruling);
    }

    /**
     * @notice Appeal round #`_roundId` ruling in dispute #`_disputeId`
     */
    function appealRuling(uint256 _disputeId, uint256 _roundId) external ensureTerm {
        // TODO: Implement appeals limit
        // TODO: Implement final appeal
        _checkAdjudicationState(_disputeId, _roundId, AdjudicationState.Appealable);

        Dispute storage dispute = disputes[_disputeId];
        AdjudicationRound storage currentRound = dispute.rounds[_roundId];

        uint64 appealJurorNumber = 2 * currentRound.jurorNumber + 1; // J' = 2J + 1
        uint64 appealDraftTerm = term + 1; // Appeals are drafted in the next term

        // _newAdjudicationRound charges fees for starting the round
        uint256 roundId = _newAdjudicationRound(dispute, appealJurorNumber, appealDraftTerm);
        emit RulingAppealed(_disputeId, roundId, appealDraftTerm, appealJurorNumber);
    }

    /**
     * @notice Execute the final ruling of dispute #`_disputeId`
     */
    function executeRuling(uint256 _disputeId, uint256 _roundId) external ensureTerm {
        // checks that dispute is in adjudication state
        _checkAdjudicationState(_disputeId, _roundId, AdjudicationState.Ended);

        Dispute storage dispute = disputes[_disputeId];
        dispute.state = DisputeState.Executed;

        uint8 ruling = getWinningRuling(_disputeId);

        dispute.subject.rule(_disputeId, uint256(ruling));

        emit RulingExecuted(_disputeId, ruling);
    }

    /**
     * @notice Execute the final ruling of dispute #`_disputeId`
     * @dev Just executes penalties, jurors must manually claim their rewards
     */
    function settleRoundSlashing(uint256 _disputeId, uint256 _roundId) external ensureTerm {
        Dispute storage dispute = disputes[_disputeId];
        AdjudicationRound storage round = dispute.rounds[_roundId];

        // Enforce that rounds are settled in order to avoid one round without incentive to settle
        // even if there is a settleFee, it may not be big enough and all jurors in the round are going to be slashed
        require(_roundId == 0 || dispute.rounds[_roundId - 1].settledPenalties, ERROR_PREV_ROUND_NOT_SETTLED);
        require(!round.settledPenalties, ERROR_ROUND_ALREADY_SETTLED);

        if (dispute.state != DisputeState.Executed) {
            _checkAdjudicationState(_disputeId, dispute.rounds.length - 1, AdjudicationState.Ended);
        } else {
            revert(ERROR_INVALID_DISPUTE_STATE);
        }

        uint8 ruling = getWinningRuling(_disputeId);
        CourtConfig storage config = courtConfigs[terms[round.draftTerm].courtConfigId]; // safe to use directly as it is the current term
        uint256 penalty = _pct4(jurorMinStake, config.penaltyPct);

        uint256 slashedTokens = 0;
        uint256 votesLength = round.votes.length;
        uint64 slashingUpdateTerm = term + 1; // TODO: check update queue size

        for (uint256 i = 0; i < votesLength; i++) {
            JurorVote storage vote = round.votes[i];
            Account storage account = accounts[vote.juror];
            account.atStakeTokens -= penalty;

            // If the juror didn't vote for the final ruling
            if (vote.ruling != ruling) {
                slashedTokens += penalty;

                if (account.state == AccountState.PastJuror) {
                    // Slash from balance if the account already deactivated
                    _removeTokens(jurorToken, vote.juror, penalty);
                } else {
                    assert(account.state == AccountState.Juror);
                    _editUpdate(account.update, penalty, false); // edit their update for slashing

                    // Unless the juror already had an update scheduled for the term that they will be slashed at
                    if (account.update.term <= slashingUpdateTerm) {
                        if (account.update.term != 0) {
                            // Juror had a pending update already
                            terms[account.update.term].updateQueue.deleteItem(vote.juror);
                        }

                        account.update.term = slashingUpdateTerm;
                        terms[slashingUpdateTerm].updateQueue.push(vote.juror);
                    }
                }
            }
        }

        round.slashedTokens = slashedTokens;
        round.settledPenalties = true;

        // No juror was coherent in the round
        if (round.rulingVotes[ruling] == 0) {
            // refund fees and burn ANJ
            _payFees(config.feeToken, round.triggeredBy, config.jurorFee * round.jurorNumber, config.governanceFeeShare);
            _assignTokens(jurorToken, BURN_ACCOUNT, slashedTokens);
        }

        _payFees(config.feeToken, msg.sender, config.settleFee * round.jurorNumber, config.governanceFeeShare);

        emit RoundSlashingSettled(_disputeId, _roundId, slashedTokens);
    }

     /**
     * @notice Claim juror reward for round #`_roundId` of dispute #`_disputeId`
     * @dev Just executes penalties, jurors must manually claim their rewards
     */
    function settleReward(uint256 _disputeId, uint256 _roundId, uint256 _draftId) external ensureTerm {
        Dispute storage dispute = disputes[_disputeId];
        AdjudicationRound storage round = dispute.rounds[_roundId];
        JurorVote storage vote = round.votes[_draftId];
        CourtConfig storage config = courtConfigs[terms[round.draftTerm].courtConfigId]; // safe to use directly as it is the current term
        uint8 ruling = getWinningRuling(_disputeId);

        require(round.settledPenalties, ERROR_ROUND_NOT_SETTLED);
        require(vote.ruling == ruling, ERROR_JUROR_NOT_COHERENT);
        require(!vote.rewarded, ERROR_JUROR_ALREADY_REWARDED);
        vote.rewarded = true;

        address juror = vote.juror;
        uint256 coherentJurors = round.rulingVotes[ruling];
        uint256 slashedTokens = round.slashedTokens;

        if (slashedTokens > 0) {
            _assignTokens(jurorToken, juror, slashedTokens / coherentJurors);
        }

        uint256 totalFees = config.jurorFee * round.jurorNumber;
        _payFees(config.feeToken, juror, totalFees / coherentJurors, config.governanceFeeShare);

        emit RewardSettled(_disputeId, _roundId, juror, _draftId);
    }

    function canTransitionTerm() public view returns (bool) {
        return neededTermTransitions() >= 1;
    }

    function neededTermTransitions() public view returns (uint64) {
        return (_time() - terms[term].startTime) / termDuration;
    }

    function getJurorVote(uint256 _disputeId, uint256 _roundId, uint256 _draftId) external view returns (address juror, uint8 ruling) {
        JurorVote storage jurorVote = _getJurorVote(_disputeId, _roundId, _draftId);

        return (jurorVote.juror, jurorVote.ruling);
    }

    function encryptVote(uint8 _ruling, bytes32 _salt) public view returns (bytes32) {
        return keccak256(abi.encodePacked(_ruling, _salt));
    }

    /**
     * @dev Assumes term is up to date
     */
    function feeForJurorDraft(uint64 _draftTerm, uint64 _jurorNumber) public view returns (ERC20 feeToken, uint256 feeAmount, uint16 governanceFeeShare) {
        CourtConfig storage fees = _courtConfigForTerm(_draftTerm);

        feeToken = fees.feeToken;
        governanceFeeShare = fees.governanceFeeShare;
        feeAmount = fees.heartbeatFee + _jurorNumber * (fees.jurorFee + fees.draftFee + fees.settleFee);
    }

    /**
     * @dev Callback of approveAndCall, allows staking directly with a transaction to the token contract.
     * @param _from The address making the transfer.
     * @param _amount Amount of tokens to transfer to Kleros (in basic units).
     * @param _token Token address
     */
    function receiveApproval(address _from, uint256 _amount, address _token, bytes)
        public
        only(_token)
    {
        if (_token == address(jurorToken)) {
            _stake(_from, _from, _amount);
            // TODO: Activate depending on data
        }
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

    function totalStakedFor(address _addr) public view returns (uint256) {
        Account storage account = accounts[_addr];
        uint256 sumTreeId = account.sumTreeId;
        uint256 activeTokens = sumTreeId > 0 ? sumTree.getItem(sumTreeId) : 0;
        AccountUpdate storage update = account.update;
        uint256 pendingTokens = update.positive ? update.delta : -update.delta;

        return account.balances[jurorToken] + activeTokens + pendingTokens;
    }

    /**
     * @dev Assumes that it is always called ensuring the term
     */
    function unlockedBalanceOf(address _addr) public view returns (uint256) {
        Account storage account = accounts[_addr];
        return account.balances[jurorToken].sub(account.atStakeTokens);
    }

    function _editUpdate(AccountUpdate storage update, uint256 _delta, bool _positive) internal {
        (update.delta, update.positive) = _signedSum(update.delta, update.positive, _delta, _positive);
    }

    /**
     * @dev Sum nA + nB which can be positive or negative denoted by pA and pB
     */
    function _signedSum(uint256 nA, bool pA, uint256 nB, bool pB) internal pure returns (uint256 nC, bool pC) {
        nC = nA + (pA == pB ? nB : -nB);
        pC = pB ? nC >= nA : nA >= nC;
        nC = pA == pC ? nC : -nC;
    }

    function _newAdjudicationRound(Dispute storage dispute, uint64 _jurorNumber, uint64 _draftTerm) internal returns (uint256 roundId) {
        (ERC20 feeToken, uint256 feeAmount,) = feeForJurorDraft(_draftTerm, _jurorNumber);
        if (feeAmount > 0) {
            require(feeToken.safeTransferFrom(msg.sender, this, feeAmount), ERROR_DEPOSIT_FAILED);
        }

        dispute.state = DisputeState.PreDraft;

        roundId = dispute.rounds.length;
        dispute.rounds.length = roundId + 1;

        AdjudicationRound storage round = dispute.rounds[roundId];
        round.draftTerm = _draftTerm;
        round.jurorNumber = _jurorNumber;
        round.triggeredBy = msg.sender;

        terms[_draftTerm].dependingDrafts += 1;
    }

    function _updateTally(uint256 _disputeId, uint256 _roundId, uint8 _ruling) internal {
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

    function _checkVote(uint256 _disputeId, uint256 _roundId, uint256 _draftId, uint8 _ruling, bytes32 _salt) internal {
        JurorVote storage jurorVote = _getJurorVote(_disputeId, _roundId, _draftId);

        require(jurorVote.commitment == encryptVote(_ruling, _salt), ERROR_FAILURE_COMMITMENT_CHECK);
        require(jurorVote.ruling == uint8(Ruling.Missing), ERROR_ALREADY_VOTED);
    }

    function getWinningRuling(uint256 _disputeId) public view returns (uint8 ruling) {
        Dispute storage dispute = disputes[_disputeId];
        AdjudicationRound storage round = dispute.rounds[dispute.rounds.length - 1];

        ruling = round.winningRuling;
        if (Ruling(ruling) == Ruling.Missing) {
            ruling = uint8(Ruling.RefusedRuling);
        }
    }

    function _checkAdjudicationState(uint256 _disputeId, uint256 _roundId, AdjudicationState _state) internal {
        Dispute storage dispute = disputes[_disputeId];
        DisputeState disputeState = dispute.state;
        if (disputeState == DisputeState.PreDraft) {
            draftAdjudicationRound(_disputeId);
        }

        require(disputeState == DisputeState.Adjudicating, ERROR_INVALID_DISPUTE_STATE);
        require(_roundId == dispute.rounds.length - 1, ERROR_INVALID_ADJUDICATION_ROUND);
        require(_adjudicationStateAtTerm(_disputeId, _roundId, term) == _state, ERROR_INVALID_ADJUDICATION_STATE);
    }

    function _adjudicationStateAtTerm(uint256 _disputeId, uint256 _roundId, uint64 _term) internal view returns (AdjudicationState) {
        AdjudicationRound storage round = disputes[_disputeId].rounds[_roundId];

        uint64 draftTerm = round.draftTerm;
        uint64 configId = terms[draftTerm].courtConfigId;
        CourtConfig storage config = courtConfigs[uint256(configId)];

        uint64 revealStart = draftTerm + config.commitTerms;
        uint64 appealStart = revealStart + config.revealTerms;
        uint64 appealEnd = appealStart + config.appealTerms;

        if (_term < draftTerm) {
            return AdjudicationState.Invalid;
        } else if (_term < revealStart) {
            return AdjudicationState.Commit;
        } else if (_term < appealStart) {
            return AdjudicationState.Reveal;
        } else if (_term < appealEnd) {
            return AdjudicationState.Appealable;
        } else {
            return AdjudicationState.Ended;
        }
    }

    function _getJurorVote(uint256 _disputeId, uint256 _roundId, uint256 _draftId) internal view returns (JurorVote storage) {
        return disputes[_disputeId].rounds[_roundId].votes[_draftId];
    }

    function _treeSearch(bytes32 _termRandomness, uint256 _disputeId, uint256 _iteration) internal view returns (uint256 key, uint256 value) {
        bytes32 seed = keccak256(abi.encodePacked(_termRandomness, _disputeId, _iteration));
        // TODO: optimize by caching tree.totalSum(), and perform a `tree.unsafeSortition(seed % totalSum)` (unimplemented)
        return sumTree.randomSortition(uint256(seed), 0);
    }

    function _courtConfigForTerm(uint64 _term) internal view returns (CourtConfig storage) {
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

        if (governanceFee > 0) {
            _assignTokens(_feeToken, governor, governanceFee);
        }
    }

    function _processJurorQueues(uint64 _prevTermId, Term storage _incomingTerm) internal {
        // Always process egress before updates
        // If a juror update is scheduled for the same term, it will get settled processing its exit
        _processEgressQueue(_incomingTerm, _prevTermId);
        _processUpdateQueue(_incomingTerm);
    }

    function _processEgressQueue(Term storage _incomingTerm, uint64 _prevTermId) internal {
        uint256 length = _incomingTerm.egressQueue.length;

        for (uint256 i = 0; i < length; i++) {
            address juror = _incomingTerm.egressQueue[i];
            Account storage account = accounts[juror];

            uint256 sumTreeId = account.sumTreeId;
            uint256 treeBalance = sumTree.getItem(sumTreeId);

            // Juror has their update in this term or in the future
            // settle immediately and remove from updates queue
            AccountUpdate storage futureUpdate = account.update;
            if (futureUpdate.term >= _prevTermId) {
                if (futureUpdate.positive) {
                    treeBalance = treeBalance + futureUpdate.delta;
                } else {
                    treeBalance = treeBalance - futureUpdate.delta;
                }

                terms[futureUpdate.term].updateQueue.deleteItem(juror);
            }

            sumTree.set(sumTreeId, 0);
            account.balances[jurorToken] += treeBalance;
            account.state = AccountState.PastJuror;
            delete account.update;
            delete account.sumTreeId;
        }

        if (length > 0) {
            delete _incomingTerm.egressQueue;
        }
    }

    function _processUpdateQueue(Term storage _incomingTerm) internal {
        uint256 length = _incomingTerm.updateQueue.length;
        for (uint256 i = 0; i < length; i++) {
            Account storage account = accounts[_incomingTerm.updateQueue[i]];
            AccountUpdate storage update = account.update;

            if (update.delta > 0) {
                // account.sumTreeId always > 0: as only a juror that activates can get in this queue (and gets its sumTreeId)
                sumTree.update(account.sumTreeId, update.delta, update.positive);
                delete account.update;
            }
        }
        if (length > 0) {
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

    function _removeTokens(ERC20 _token, address _from, uint256 _amount) internal {
        accounts[_from].balances[_token] -= _amount;

        emit TokenBalanceChange(_token, _from, _amount, false);
    }

    // TODO: Expose external function to change config
    function _setCourtConfig(
        uint64 _fromTerm,
        ERC20 _feeToken,
        uint256 _jurorFee,
        uint256 _heartbeatFee,
        uint256 _draftFee,
        uint256 _settleFee,
        uint16 _governanceFeeShare,
        uint64[3] _roundStateDurations,
        uint16 _penaltyPct
    ) internal {
        // TODO: Require config changes happening at least X terms in the future
        // Where X is the amount of terms in the future a dispute can be scheduled to be drafted at

        require(configChangeTerm > term || term == ZERO_TERM, ERROR_PAST_TERM_FEE_CHANGE);
        require(_governanceFeeShare <= PCT_BASE, ERROR_GOVENANCE_FEE_TOO_HIGH);

        for (uint i = 0; i < _roundStateDurations.length; i++) {
            require(_roundStateDurations[i] > 0, ERROR_CONFIG_PERIOD_ZERO_TERMS);
        }

        if (configChangeTerm != ZERO_TERM) {
            terms[configChangeTerm].courtConfigId = 0; // reset previously set fee structure change
        }

        CourtConfig memory courtConfig = CourtConfig({
            feeToken: _feeToken,
            governanceFeeShare: _governanceFeeShare,
            jurorFee: _jurorFee,
            heartbeatFee: _heartbeatFee,
            draftFee: _draftFee,
            settleFee: _settleFee,
            commitTerms: _roundStateDurations[0],
            revealTerms: _roundStateDurations[1],
            appealTerms: _roundStateDurations[2],
            penaltyPct: _penaltyPct
        });

        uint64 courtConfigId = uint64(courtConfigs.push(courtConfig) - 1);
        terms[configChangeTerm].courtConfigId = courtConfigId;
        configChangeTerm = _fromTerm;

        emit NewCourtConfig(_fromTerm, courtConfigId);
    }

    function _time() internal view returns (uint64) {
        return uint64(block.timestamp);
    }

    function _blockNumber() internal view returns (uint64) {
        return uint64(block.number);
    }

    function _pct4(uint256 _number, uint16 _pct) internal pure returns (uint256) {
        return _number * uint256(_pct) / uint256(PCT_BASE);
    }
}

