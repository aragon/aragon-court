pragma solidity ^0.4.24;

import "../standards/subscription/ISubscriptions.sol";


contract SubscriptionsMock is ISubscriptions {
    bool upToDate;

    function setFeeAmount(uint256 _feeAmount) external {}
    function setFeeToken(ERC20 _feeToken, uint256 _feeAmount) external {}
    function setPrePaymentPeriods(uint256 _prePaymentPeriods) external {}
    function setLatePaymentPenaltyPct(uint16 _latePaymentPenaltyPct) external {}
    function setGovernorSharePct(uint16 _governorSharePct) external {}

    function setUpToDate(bool _upToDate) external {
        upToDate = _upToDate;
    }

    function isUpToDate(address _subscriber) external view returns (bool) {
        return upToDate;
    }
}
