pragma solidity ^0.4.24; // TODO: pin solc

// Inspired by: Kleros.sol https://github.com/kleros/kleros @ 7281e69
import "./lib/HexSumTree.sol";
import "./standards/arbitration/Arbitrator.sol";
import "./standards/arbitration/Arbitrable.sol";
import "./standards/erc900/ERC900.sol";

import { ApproveAndCallFallBack } from "@aragon/apps-shared-minime/contracts/MiniMeToken.sol";
import "@aragon/os/contracts/lib/token/ERC20.sol";


contract Court is ERC900, ApproveAndCallFallBack {
    using HexSumTree for HexSumTree.Tree;

    enum AccountState {
        NotJuror,
        Juror,
        PastJuror
    }

    struct Account {
        mapping (address => uint256) balances; // token addr -> balance
        AccountState state; // whether the account is not a juror, a current juror or a past juror
        uint32 fromTerm;    // first term in which the juror can be drawn
        uint32 toTerm;      // last term in which the juror can be drawn
        bytes32 sumTreeId;  // key in the sum tree used for sortition
        uint128[] pendingDisputes; // disputes in which the juror was drawn which haven't resolved
    }

    struct FeeStructure {
        ERC20 feeToken;
        uint256 jurorFee;     // per juror, total dispute fee = jurorFee * jurors drawn
        uint256 heartbeatFee; // per dispute, total heartbeat fee = heartbeatFee * disputes/appeals in term
    }

    struct Term {
        uint64 startTime;       // timestamp when the term started 
        uint64 dependingDraws;  // disputes or appeals pegged to this term for randomness
        uint64 feeStructureId;  // fee structure for this term (index in feeStructures array)
        uint64 randomnessBN;    // block number for entropy
        uint256 randomness;     // entropy from randomnessBN block hash
        address[] jurorIngress; // jurors that will be added to the juror tree
        address[] jurorEgress;  // jurors that will be removed from to the juror tree
        address[] jurorUpdates; // jurors whose stake has been updated
    }

    struct Dispute {
        Arbitrable subject;
        uint64 termId;
        // TODO
    }

    // State constants which are set in the constructor and can't change
    ERC20 public jurorToken;
    uint64 public termDuration; // recomended value ~1 hour as 256 blocks (available block hash) around an hour to mine

    // Global config, configurable by governor
    address public governor; // TODO: consider using aOS' ACL
    uint256 public jurorActivationDust;
    uint256 public maxAppeals = 5;
    FeeStructure[] public feeStructures;

    // Court state
    uint256 public term;
    mapping (address => Account) public jurors;
    mapping (uint256 => Term) public terms;
    HexSumTree.Tree internal sumTree;
    Dispute[] public disputes;
    uint256 public feeChangeTerm;

    string internal constant ERROR_INVALID_ADDR = "COURT_INVALID_ADDR";
    string internal constant ERROR_DEPOSIT_FAILED = "COURT_DEPOSIT_FAILED";
    string internal constant ERROR_ZERO_TRANSFER = "COURT_ZERO_TRANSFER";
    string internal constant ERROR_LOCKED_TOKENS = "COURT_LOCKED_TOKENS";
    string internal constant ERROR_ACTIVATED_TOKENS = "COURT_ACTIVATED_TOKENS";

    uint256 internal constant ZERO_TERM = 0; // invalid term that doesn't accept disputes
    uint256 internal constant MODIFIER_ALLOWED_TERM_TRANSITIONS = 1;

    event NewTerm(uint256 term, address indexed heartbeatSender);

    modifier only(address _addr) {
        require(msg.sender == _addr, ERROR_INVALID_ADDR);
        _;
    }

    /** @dev Constructor.
     *  @param _termDuration Duration in seconds per term (recommended 1 hour)
     *  @param _jurorToken The address of the juror work token contract.
     *  @param _feeToken The address of the token contract that is used to pay for fees.
     *  @param _jurorFee The amount of _feeToken that is paid per juror per dispute
     *  @param _heartbeatFee The amount of _feeToken per dispute to cover maintenance costs.
     *  @param _governor Address of the governor contract.
     *  @param _firstTermStartTime Timestamp in seconds when the court will open (to give time for juror onboarding)
     */
    constructor(
        uint64 _termDuration,
        ERC20 _jurorToken,
        ERC20 _feeToken,
        uint256 _jurorFee,
        uint256 _heartbeatFee,
        address _governor,
        uint64 _firstTermStartTime,
        uint256 _jurorActivationDust
    ) public {
        termDuration = _termDuration;
        jurorToken = _jurorToken;
        jurorActivationDust = _jurorActivationDust;
        governor = _governor;
        
        feeStructures.length = 1; // leave index 0 empty
        _setFeeStructure(ZERO_TERM, _feeToken, _jurorFee, _heartbeatFee);
        terms[ZERO_TERM].startTime = _firstTermStartTime - _termDuration;

        sumTree.init();
    }

    string internal constant ERROR_TOO_MANY_TRANSITIONS = "COURT_TOO_MANY_TRANSITIONS";
    string internal constant ERROR_FIRST_TERM_NOT_STARTED = "COURT_FIRST_TERM_NOT_STARTED";

    modifier ensureTerm {
        require(term > ZERO_TERM, ERROR_FIRST_TERM_NOT_STARTED);
        
        uint256 requiredTransitions = neededTermTransitions();
        require(requiredTransitions <= MODIFIER_ALLOWED_TERM_TRANSITIONS, ERROR_TOO_MANY_TRANSITIONS);

        if (requiredTransitions > 0) {
            heartbeat(requiredTransitions);
        }

        _;
    }

    string internal constant ERROR_UNFINISHED_TERM = "COURT_UNFINISHED_TERM";

    function heartbeat(uint256 _termTransitions) public {
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
        processJurorQueues(nextTerm);

        FeeStructure storage feeStructure = feeStructures[nextTerm.feeStructureId];
        uint256 totalFee = nextTerm.dependingDraws * feeStructure.heartbeatFee;

        if (totalFee > 0) {
            assignTokens(feeStructure.feeToken, heartbeatSender, totalFee);
        }

        term += 1;
        emit NewTerm(term, heartbeatSender);

        if (_termTransitions > 0 && canTransitionTerm()) {
            heartbeat(_termTransitions - 1);
        }
    }

    function processJurorQueues(Term storage _incomingTerm) internal {

    }

    event TokenBalanceChange(address indexed token, address indexed owner, uint256 amount, bool positive);

    function assignTokens(ERC20 _feeToken, address _to, uint256 _amount) internal {
        jurors[_to].balances[_feeToken] += _amount;

        emit TokenBalanceChange(_feeToken, _to, _amount, true);
    }

    function canTransitionTerm() public view returns (bool) {
        return neededTermTransitions() >= 1;
    }

    function neededTermTransitions() public view returns (uint256) {
        return (time() - terms[term].startTime) / termDuration;
    }

    function time() public view returns (uint64) {
        return uint64(block.timestamp);
    }

    function blockNumber() public view returns (uint64) {
        return uint64(block.number);
    }

    string internal constant ERROR_PAST_TERM_TERM_FEE_CHANGE = "COURT_PAST_TERM_FEE_CHANGE";
    event NewFeeStructure(uint256 fromTerm, uint256 feeStructureId);

    function _setFeeStructure(
        uint256 _fromTerm,
        ERC20 _feeToken,
        uint256 _jurorFee,
        uint256 _heartbeatFee
    ) internal {
        require(feeChangeTerm > term || term == ZERO_TERM, ERROR_PAST_TERM_TERM_FEE_CHANGE);

        if (feeChangeTerm != ZERO_TERM) {
            terms[feeChangeTerm].feeStructureId = 0; // reset previously set fee structure change
        }

        FeeStructure memory feeStructure = FeeStructure({
            feeToken: _feeToken,
            jurorFee: _jurorFee,
            heartbeatFee: _heartbeatFee
        });

        uint256 feeStructureId = feeStructures.push(feeStructure) - 1;
        terms[feeChangeTerm].feeStructureId = uint64(feeStructureId);
        feeChangeTerm = _fromTerm;

        emit NewFeeStructure(_fromTerm, feeStructureId);
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
        only(jurorToken)
        only(token)
    {
        _stake(_from, _from, _amount);
    }

    function _stake(address _from, address _to, uint256 _amount) internal {
        require(_amount > 0, ERROR_ZERO_TRANSFER);
        require(jurorToken.transferFrom(_from, this, _amount), ERROR_DEPOSIT_FAILED);

        jurors[_to].balances[jurorToken] += _amount;

        emit Staked(_to, _amount, totalStakedFor(_to), "");
    }

    function unstake(uint256 _amount, bytes) external {
        return withdraw(jurorToken, _amount);
    }

    function totalStakedFor(address _addr) public view returns (uint256) {
        return jurors[_addr].balances[jurorToken];
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
     *  Jurors can't withdraw their tokens if they have deposited some during this session.
     *  This is to prevent jurors from withdrawing tokens they could lose.
     *  @param _token Token to withdraw
     *  @param _amount The amount to withdraw.
     */
    function withdraw(ERC20 _token, uint256 _amount) public {
        require(_amount > 0, ERROR_ZERO_TRANSFER);

        address jurorAddress = msg.sender;

        Account storage juror = jurors[jurorAddress];

        uint256 balance = juror.balances[_token];

        if (_token == jurorToken) {
            /*
            TODO
            require(juror.atStake <= balance, ERROR_LOCKED_TOKENS);
            require(_amount <= balance - juror.atStake, ERROR_LOCKED_TOKENS); // AUDIT(@izqui): Simpler to just safe math here
            require(juror.lastSession != session, ERROR_ACTIVATED_TOKENS);
            */

            emit Unstaked(jurorAddress, _amount, totalStakedFor(jurorAddress), "");
        }

        juror.balances[jurorToken] -= _amount;
        require(jurorToken.transfer(jurorAddress, _amount), "Transfer failed.");
    }

    function activate(uint256 fromSession, uint256 toSession) external {

    }

    function deactivate() external {

    }
}

