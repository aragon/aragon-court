pragma solidity ^0.4.24;

import "@aragon/os/contracts/lib/token/ERC20.sol";

import "../standards/subscription/ISubscriptionOwner.sol";
import "../standards/subscription/ISubscription.sol";


contract SubscriptionOwnerMock is ISubscriptionOwner {
    ISubscription subscription;

    constructor(ISubscription _subscription) public {
        subscription = _subscription;
    }

    function setFeeAmount(uint256 _feeAmount) external {
        subscription.setFeeAmount(_feeAmount);
    }

    function setFeeToken(ERC20 _feeToken) external {
        subscription.setFeeToken(_feeToken);
    }

    function setLatePaymentPenaltyPct(uint16 _latePaymentPenaltyPct) external {
        subscription.setLatePaymentPenaltyPct(_latePaymentPenaltyPct);
    }

    function setGovernorSharePct(uint16 _governorSharePct) external {
        subscription.setGovernorSharePct(_governorSharePct);
    }

    function getCurrentTermId() external returns (uint64) {
    }

    function getTermRandomness(uint64) external returns (bytes32) {
        return keccak256("randomness");
    }

    function getAccountSumTreeId(address) external returns (uint256) {
    }

    function getGovernor() external returns (address) {
        return address(this);
    }
}
