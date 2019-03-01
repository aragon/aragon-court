pragma solidity ^0.4.24; // TODO: pin solc

// Inspired by: Kleros.sol https://github.com/kleros/kleros @ 7281e69
import "./lib/HexSumTree.sol";
import "./lib/ArrayUtils.sol";
import "./standards/arbitration/Arbitrator.sol";
import "./standards/arbitration/Arbitrable.sol";
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
        AccountState state; // whether the account is not a juror, a current juror or a past juror
        uint64 fromTerm;    // first term in which the juror can be drawn
        uint64 toTerm;      // last term in which the juror can be drawn
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
        address[] ingressQueue; // jurors that will be added to the juror tree
        address[] egressQueue;  // jurors that will be removed from to the juror tree
        address[] updatesQueue; // jurors whose stake has been updated
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
    uint64 public jurorCooldownTerms;
    uint256 public jurorActivationDust;
    uint256 public maxAppeals = 5;
    FeeStructure[] public feeStructures;

    // Court state
    uint64 public term;
    uint64 public feeChangeTerm;
    mapping (address => Account) public accounts;
    mapping (bytes32 => address) public jurorsByTreeId;
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

    uint64 internal constant ZERO_TERM = 0; // invalid term that doesn't accept disputes
    uint64 public constant MANUAL_DEACTIVATION = uint64(-1);
    uint64 internal constant MODIFIER_ALLOWED_TERM_TRANSITIONS = 1;

    event NewTerm(uint64 term, address indexed heartbeatSender);
    event NewFeeStructure(uint64 fromTerm, uint64 feeStructureId);
    event TokenBalanceChange(address indexed token, address indexed owner, uint256 amount, bool positive);
    event JurorActivate(address indexed juror, uint64 fromTerm, uint64 toTerm);
    event JurorDeactivate(address indexed juror, uint64 lastTerm);
    event TokenWithdrawal(address indexed token, address indexed account, uint256 amount);

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
        _setFeeStructure(ZERO_TERM, _feeToken, _jurorFee, _heartbeatFee);
        terms[ZERO_TERM].startTime = _firstTermStartTime - _termDuration;

        sumTree.init();
        assert(sumTree.insert(0) == bytes32(0)); // first tree item is an empty juror
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
        uint256 totalFee = nextTerm.dependingDraws * feeStructure.heartbeatFee;

        if (totalFee > 0) {
            _assignTokens(feeStructure.feeToken, heartbeatSender, totalFee);
        }

        term += 1;
        emit NewTerm(term, heartbeatSender);

        if (_termTransitions > 0 && canTransitionTerm()) {
            heartbeat(_termTransitions - 1);
        }
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
            // allow direct judge onboardings before term 1 starts (no disputes depend on term 0)
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
        only(jurorToken) // allow sending fees with it as well
        only(token)
    {
        _stake(_from, _from, _amount);
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

            if (accounts[jurorEgress].sumTreeId != bytes32(0)) {
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
        bytes32 sumTreeId = sumTree.insert(totalStakedFor(_jurorAddress));
        accounts[_jurorAddress].sumTreeId = sumTreeId;
        jurorsByTreeId[sumTreeId] = _jurorAddress;
    }

    function _stake(address _from, address _to, uint256 _amount) internal {
        require(_amount > 0, ERROR_ZERO_TRANSFER);
        require(jurorToken.transferFrom(_from, this, _amount), ERROR_DEPOSIT_FAILED);

        accounts[_to].balances[jurorToken] += _amount;

        emit Staked(_to, _amount, totalStakedFor(_to), "");
    }

    function _assignTokens(ERC20 _feeToken, address _to, uint256 _amount) internal {
        accounts[_to].balances[_feeToken] += _amount;

        emit TokenBalanceChange(_feeToken, _to, _amount, true);
    }

    function _setFeeStructure(
        uint64 _fromTerm,
        ERC20 _feeToken,
        uint256 _jurorFee,
        uint256 _heartbeatFee
    ) internal {
        require(feeChangeTerm > term || term == ZERO_TERM, ERROR_PAST_TERM_FEE_CHANGE);

        if (feeChangeTerm != ZERO_TERM) {
            terms[feeChangeTerm].feeStructureId = 0; // reset previously set fee structure change
        }

        FeeStructure memory feeStructure = FeeStructure({
            feeToken: _feeToken,
            jurorFee: _jurorFee,
            heartbeatFee: _heartbeatFee
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
        return term > account.toTerm + jurorCooldownTerms && account.pendingDisputes.length == 0;
    }
}

