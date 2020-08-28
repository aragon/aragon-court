pragma solidity ^0.5.8;

import "../../subscriptions/CourtSubscriptions.sol";


contract SubscriptionsMock is CourtSubscriptions {

    constructor(Controller _controller, uint64 _periodDuration, ERC20 _feeToken)
        CourtSubscriptions(_controller, _periodDuration, _feeToken) public
    {

    }
}
