pragma solidity ^0.5.8;

import "@aragon/os/contracts/lib/token/ERC20.sol";

import "../../registry/IJurorsRegistry.sol";
import "../../subscriptions/ISubscriptions.sol";
import "../../subscriptions/ISubscriptionsOwner.sol";


contract SubscriptionsMock is ISubscriptions {
    bool internal upToDate;

    function setFeeAmount(uint256) external {}
    function setFeeToken(ERC20, uint256) external {}
    function setPrePaymentPeriods(uint256) external {}
    function setLatePaymentPenaltyPct(uint16) external {}
    function setGovernorSharePct(uint16) external {}
    function setResumePrePaidPeriods(uint256) external {}

    function setUpToDate(bool _upToDate) external {
        upToDate = _upToDate;
    }

    function isUpToDate(address) external view returns (bool) {
        return upToDate;
    }
}
