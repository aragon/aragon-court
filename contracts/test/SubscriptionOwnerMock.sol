pragma solidity ^0.4.24;

import "@aragon/os/contracts/lib/token/ERC20.sol";

import "../standards/sumtree/ISumTree.sol";
import "../standards/subscription/ISubscriptionOwner.sol";
import "../standards/subscription/ISubscription.sol";


contract SubscriptionOwnerMock is ISubscriptionOwner {
    ISubscription subscription;
    ISumTree sumTree;

    uint64 termId;
    mapping (address => uint256) sumTreeIds;

    constructor(ISubscription _subscription, ISumTree _sumTree) public {
        subscription = _subscription;
        sumTree = _sumTree;
    }

    function setFeeAmount(uint256 _feeAmount) external {
        subscription.setFeeAmount(_feeAmount);
    }

    function setFeeToken(ERC20 _feeToken) external {
        subscription.setFeeToken(_feeToken);
    }

    function setPrePaymentPeriods(uint256 _prePaymentPeriods) external {
        subscription.setPrePaymentPeriods(_prePaymentPeriods);
    }

    function setLatePaymentPenaltyPct(uint16 _latePaymentPenaltyPct) external {
        subscription.setLatePaymentPenaltyPct(_latePaymentPenaltyPct);
    }

    function setGovernorSharePct(uint16 _governorSharePct) external {
        subscription.setGovernorSharePct(_governorSharePct);
    }

    function insertJuror(address _juror, uint64 _termId, uint256 _stake) external {
        sumTreeIds[_juror] = sumTree.insert(_termId, _stake);
    }

    function setCurrentTermId(uint64 _termId) external {
        termId = _termId;
    }

    function getCurrentTermId() external view returns (uint64) {
        return termId;
    }

    function getTermRandomness(uint64) external returns (bytes32) {
        return keccak256("randomness");
    }

    function getAccountSumTreeId(address _juror) external view returns (uint256) {
        return sumTreeIds[_juror];
    }

    function getGovernor() external view returns (address) {
        return address(this);
    }
}
