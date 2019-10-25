pragma solidity ^0.5.8;

import "../../subscriptions/ISubscriptions.sol";


contract SubscriptionsMock is ISubscriptions {
    bool internal upToDate;

    function setUpToDate(bool _upToDate) external {
        upToDate = _upToDate;
    }

    function isUpToDate(address) external view returns (bool) {
        return upToDate;
    }
}
