pragma solidity ^0.5.8;

import "../../subscriptions/AragonAppFeesCashier.sol";


contract AragonAppFeesCashierMock is AragonAppFeesCashier {
    constructor(Controller _controller) AragonAppFeesCashier(_controller) public {
        // solium-disable-previous-line no-empty-blocks
    }

    function getEthTokenConstant() external pure returns (address) {
        return ETH;
    }
}
