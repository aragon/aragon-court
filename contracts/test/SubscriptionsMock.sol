pragma solidity ^0.5.8;

import "@aragon/os/contracts/lib/token/ERC20.sol";

import "../standards/erc900/IJurorsRegistry.sol";
import "../standards/subscription/ISubscriptions.sol";
import "../standards/subscription/ISubscriptionsOwner.sol";


contract SubscriptionsMock is ISubscriptions {
    bool upToDate;

    function init(ISubscriptionsOwner, IJurorsRegistry, uint64, ERC20, uint256, uint256, uint16, uint16) external {}
    function setFeeAmount(uint256) external {}
    function setFeeToken(ERC20, uint256) external {}
    function setPrePaymentPeriods(uint256) external {}
    function setLatePaymentPenaltyPct(uint16) external {}
    function setGovernorSharePct(uint16) external {}

    function setUpToDate(bool _upToDate) external {
        upToDate = _upToDate;
    }

    function isUpToDate(address) external view returns (bool) {
        return upToDate;
    }
}
