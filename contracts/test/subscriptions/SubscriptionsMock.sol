pragma solidity ^0.5.8;

import "../../subscriptions/ISubscriptions.sol";
import "../../subscriptions/CourtSubscriptions.sol";


contract SubscriptionsMock is CourtSubscriptions {
    bool internal upToDate;

    constructor(
        Controller _controller,
        uint64 _periodDuration,
        ERC20 _feeToken,
        uint256 _feeAmount,
        uint256 _prePaymentPeriods,
        uint256 _resumePrePaidPeriods,
        uint16 _latePaymentPenaltyPct,
        uint16 _governorSharePct
    )
        CourtSubscriptions(
            _controller,
            _periodDuration,
            _feeToken,
            _feeAmount,
            _prePaymentPeriods,
            _resumePrePaidPeriods,
            _latePaymentPenaltyPct,
            _governorSharePct
        )
        public
    {}

    function mockUpToDate(bool _upToDate) external {
        upToDate = _upToDate;
    }

    function isUpToDate(address) external view returns (bool) {
        return upToDate;
    }
}
