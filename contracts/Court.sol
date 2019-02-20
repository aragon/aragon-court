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


contract Court is ERC900, /*Arbitrator,*/ ApproveAndCallFallBack {
    enum Period {
        Activation, // When juror can deposit their tokens and parties give evidences.
        Draw,       // When jurors are drawn at random, note that this period is fast.
        Vote,       // Where jurors can vote on disputes.
        Appeal,     // When parties can appeal the rulings.
        Execution   // When where token redistribution occurs and Kleros call the arbitrated contracts.
    }

    struct Juror {
        mapping (address => uint256) balances; // token addr -> balance
        // Total number of tokens the jurors can loose in disputes they are drawn in. Those tokens are locked. Note that we can have atStake > balance but it should be statistically unlikely and does not pose issues.
        uint256 atStake;
        uint256 lastSession;  // Last session the tokens were activated.
        uint256 segmentStart; // Start of the segment of activated tokens.
        uint256 segmentEnd;   // End of the segment of activated tokens.
    }

    // Variables which should not change after initialization.
    ERC20 public jurorToken;

    // Config variables modifiable by the governor during activation phse
    RNG public rng;
    ERC20 public feeToken;
    uint256 public feeAmount; // per juror
    uint256 public jurorMinActivation = 0.1 * 1e18;
    uint256[5] public periodDurations;
    uint256 public maxAppeals = 5;

    address public governor; // TODO: consider using aOS' ACL

    uint256 public session = 1;      // Current session of the court.
    uint256 public lastPeriodChange; // The last time we changed of period (seconds).
    uint256 public rnBlock;          // The block linked with the RN which is requested.
    uint256 public randomSeed;

    Period public period; // AUDIT(@izqui): It should be possible to many periods running in parallel
    mapping (address => Juror) public jurors;

    event NewPeriod(Period _period, uint256 indexed _session);

    string internal constant ERROR_INVALID_ADDR = "COURT_INVALID_ADDR";
    string internal constant ERROR_DEPOSIT_FAILED = "COURT_DEPOSIT_FAILED";
    string internal constant ERROR_ZERO_TRANSFER = "COURT_ZERO_TRANSFER";
    string internal constant ERROR_LOCKED_TOKENS = "COURT_LOCKED_TOKENS";
    string internal constant ERROR_ACTIVATED_TOKENS = "COURT_ACTIVATED_TOKENS";

    modifier only(address _addr) {
        require(msg.sender == _addr, ERROR_INVALID_ADDR);
        _;
    }

    /** @dev Constructor.
     *  @param _jurorToken The address of the juror work token contract.
     *  @param _feeToken The address of the token contract that is used to pay for fees.
     *  @param _feeAmount The amount of _feeToken that is paid per juror per dispute
     *  @param _rng The random number generator which will be used.
     *  @param _periodDurations The minimal time for each period (seconds).
     *  @param _governor Address of the governor contract.
     */
    constructor(
        ERC20 _jurorToken,
        ERC20 _feeToken,
        uint256 _feeAmount,
        RNG _rng,
        uint256[5] _periodDurations,
        address _governor
    ) public {
        jurorToken = _jurorToken;
        rng = _rng;

        feeToken = _feeToken;
        feeAmount = _feeAmount;

        // solium-disable-next-line security/no-block-members
        lastPeriodChange = block.timestamp;
        periodDurations = _periodDurations; // AUDIT(@izqui): Verify the bytecode that solc produces here
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

        Juror storage juror = jurors[jurorAddress];

        uint256 balance = juror.balances[_token];

        if (_token == jurorToken) {
            // Make sure that there is no more at stake than owned to avoid overflow.
            require(juror.atStake <= balance, ERROR_LOCKED_TOKENS);
            require(_amount <= balance - juror.atStake, ERROR_LOCKED_TOKENS); // AUDIT(@izqui): Simpler to just safe math here
            require(juror.lastSession != session, ERROR_ACTIVATED_TOKENS);

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
        require(time - lastPeriodChange >= periodDurations[uint8(period)], "Not enough time has passed.");

        if (period == Period.Activation) {
            rnBlock = block.number + 1;
            rng.requestRN(rnBlock);
            period = Period.Draw;
        } else if (period == Period.Draw) {
            randomSeed = rng.getUncorrelatedRN(rnBlock); // AUDIT(@izqui): For the block number RNG the next period transition must be done within 256 blocks
            require(randomSeed != 0, "Random number not ready yet.");
            period = Period.Vote;
        } else if (period == Period.Vote) {
            period = Period.Appeal;
        } else if (period == Period.Appeal) {
            period = Period.Execution;
        } else if (period == Period.Execution) {
            period = Period.Activation;
            ++session;
            rnBlock = 0;
            randomSeed = 0;
        }

        lastPeriodChange = time;
        emit NewPeriod(period, session);
    }

    // TODO: governor parametrization
}