pragma solidity ^0.5.8;

import "../../subscriptions/SubscriptionFeesOracle.sol";


contract SubscriptionFeesOracleMock is SubscriptionFeesOracle {
    constructor(Controller _controller) SubscriptionFeesOracle(_controller) public {
        // solium-disable-previous-line no-empty-blocks
    }

    function getEthTokenConstant() external pure returns (address) {
        return ETH;
    }
}
