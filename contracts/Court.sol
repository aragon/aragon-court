pragma solidity ^0.4.24; // TODO: pin solc

// Forked from: Kleros.sol https://github.com/kleros/kleros @ 7281e69

import "./standards/rng/RNG.sol";
import "./standards/arbitration/Arbitrator.sol";
import "./standards/arbitration/Arbitrable.sol";
import "./standards/erc900/ERC900.sol";

import { ApproveAndCallFallBack } from "@aragon/apps-shared-minime/contracts/MiniMeToken.sol";
import "@aragon/os/contracts/lib/token/ERC20.sol";

// AUDIT(@izqui): Code format should be optimized for readability not reducing the amount of LOCs
// AUDIT(@izqui): Not using SafeMath should be reviewed in a case by case basis
// AUDIT(@izqui): Arbitration fees should be payable in an ERC20, no just ETH (can have native ETH support)
// AUDIT(@izqui): Incorrect function order
// AUDIT(@izqui): Use emit for events
// AUDIT(@izqui): Magic strings in revert reasons


contract Court is ERC900, Arbitrator, ApproveAndCallFallBack {
    // Variables which should not change after initialization.
    ERC20 public jurorToken;
    uint256 public constant NON_PAYABLE_AMOUNT = (2**256 - 2) / 2; // An astronomic amount, practically can't be paid.

    // Config variables modifiable by the governor during activation phse
    RNG public rng;
    ERC20 public feeToken;
    uint256 public feeAmount; // The fee which will be paid to each juror.
    uint16 public defaultNumberJuror = 3; // Number of drawn jurors unless specified otherwise.
    uint256 public minActivatedToken = 0.1 * 1e18; // Minimum of tokens to be activated (in basic units).
    uint[5] public timePerPeriod; // The minimum time each period lasts (seconds).
    uint256 public alpha = 2000; // alpha in ‱ (1 / 10 000).
    uint256 constant ALPHA_DIVISOR = 1e4; // Amount we need to divided alpha in ‱ to get the float value of alpha.
    uint256 public maxAppeals = 5; // Number of times a dispute can be appealed. When exceeded appeal cost becomes NON_PAYABLE_AMOUNT.
    // Initially, the governor will be an address controlled by the Kleros team. At a later stage,
    // the governor will be switched to a governance contract with liquid voting.
    address public governor; // Address of the governor contract.

    // Variables changing during day to day interaction.
    uint256 public session = 1;      // Current session of the court.
    uint256 public lastPeriodChange; // The last time we changed of period (seconds).
    uint256 public segmentSize;      // Size of the segment of activated tokens.
    uint256 public rnBlock;          // The block linked with the RN which is requested.
    uint256 public randomNumber;     // Random number of the session.

    enum Period {
        Activation, // When juror can deposit their tokens and parties give evidences.
        Draw,       // When jurors are drawn at random, note that this period is fast.
        Vote,       // Where jurors can vote on disputes.
        Appeal,     // When parties can appeal the rulings.
        Execution   // When where token redistribution occurs and Kleros call the arbitrated contracts.
    }

    Period public period; // AUDIT(@izqui): It should be possible to many periods running in parallel

    struct Juror {
        mapping (address => uint256) balances; // token addr -> balance
        // Total number of tokens the jurors can loose in disputes they are drawn in. Those tokens are locked. Note that we can have atStake > balance but it should be statistically unlikely and does not pose issues.
        uint256 atStake;
        uint256 lastSession;  // Last session the tokens were activated.
        uint256 segmentStart; // Start of the segment of activated tokens.
        uint256 segmentEnd;   // End of the segment of activated tokens.
    }

    mapping (address => Juror) public jurors;

    struct Vote {
        address account; // The juror who casted the vote.
        uint256 ruling;     // The ruling which was given.
    }

    struct VoteCounter {
        uint256 winningChoice; // The choice which currently has the highest amount of votes. Is 0 in case of a tie.
        uint256 winningCount;  // The number of votes for winningChoice. Or for the choices which are tied. AUDIT(@izqui): Is this redundant?
        mapping (uint256 => uint) voteCount; // voteCount[choice] is the number of votes for choice.
    }

    enum DisputeState { // Not to be confused this with DisputeStatus in Arbitrator contract.
        Open,       // The dispute is opened but the outcome is not available yet (this include when jurors voted but appeal is still possible).
        Resolving,  // The token repartition has started. Note that if it's done in just one call, this state is skipped.
        Executable, // The arbitrated contract can be called to enforce the decision.
        Executed    // Everything has been done and the dispute can't be interacted with anymore.
    }

    struct Dispute {
        Arbitrable arbitrated;       // Contract to be arbitrated.
        uint256 session;                // First session the dispute was schedule.
        uint256 appeals;                // Number of appeals.
        uint256 choices;                // The number of choices available to the jurors.
        uint16 initialNumberJurors;  // The initial number of jurors.
        uint256 feeAmount; // The fee which will be paid to each juror.
        DisputeState state;          // The state of the dispute.
        Vote[][] votes;              // The votes in the form vote[appeals][voteID].
        VoteCounter[] voteCounter;   // The vote counters in the form voteCounter[appeals].
        mapping (address => uint) lastSessionVote; // Last session a juror has voted on this dispute. Is 0 if he never did.
        uint256 currentAppealToRepartition; // The current appeal we are repartitioning.
        AppealsRepartitioned[] appealsRepartitioned; // Track a partially repartitioned appeal in the form AppealsRepartitioned[appeal].
    }

    enum RepartitionStage { // State of the token repartition if oneShotTokenRepartition would throw because there are too many votes.
        Incoherent,
        Coherent,
        AtStake,
        Complete
    }

    struct AppealsRepartitioned {
        uint256 totalToRedistribute;   // Total amount of tokens we have to redistribute.
        uint256 nbCoherent;            // Number of coherent jurors for session.
        uint256 currentIncoherentVote; // Current vote for the incoherent loop.
        uint256 currentCoherentVote;   // Current vote we need to count.
        uint256 currentAtStakeVote;    // Current vote we need to count.
        RepartitionStage stage;     // Use with multipleShotTokenRepartition if oneShotTokenRepartition would throw.
    }

    Dispute[] public disputes;

    // **************************** //
    // *          Events          * //
    // **************************** //

    /** @dev Emitted when we pass to a new period.
     *  @param _period The new period.
     *  @param _session The current session.
     */
    event NewPeriod(Period _period, uint256 indexed _session);

    /** @dev Emitted when a juror wins or loses tokens.
      * @param _account The juror affected.
      * @param _disputeID The ID of the dispute.
      * @param _amount The amount of parts of token which was won. Can be negative for lost amounts.
      */
    event TokenShift(address indexed _account, uint256 _disputeID, int _amount);

    /** @dev Emited when a juror wins arbitration fees.
      * @param _account The account affected.
      * @param _disputeID The ID of the dispute.
      * @param _amount The amount of weis which was won.
      */
    event ArbitrationReward(address indexed _account, uint256 _disputeID, uint256 _amount);

    // **************************** //
    // *         Modifiers        * //
    // **************************** //

    // AUDIT(@izqui): Code formatting
    modifier onlyBy(address _account) {require(msg.sender == _account, "Wrong caller."); _;}
    // AUDIT(@izqui): Currently not checking if the period should have been transitioned, so some periods can last longer if no one bothers to call `passPeriod()`
    modifier onlyDuring(Period _period) {require(period == _period, "Wrong period."); _;}
    modifier onlyGovernor() {require(msg.sender == governor, "Only callable by the governor."); _;}


    /** @dev Constructor.
     *  @param _jurorToken The address of the juror work token contract.
     *  @param _feeToken The address of the token contract that is used to pay for fees.
     *  @param _feeAmount The amount of _feeToken that is paid per juror per dispute
     *  @param _rng The random number generator which will be used.
     *  @param _timePerPeriod The minimal time for each period (seconds).
     *  @param _governor Address of the governor contract.
     */
    constructor(
        ERC20 _jurorToken,
        ERC20 _feeToken,
        uint256 _feeAmount,
        RNG _rng,
        uint[5] _timePerPeriod,
        address _governor
    ) public {
        jurorToken = _jurorToken;
        rng = _rng;

        feeToken = _feeToken;
        feeAmount = _feeAmount;

        // solium-disable-next-line security/no-block-members
        lastPeriodChange = block.timestamp;
        timePerPeriod = _timePerPeriod; // AUDIT(@izqui): Verify the bytecode that solc produces here
        governor = _governor;
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
        onlyBy(jurorToken)
        onlyBy(token)
    {
        _stake(_from, _from, _amount);
    }

    function _stake(address _from, address _to, uint256 _amount) internal {
        require(jurorToken.transferFrom(_from, this, _amount), "Transfer failed.");

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
        address jurorAddress = msg.sender;

        Juror storage juror = jurors[jurorAddress];

        uint256 balance = juror.balances[_token];

        if (_token == jurorToken) {
            // Make sure that there is no more at stake than owned to avoid overflow.
            require(juror.atStake <= balance, "Balance is less than stake.");
            require(_amount <= balance - juror.atStake, "Value is more than free balance."); // AUDIT(@izqui): Simpler to just safe math here
            require(juror.lastSession != session, "You have deposited in this session.");

            emit Unstaked(jurorAddress, _amount, totalStakedFor(jurorAddress), "");
        }

        juror.balances[jurorToken] -= _amount;
        require(jurorToken.transfer(jurorAddress, _amount), "Transfer failed.");
    }

    // **************************** //
    // *      Court functions     * //
    // *    Modifying the state   * //
    // **************************** //

    // AUDIT(@izqui): This could automatically be triggered by any other court function that requires a period transition.
    // AUDIT(@izqui): No incentive for anyone to call this, delaying to call the function can result in periods lasting longer.

    /** @dev To call to go to a new period. TRUSTED.
     */
    function passPeriod() public {
        // solium-disable-next-line security/no-block-members
        uint256 time = block.timestamp;
        require(time - lastPeriodChange >= timePerPeriod[uint8(period)], "Not enough time has passed.");

        if (period == Period.Activation) {
            rnBlock = block.number + 1;
            rng.requestRN(rnBlock);
            period = Period.Draw;
        } else if (period == Period.Draw) {
            randomNumber = rng.getUncorrelatedRN(rnBlock); // AUDIT(@izqui): For the block number RNG the next period transition must be done within 256 blocks
            require(randomNumber != 0, "Random number not ready yet.");
            period = Period.Vote;
        } else if (period == Period.Vote) {
            period = Period.Appeal;
        } else if (period == Period.Appeal) {
            period = Period.Execution;
        } else if (period == Period.Execution) {
            period = Period.Activation;
            ++session;
            segmentSize = 0;
            rnBlock = 0;
            randomNumber = 0;
        }

        lastPeriodChange = time;
        emit NewPeriod(period, session);
    }

    // AUDIT(@izqui): Really impractical to require jurors to send a transaction to activate every period. It costs ~50k gas per juror to activate per period (issue #2)
    // AUDIT(@izqui): Jurors should provide either the period number or a TTL in case the transaction takes longer to mine resulting in a later activation

    /** @dev Deposit tokens in order to have chances of being drawn. Note that once tokens are deposited, 
     *  there is no possibility of depositing more.
     *  @param _value Amount of tokens (in basic units) to deposit.
     */
    function activateTokens(uint256 _value) public onlyDuring(Period.Activation) {
        Juror storage juror = jurors[msg.sender];
        require(_value <= juror.balances[jurorToken], "Not enough balance.");
        require(_value >= minActivatedToken, "Value is less than the minimum stake.");
        // Verify that tokens were not already activated for this session.
        require(juror.lastSession != session, "You have already activated in this session.");

        juror.lastSession = session;
        juror.segmentStart = segmentSize;
        segmentSize += _value;
        juror.segmentEnd = segmentSize;

    }

    // AUDIT(@izqui): Lacking commit-reveal juror votes
    // AUDIT(@izqui): Being drawn multiple times can lead to arbitration fees being kept by the contract and never distributed.

    /** @dev Vote a ruling. Juror must input the draw ID he was drawn.
     *  Note that the complexity is O(d), where d is amount of times the juror was drawn.
     *  Since being drawn multiple time is a rare occurrence and that a juror can always vote with less weight than it has, it is not a problem.
     *  But note that it can lead to arbitration fees being kept by the contract and never distributed.
     *  @param _disputeID The ID of the dispute the juror was drawn.
     *  @param _ruling The ruling given.
     *  @param _draws The list of draws the juror was drawn. Draw numbering starts at 1 and the numbers should be increasing.
     */
    function voteRuling(uint256 _disputeID, uint256 _ruling, uint[] _draws) public onlyDuring(Period.Vote) {
        Dispute storage dispute = disputes[_disputeID];
        Juror storage juror = jurors[msg.sender];
        VoteCounter storage voteCounter = dispute.voteCounter[dispute.appeals];
        require(dispute.lastSessionVote[msg.sender] != session, "You have already voted."); // Make sure juror hasn't voted yet.
        require(_ruling <= dispute.choices, "Invalid ruling.");
        // Note that it throws if the draws are incorrect.
        require(validDraws(msg.sender, _disputeID, _draws), "Invalid draws.");

        dispute.lastSessionVote[msg.sender] = session;
        voteCounter.voteCount[_ruling] += _draws.length;
        if (voteCounter.winningCount < voteCounter.voteCount[_ruling]) {
            voteCounter.winningCount = voteCounter.voteCount[_ruling];
            voteCounter.winningChoice = _ruling;
        } else if (voteCounter.winningCount==voteCounter.voteCount[_ruling] && _draws.length!=0) { // Verify draw length to be non-zero to avoid the possibility of setting tie by casting 0 votes.
            voteCounter.winningChoice = 0; // It's currently a tie.
        }
        for (uint256 i = 0; i < _draws.length; ++i) {
            dispute.votes[dispute.appeals].push(Vote({
                account: msg.sender,
                ruling: _ruling
            }));
        }

        juror.atStake += _draws.length * getStakePerDraw();
        uint256 feeToPay = _draws.length * dispute.feeAmount;
        msg.sender.transfer(feeToPay);
        emit ArbitrationReward(msg.sender, _disputeID, feeToPay);
    }

    /** @dev Steal part of the tokens and the arbitration fee of a juror who failed to vote.
     *  Note that a juror who voted but without all his weight can't be penalized.
     *  It is possible to not penalize with the maximum weight.
     *  But note that it can lead to arbitration fees being kept by the contract and never distributed.
     *  @param _jurorAddress Address of the juror to steal tokens from.
     *  @param _disputeID The ID of the dispute the juror was drawn.
     *  @param _draws The list of draws the juror was drawn. Numbering starts at 1 and the numbers should be increasing.
     */
    function penalizeInactiveJuror(address _jurorAddress, uint256 _disputeID, uint[] _draws) public {
        Dispute storage dispute = disputes[_disputeID];
        Juror storage inactiveJuror = jurors[_jurorAddress];
        require(period > Period.Vote, "Must be called after the vote period.");
        require(dispute.lastSessionVote[_jurorAddress] != session, "Juror did vote."); // Verify the juror hasn't voted.
        dispute.lastSessionVote[_jurorAddress] = session; // Update last session to avoid penalizing multiple times.
        require(validDraws(_jurorAddress, _disputeID, _draws), "Invalid draws.");
        uint256 penalty = _draws.length * minActivatedToken * 2 * alpha / ALPHA_DIVISOR;
        // Make sure the penalty is not higher than the balance.
        uint256 jurorStake = inactiveJuror.balances[jurorToken];
        if (penalty >= jurorStake) {
            penalty = jurorStake;
        }
        inactiveJuror.balances[jurorToken] -= penalty;
        emit TokenShift(_jurorAddress, _disputeID, -int(penalty));
        jurors[msg.sender].balances[jurorToken] += penalty / 2; // Give half of the penalty to the caller.
        emit TokenShift(msg.sender, _disputeID, int(penalty / 2));
        jurors[governor].balances[jurorToken] += penalty / 2; // The other half to the governor.
        emit TokenShift(governor, _disputeID, int(penalty / 2));
        msg.sender.transfer(_draws.length*dispute.feeAmount); // Give the arbitration fees to the caller.
    }

    // AUDIT(@izqui): these two repartition functions could be simplified if the juror has to pull their own tokens. Total refactor required here.
    // AUDIT(@izqui): once a dispute appeal's period passes this should be executable at any time, not only during execution periods

    /** @dev Execute all the token repartition.
     *  Note that this function could consume to much gas if there is too much votes. 
     *  It is O(v), where v is the number of votes for this dispute.
     *  In the next version, there will also be a function to execute it in multiple calls 
     *  (but note that one shot execution, if possible, is less expensive).
     *  @param _disputeID ID of the dispute.
     */
    function oneShotTokenRepartition(uint256 _disputeID) public onlyDuring(Period.Execution) {
        Dispute storage dispute = disputes[_disputeID];
        require(dispute.state == DisputeState.Open, "Dispute is not open.");
        require(dispute.session + dispute.appeals <= session, "Dispute is still active.");

        uint256 winningChoice = dispute.voteCounter[dispute.appeals].winningChoice;
        uint256 amountShift = getStakePerDraw();
        for (uint256 i = 0; i <= dispute.appeals; ++i) {
            // If the result is not a tie, some parties are incoherent. Note that 0 (refuse to arbitrate) winning is not a tie.
            // Result is a tie if the winningChoice is 0 (refuse to arbitrate) and the choice 0 is not the most voted choice.
            // Note that in case of a "tie" among some choices including 0, parties who did not vote 0 are considered incoherent.
            if (winningChoice!=0 || (dispute.voteCounter[dispute.appeals].voteCount[0] == dispute.voteCounter[dispute.appeals].winningCount)) {
                uint256 totalToRedistribute = 0;
                uint256 nbCoherent = 0;
                // First loop to penalize the incoherent votes.
                for (uint256 j = 0; j < dispute.votes[i].length; ++j) {
                    Vote storage vote = dispute.votes[i][j];
                    if (vote.ruling != winningChoice) {
                        Juror storage juror = jurors[vote.account];
                        uint256 penalty = amountShift<juror.balances[jurorToken] ? amountShift : juror.balances[jurorToken];
                        juror.balances[jurorToken] -= penalty;
                        emit TokenShift(vote.account, _disputeID, int(-penalty));
                        totalToRedistribute += penalty;
                    } else {
                        ++nbCoherent;
                    }
                }
                if (nbCoherent == 0) { // No one was coherent at this stage. Give the tokens to the governor.
                    jurors[governor].balances[jurorToken] += totalToRedistribute;
                    emit TokenShift(governor, _disputeID, int(totalToRedistribute));
                } else { // otherwise, redistribute them.
                    uint256 toRedistribute = totalToRedistribute / nbCoherent; // Note that few fractions of tokens can be lost but due to the high amount of decimals we don't care.
                    // Second loop to redistribute.
                    for (j = 0; j < dispute.votes[i].length; ++j) {
                        vote = dispute.votes[i][j];
                        if (vote.ruling == winningChoice) {
                            juror = jurors[vote.account];
                            juror.balances[jurorToken] += toRedistribute;
                            emit TokenShift(vote.account, _disputeID, int(toRedistribute));
                        }
                    }
                }
            }
            // Third loop to lower the atStake in order to unlock tokens.
            for (j = 0; j < dispute.votes[i].length; ++j) {
                vote = dispute.votes[i][j];
                juror = jurors[vote.account];
                juror.atStake -= amountShift; // Note that it can't underflow due to amountShift not changing between vote and redistribution.
            }
        }
        dispute.state = DisputeState.Executable; // Since it was solved in one shot, go directly to the executable step.
    }

    /** @dev Execute token repartition on a dispute for a specific number of votes.
     *  This should only be called if oneShotTokenRepartition will throw because there are too many votes (will use too much gas).
     *  Note that There are 3 iterations per vote. e.g. A dispute with 1 appeal (2 sessions) and 3 votes per session will have 18 iterations
     *  @param _disputeID ID of the dispute.
     *  @param _maxIterations the maxium number of votes to repartition in this iteration
     */
    function multipleShotTokenRepartition(uint256 _disputeID, uint256 _maxIterations) public onlyDuring(Period.Execution) {
        Dispute storage dispute = disputes[_disputeID];
        require(dispute.state <= DisputeState.Resolving, "Dispute is not open.");
        require(dispute.session+dispute.appeals <= session, "Dispute is still active.");
        dispute.state = DisputeState.Resolving; // Mark as resolving so oneShotTokenRepartition cannot be called on dispute.

        uint256 winningChoice = dispute.voteCounter[dispute.appeals].winningChoice;
        uint256 amountShift = getStakePerDraw();
        uint256 currentIterations = 0; // Total votes we have repartitioned this iteration.
        for (uint256 i = dispute.currentAppealToRepartition; i <= dispute.appeals; ++i) {
            // Allocate space for new AppealsRepartitioned.
            if (dispute.appealsRepartitioned.length < i+1) {
                dispute.appealsRepartitioned.length++;
            }

            // If the result is a tie, no parties are incoherent and no need to move tokens. Note that 0 (refuse to arbitrate) winning is not a tie.
            if (winningChoice==0 && (dispute.voteCounter[dispute.appeals].voteCount[0] != dispute.voteCounter[dispute.appeals].winningCount)) {
                // If ruling is a tie we can skip to at stake.
                dispute.appealsRepartitioned[i].stage = RepartitionStage.AtStake;
            }

            // First loop to penalize the incoherent votes.
            if (dispute.appealsRepartitioned[i].stage == RepartitionStage.Incoherent) {
                for (uint256 j = dispute.appealsRepartitioned[i].currentIncoherentVote; j < dispute.votes[i].length; ++j) {
                    if (currentIterations >= _maxIterations) {
                        return;
                    }
                    Vote storage vote = dispute.votes[i][j];
                    if (vote.ruling != winningChoice) {
                        Juror storage juror = jurors[vote.account];
                        uint256 penalty = amountShift<juror.balances[jurorToken] ? amountShift : juror.balances[jurorToken];
                        juror.balances[jurorToken] -= penalty;
                        emit TokenShift(vote.account, _disputeID, int(-penalty));
                        dispute.appealsRepartitioned[i].totalToRedistribute += penalty;
                    } else {
                        ++dispute.appealsRepartitioned[i].nbCoherent;
                    }

                    ++dispute.appealsRepartitioned[i].currentIncoherentVote;
                    ++currentIterations;
                }

                dispute.appealsRepartitioned[i].stage = RepartitionStage.Coherent;
            }

            // Second loop to reward coherent voters
            if (dispute.appealsRepartitioned[i].stage == RepartitionStage.Coherent) {
                if (dispute.appealsRepartitioned[i].nbCoherent == 0) { // No one was coherent at this stage. Give the tokens to the governor.
                    jurors[governor].balances[jurorToken] += dispute.appealsRepartitioned[i].totalToRedistribute;
                    emit TokenShift(governor, _disputeID, int(dispute.appealsRepartitioned[i].totalToRedistribute));
                    dispute.appealsRepartitioned[i].stage = RepartitionStage.AtStake;
                } else { // Otherwise, redistribute them.
                    uint256 toRedistribute = dispute.appealsRepartitioned[i].totalToRedistribute / dispute.appealsRepartitioned[i].nbCoherent; // Note that few fractions of tokens can be lost but due to the high amount of decimals we don't care.
                    // Second loop to redistribute.
                    for (j = dispute.appealsRepartitioned[i].currentCoherentVote; j < dispute.votes[i].length; ++j) {
                        if (currentIterations >= _maxIterations) {
                            return;
                        }
                        vote = dispute.votes[i][j];
                        if (vote.ruling == winningChoice) {
                            juror = jurors[vote.account];
                            juror.balances[jurorToken] += toRedistribute;
                            emit TokenShift(vote.account, _disputeID, int(toRedistribute));
                        }

                        ++currentIterations;
                        ++dispute.appealsRepartitioned[i].currentCoherentVote;
                    }

                    dispute.appealsRepartitioned[i].stage = RepartitionStage.AtStake;
                }
            }

            if (dispute.appealsRepartitioned[i].stage == RepartitionStage.AtStake) {
                // Third loop to lower the atStake in order to unlock tokens.
                for (j = dispute.appealsRepartitioned[i].currentAtStakeVote; j < dispute.votes[i].length; ++j) {
                    if (currentIterations >= _maxIterations) {
                        return;
                    }
                    vote = dispute.votes[i][j];
                    juror = jurors[vote.account];
                    juror.atStake -= amountShift; // Note that it can't underflow due to amountShift not changing between vote and redistribution.

                    ++currentIterations;
                    ++dispute.appealsRepartitioned[i].currentAtStakeVote;
                }

                dispute.appealsRepartitioned[i].stage = RepartitionStage.Complete;
            }

            if (dispute.appealsRepartitioned[i].stage == RepartitionStage.Complete) {
                ++dispute.currentAppealToRepartition;
            }
        }

        // AUDIT(@izqui): Since this requires the juror tokens to be distributed, rulings aren't executed until someone pays to distribute tokens
        // As there is no incentive to do so, the party interested in the outcome will end up paying the gas for paying jurors

        dispute.state = DisputeState.Executable;
    }

    // **************************** //
    // *      Court functions     * //
    // *     Constant and Pure    * //
    // **************************** //

    /** @dev Return the amount of jurors which are or will be drawn in the dispute.
     *  The number of jurors is doubled and 1 is added at each appeal. We have proven the formula by recurrence.
     *  This avoid having a variable number of jurors which would be updated in order to save gas.
     *  @param _disputeID The ID of the dispute we compute the amount of jurors.
     *  @return nbJurors The number of jurors which are drawn.
     */
    function amountJurors(uint256 _disputeID) public view returns (uint256 nbJurors) {
        Dispute storage dispute = disputes[_disputeID];
        return (dispute.initialNumberJurors + 1) * 2 ** dispute.appeals - 1;
    }

    /** @dev Must be used to verify that a juror has been draw at least _draws.length times.
     *  We have to require the user to specify the draws that lead the juror to be drawn.
     *  Because doing otherwise (looping through all draws) could consume too much gas.
     *  @param _jurorAddress Address of the juror we want to verify draws.
     *  @param _disputeID The ID of the dispute the juror was drawn.
     *  @param _draws The list of draws the juror was drawn. It draw numbering starts at 1 and the numbers should be increasing.
     *  Note that in most cases this list will just contain 1 number.
     *  @param valid true if the draws are valid.
     */
    function validDraws(address _jurorAddress, uint256 _disputeID, uint[] _draws) public view returns (bool valid) {
        uint256 draw = 0;
        Juror storage juror = jurors[_jurorAddress];
        Dispute storage dispute = disputes[_disputeID];
        uint256 nbJurors = amountJurors(_disputeID);

        // AUDIT(@izqui): Code formatting

        if (juror.lastSession != session) return false; // Make sure that the tokens were deposited for this session.
        if (dispute.session+dispute.appeals != session) return false; // Make sure there is currently a dispute.
        if (period <= Period.Draw) return false; // Make sure that jurors are already drawn.
        for (uint256 i = 0; i < _draws.length; ++i) {
            if (_draws[i] <= draw) return false; // Make sure that draws are always increasing to avoid someone inputing the same multiple times.
            draw = _draws[i];
            if (draw > nbJurors) return false;
            uint256 position = uint(keccak256(randomNumber, _disputeID, draw)) % segmentSize; // Random position on the segment for draw.
            require(position >= juror.segmentStart, "Invalid draw.");
            require(position < juror.segmentEnd, "Invalid draw.");
        }

        return true;
    }

    // **************************** //
    // *   Arbitrator functions   * //
    // *   Modifying the state    * //
    // **************************** //

    /** @dev Create a dispute. Must be called by the arbitrable contract.
     *  Must be paid at least arbitrationCost().
     *  @param _choices Amount of choices the arbitrator can make in this dispute.
     *  @param _extraData Null for the default number. Otherwise, first 16 bytes will be used to return the number of jurors.
     *  @return disputeID ID of the dispute created.
     */
    function createDispute(uint256 _choices, bytes _extraData) public payable returns (uint256 disputeID) {
        uint16 nbJurors = extraDataToNbJurors(_extraData);
        require(msg.value >= arbitrationCost(_extraData), "Not enough ETH to pay arbitration fees.");

        disputeID = disputes.length++;
        Dispute storage dispute = disputes[disputeID];
        dispute.arbitrated = Arbitrable(msg.sender);

        if (period < Period.Draw) { // If drawing did not start schedule it for the current session.
            dispute.session = session;
        } else { // Otherwise schedule it for the next one.
            dispute.session = session+1;
        }

        dispute.choices = _choices;
        dispute.initialNumberJurors = nbJurors;
        // We store it as the general fee can be changed through the governance mechanism.
        dispute.feeAmount = feeAmount;
        dispute.votes.length++; // AUDIT(@izqui): Why it cannot be zero indexed?
        dispute.voteCounter.length++;

        DisputeCreation(disputeID, Arbitrable(msg.sender));
        return disputeID;
    }

    /** @dev Appeal a ruling. Note that it has to be called before the arbitrator contract calls rule.
     *  @param _disputeID ID of the dispute to be appealed.
     */
    function appeal(uint256 _disputeID, bytes) public payable onlyDuring(Period.Appeal) {
        bytes memory noAppealExtraData = new bytes(0);
        super.appeal(_disputeID, noAppealExtraData); // AUDIT(@izqui): super.appeal just emits an event, inline it in this contract
        Dispute storage dispute = disputes[_disputeID];
        require(msg.value >= appealCost(_disputeID, noAppealExtraData), "Not enough ETH to pay appeal fees.");
        require(dispute.session+dispute.appeals == session, "Dispute is no longer active."); // Dispute of the current session.
        require(dispute.arbitrated == msg.sender, "Caller is not the arbitrated contract.");
        
        dispute.appeals++;
        dispute.votes.length++;
        dispute.voteCounter.length++;
    }

    // AUDIT(@izqui): Rulings can be executed infinite times, arbitrable contract should only be called once per ruling

    /** @dev Execute the ruling of a dispute which is in the state executable. UNTRUSTED.
     *  @param disputeID ID of the dispute to execute the ruling.
     */
    function executeRuling(uint256 disputeID) public {
        Dispute storage dispute = disputes[disputeID];
        require(dispute.state == DisputeState.Executable, "Dispute is not executable.");

        dispute.state = DisputeState.Executed;
        dispute.arbitrated.rule(disputeID, dispute.voteCounter[dispute.appeals].winningChoice);
    }

    // **************************** //
    // *   Arbitrator functions   * //
    // *    Constant and pure     * //
    // **************************** //

    /** @dev Compute the cost of arbitration. It is recommended not to increase it often, 
     *  as it can be highly time and gas consuming for the arbitrated contracts to cope with fee augmentation.
     *  @param _extraData Null for the default number. Other first 16 bits will be used to return the number of jurors.
     *  @return fee Amount to be paid.
     */
    function arbitrationCost(bytes _extraData) public view returns (uint256 fee) {
        return extraDataToNbJurors(_extraData) * feeAmount;
    }

    /** @dev Compute the cost of appeal. It is recommended not to increase it often, 
     *  as it can be highly time and gas consuming for the arbitrated contracts to cope with fee augmentation.
     *  @param _disputeID ID of the dispute to be appealed.
     *  @return fee Amount to be paid.
     */
    function appealCost(uint256 _disputeID, bytes) public view returns (uint256 fee) {
        Dispute storage dispute = disputes[_disputeID];

        if(dispute.appeals >= maxAppeals) return NON_PAYABLE_AMOUNT;

        return (2*amountJurors(_disputeID) + 1) * dispute.feeAmount;
    }

    /** @dev Compute the amount of jurors to be drawn.
     *  @param _extraData Null for the default number. Other first 16 bits will be used to return the number of jurors.
     *  Note that it does not check that the number of jurors is odd, but users are advised to choose a odd number of jurors.
     */
    function extraDataToNbJurors(bytes _extraData) internal view returns (uint16 nbJurors) {
        if (_extraData.length < 2)
            return defaultNumberJuror;
        else
            return (uint16(_extraData[0]) << 8) + uint16(_extraData[1]);
    }

    /** @dev Compute the minimum activated jurorTokens in alpha.
     *  Note there may be multiple draws for a single user on a single dispute.
     */
    function getStakePerDraw() public view returns (uint256 minActivatedTokenInAlpha) {
        return (alpha * minActivatedToken) / ALPHA_DIVISOR;
    }


    // **************************** //
    // *     Constant getters     * //
    // **************************** //

    /** @dev Getter for account in Vote.
     *  @param _disputeID ID of the dispute.
     *  @param _appeals Which appeal (or 0 for the initial session).
     *  @param _voteID The ID of the vote for this appeal (or initial session).
     *  @return account The address of the voter.
     */
    function getVoteAccount(uint256 _disputeID, uint256 _appeals, uint256 _voteID) public view returns (address account) {
        return disputes[_disputeID].votes[_appeals][_voteID].account;
    }

    /** @dev Getter for ruling in Vote.
     *  @param _disputeID ID of the dispute.
     *  @param _appeals Which appeal (or 0 for the initial session).
     *  @param _voteID The ID of the vote for this appeal (or initial session).
     *  @return ruling The ruling given by the voter.
     */
    function getVoteRuling(uint256 _disputeID, uint256 _appeals, uint256 _voteID) public view returns (uint256 ruling) {
        return disputes[_disputeID].votes[_appeals][_voteID].ruling;
    }

    /** @dev Getter for winningChoice in VoteCounter.
     *  @param _disputeID ID of the dispute.
     *  @param _appeals Which appeal (or 0 for the initial session).
     *  @return winningChoice The currently winning choice (or 0 if it's tied). Note that 0 can also be return if the majority refuses to arbitrate.
     */
    function getWinningChoice(uint256 _disputeID, uint256 _appeals) public view returns (uint256 winningChoice) {
        return disputes[_disputeID].voteCounter[_appeals].winningChoice;
    }

    /** @dev Getter for winningCount in VoteCounter.
     *  @param _disputeID ID of the dispute.
     *  @param _appeals Which appeal (or 0 for the initial session).
     *  @return winningCount The amount of votes the winning choice (or those who are tied) has.
     */
    function getWinningCount(uint256 _disputeID, uint256 _appeals) public view returns (uint256 winningCount) {
        return disputes[_disputeID].voteCounter[_appeals].winningCount;
    }

    /** @dev Getter for voteCount in VoteCounter.
     *  @param _disputeID ID of the dispute.
     *  @param _appeals Which appeal (or 0 for the initial session).
     *  @param _choice The choice.
     *  @return voteCount The amount of votes the winning choice (or those who are tied) has.
     */
    function getVoteCount(uint256 _disputeID, uint256 _appeals, uint256 _choice) public view returns (uint256 voteCount) {
        return disputes[_disputeID].voteCounter[_appeals].voteCount[_choice];
    }

    /** @dev Getter for lastSessionVote in Dispute.
     *  @param _disputeID ID of the dispute.
     *  @param _juror The juror we want to get the last session he voted.
     *  @return lastSessionVote The last session the juror voted.
     */
    function getLastSessionVote(uint256 _disputeID, address _juror) public view returns (uint256 lastSessionVote) {
        return disputes[_disputeID].lastSessionVote[_juror];
    }

    /** @dev Is the juror drawn in the draw of the dispute.
     *  @param _disputeID ID of the dispute.
     *  @param _juror The juror.
     *  @param _draw The draw. Note that it starts at 1.
     *  @return drawn True if the juror is drawn, false otherwise.
     */
    function isDrawn(uint256 _disputeID, address _juror, uint256 _draw) public view returns (bool drawn) {
        Dispute storage dispute = disputes[_disputeID];
        Juror storage juror = jurors[_juror];
        if ( // AUDIT(@izqui): Code smell
            juror.lastSession != session || (dispute.session + dispute.appeals != session) || period <= Period.Draw || _draw > amountJurors(_disputeID) || _draw == 0 || segmentSize == 0
        ) {
            return false;
        } else {
            uint256 position = uint(keccak256(randomNumber,_disputeID,_draw)) % segmentSize; // AUDIT(@izqui): Use `validDrawns` or move hashing calculation to a pure function
            return (position >= juror.segmentStart) && (position < juror.segmentEnd);
        }

    }

    /** @dev Return the current ruling of a dispute. This is useful for parties to know if they should appeal.
     *  @param _disputeID ID of the dispute.
     *  @return ruling The current ruling which will be given if there is no appeal. If it is not available, return 0.
     */
    function currentRuling(uint256 _disputeID) public view returns (uint256 ruling) {
        Dispute storage dispute = disputes[_disputeID];
        return dispute.voteCounter[dispute.appeals].winningChoice;
    }

    /** @dev Return the status of a dispute.
     *  @param _disputeID ID of the dispute to rule.
     *  @return status The status of the dispute.
     */
    function disputeStatus(uint256 _disputeID) public view returns (DisputeStatus status) {
        // AUDIT(@izqui): Code smell

        Dispute storage dispute = disputes[_disputeID];
        if (dispute.session+dispute.appeals < session) // Dispute of past session.
            return DisputeStatus.Solved;
        else if(dispute.session+dispute.appeals == session) { // Dispute of current session.
            if (dispute.state == DisputeState.Open) {
                if (period < Period.Appeal)
                    return DisputeStatus.Waiting;
                else if (period == Period.Appeal)
                    return DisputeStatus.Appealable;
                else return DisputeStatus.Solved;
            } else return DisputeStatus.Solved;
        } else return DisputeStatus.Waiting; // Dispute for future session.
    }

    // **************************** //
    // *     Governor Functions   * //
    // **************************** //

    // AUDIT(@izqui): Governor could steal juror fees

    /** @dev General call function where the contract execute an arbitrary call with data and ETH following governor orders.
     *  @param _data Transaction data.
     *  @param _value Transaction value.
     *  @param _target Transaction target.
     */
    function executeOrder(bytes32 _data, uint256 _value, address _target) public onlyGovernor {
        _target.call.value(_value)(_data); // solium-disable-line security/no-call-value
    }

    /** @dev Setter for rng.
     *  @param _rng An instance of RNG.
     */
    function setRng(RNG _rng) public onlyGovernor {
        rng = _rng;
    }

    /** @dev Setter for feeAmount.
     *  @param _feeAmount The fee which will be paid to each juror.
     */
    function setArbitrationFeePerJuror(uint256 _feeAmount) public onlyGovernor {
        feeAmount = _feeAmount;
    }

    /** @dev Setter for defaultNumberJuror.
     *  @param _defaultNumberJuror Number of drawn jurors unless specified otherwise.
     */
    function setDefaultNumberJuror(uint16 _defaultNumberJuror) public onlyGovernor {
        defaultNumberJuror = _defaultNumberJuror;
    }

    /** @dev Setter for minActivatedToken.
     *  @param _minActivatedToken Minimum of tokens to be activated (in basic units).
     */
    function setMinActivatedToken(uint256 _minActivatedToken) public onlyGovernor {
        minActivatedToken = _minActivatedToken;
    }

    /** @dev Setter for timePerPeriod.
     *  @param _timePerPeriod The minimum time each period lasts (seconds).
     */
    function setTimePerPeriod(uint[5] _timePerPeriod) public onlyGovernor {
        timePerPeriod = _timePerPeriod;
    }

    /** @dev Setter for alpha.
     *  @param _alpha Alpha in ‱.
     */
    function setAlpha(uint256 _alpha) public onlyGovernor {
        alpha = _alpha;
    }

    /** @dev Setter for maxAppeals.
     *  @param _maxAppeals Number of times a dispute can be appealed. When exceeded appeal cost becomes NON_PAYABLE_AMOUNT.
     */
    function setMaxAppeals(uint256 _maxAppeals) public onlyGovernor {
        maxAppeals = _maxAppeals;
    }

    /** @dev Setter for governor.
     *  @param _governor Address of the governor contract.
     */
    function setGovernor(address _governor) public onlyGovernor {
        governor = _governor;
    }
}