pragma solidity ^0.4.24; // TODO: pin solc

import "./standards/subscription/ISubscription.sol";
import "./standards/subscription/ISubscriptionOwner.sol";
import "./standards/sumtree/ISumTree.sol";

import "@aragon/os/contracts/lib/token/ERC20.sol";
import "@aragon/os/contracts/common/SafeERC20.sol";
//import "@aragon/os/contracts/commen/TimeHelpers.sol";
//import "@aragon/os/contracts/lib/math/SafeMath64.sol";


contract Subscription is ISubscription /* TimeHelpers */ {
    using SafeERC20 for ERC20;
    //using SafeMath64 for uint64;

    uint16 internal constant PCT_BASE = 10000; // ‱

    string internal constant ERROR_NOT_OWNER = "SUB_NOT_OWNER";
    string internal constant ERROR_OWNER_ALREADY_SET = "SUB_OWNER_ALREADY_SET";
    string internal constant ERROR_TOKEN_TRANSFER_FAILED = "SUB_TOKEN_TRANSFER_FAILED";
    string internal constant ERROR_ZERO_PERIOD_DURATION = "SUB_ZERO_PERIOD_DURATION";
    string internal constant ERROR_ZERO_FEE = "SUB_ZERO_FEE";
    string internal constant ERROR_INVALID_PERIOD = "SUB_INVALID_PERIOD";

    struct Organization {
        uint256 lastPaymentPeriodId;
    }

    struct Period {
        uint64 balanceCheckpoint;
        uint256 totalTreeSum;
        uint256 collectedFees;
    }

    ISubscriptionOwner internal owner;
    ISumTree internal sumTree;
    uint64 internal startTermId;
    uint64 internal periodDuration; // in Court terms
    uint16 public latePaymentPenaltyPct; // ‱ of penalty applied for not paying during proper period
    uint16 public governorSharePct; // ‱ of fees that go to governor of the Court
    ERC20 public feeToken;
    uint256 public feeAmount;
    uint256 internal accumulatedGovernorFees;
    mapping (address => Organization) internal organizations;
    mapping (uint256 => Period) internal periods;

    // TODO: events

    modifier onlyOwner {
        require(msg.sender == address(owner), ERROR_NOT_OWNER);
        _;
    }

    /**
     * @dev This can be frontrunned, and ownership stolen, but the Court will notice,
     *      because its call to this function will revert
     */
    function init(
        ISubscriptionOwner _owner,
        ISumTree _sumTree,
        uint64 _startTermId,
        uint64 _periodDuration,
        ERC20 _feeToken,
        uint256 _feeAmount,
        uint16 _latePaymentPenaltyPct,
        uint16 _governorSharePct
    )
        external
    {
        require(address(owner) == address(0), ERROR_OWNER_ALREADY_SET);
        require(_periodDuration > 0, ERROR_ZERO_PERIOD_DURATION);

        owner = _owner;
        sumTree = _sumTree;
        startTermId = _startTermId; // Court should set this to > 0, as term 0 is for jurors onboarding
        periodDuration = _periodDuration;
        feeToken = _feeToken;
        _setFeeAmount(_feeAmount);
        latePaymentPenaltyPct = _latePaymentPenaltyPct;
        governorSharePct = _governorSharePct;
    }

    function payFees(address _from) external {
        Organization storage organization = organizations[_from];
        uint256 currentPeriodId = _getCurrentPeriodId();

        uint256 missingPeriods;
        // periodId 0 is reserved to signal non-subscribed organizations
        if (organization.lastPaymentPeriodId == 0) {
            missingPeriods = 1;
        } else {
            missingPeriods = currentPeriodId - organization.lastPaymentPeriodId;
            // up to date
            if (missingPeriods == 0) {
                return;
            }
        }

        uint256 amountToPay = _pct4_increase((missingPeriods - 1) * feeAmount, latePaymentPenaltyPct) + feeAmount;
        uint256 governorFee = _pct4(amountToPay, governorSharePct);
        accumulatedGovernorFees += governorFee;
        uint256 collectedFees = amountToPay - governorFee;

        organization.lastPaymentPeriodId = currentPeriodId;
        periods[currentPeriodId].collectedFees += collectedFees;

        require(feeToken.safeTransferFrom(msg.sender, address(this), amountToPay), ERROR_TOKEN_TRANSFER_FAILED);
    }

    // getCurrentTermId in ISubscriptionOwner is not view, because of ensureTerm
    function isUpToDate(address _organization) external returns (bool) {
        return organizations[_organization].lastPaymentPeriodId == _getCurrentPeriodId();
    }

    function claimFees(uint256 _periodId) external {
        require(_periodId < _getCurrentPeriodId(), ERROR_INVALID_PERIOD);

        Period storage period = periods[_periodId];
        uint64 periodBalanceCheckpoint = period.balanceCheckpoint;

        // it's first time fees are claimed for this period
        if (periodBalanceCheckpoint == 0) {
            uint64 periodStartTermId = _getPeriodStartTermId(_periodId);
            uint64 nextPeriodStartTermId = _getPeriodStartTermId(_periodId + 1);
            bytes32 randomness = owner.getTermRandomness(nextPeriodStartTermId);
            // if randomness was not calculated on first 256 blocks of the term, it will be zero
            // in that case we just get the previous block for it, as we'll have the hash for sure
            // it could be slightly beneficial for the first juror calling this function,
            // but it's still impossible to predict during the period
            if (randomness == bytes32(0)) {
                randomness = blockhash(block.number - 1);
            }
            periodBalanceCheckpoint = periodStartTermId + uint64(uint256(randomness) % periodDuration);
            period.balanceCheckpoint = periodBalanceCheckpoint;
        }

        // get balance and total at checkpoint
        uint256 sumTreeId = owner.getAccountSumTreeId(msg.sender);
        uint256 jurorBalance = sumTree.getItemPast(sumTreeId, periodBalanceCheckpoint);
        uint256 totalTreeSum = period.totalTreeSum;
        if (totalTreeSum == 0) {
            totalTreeSum = sumTree.totalSumPast(periodBalanceCheckpoint);
        }

        // juror fee share
        uint256 jurorShare = period.collectedFees * jurorBalance / totalTreeSum;

        require(feeToken.safeTransfer(msg.sender, jurorShare), ERROR_TOKEN_TRANSFER_FAILED);
    }

    function transferFeesToGovernor() external {
        uint256 amount = accumulatedGovernorFees;
        accumulatedGovernorFees = 0;
        require(feeToken.safeTransfer(owner.getGovernor(), amount), ERROR_TOKEN_TRANSFER_FAILED);
    }

    function setFeeAmount(uint256 _feeAmount) external onlyOwner {
        _setFeeAmount(_feeAmount);
    }

    function setFeeToken(ERC20 _feeToken) external onlyOwner {
        feeToken = _feeToken;
    }

    function setLatePaymentPenaltyPct(uint16 _latePaymentPenaltyPct) external onlyOwner {
        latePaymentPenaltyPct = _latePaymentPenaltyPct;
    }

    function setGovernorSharePct(uint16 _governorSharePct) external onlyOwner {
        governorSharePct = _governorSharePct;
    }

    function getOwner() external view returns (address) {
        return owner;
    }

    function _setFeeAmount(uint256 _feeAmount) internal {
        require(_feeAmount > 0, ERROR_ZERO_FEE);
        feeAmount = _feeAmount;
    }

    // getCurrentTermId in ISubscriptionOwner is not view, because of ensureTerm
    function _getCurrentPeriodId() internal returns (uint256) {
        // periodId 0 is reserved to signal non-subscribed organizations
        return (owner.getCurrentTermId() - startTermId) / periodDuration + 1;
    }

    function _getPeriodStartTermId(uint256 _periodId) internal view returns (uint64) {
        return startTermId + uint64(_periodId) * periodDuration;
    }

    function _pct4(uint256 _number, uint16 _pct) internal pure returns (uint256) {
        return _number * uint256(_pct) / uint256(PCT_BASE);
    }

    function _pct4_increase(uint256 _number, uint16 _pct) internal pure returns (uint256) {
        return _number * uint256(PCT_BASE + _pct) / uint256(PCT_BASE);
    }
}
