pragma solidity ^0.5.8;

import "../../subscriptions/TransactionFeesOracle.sol";


contract TransactionFeesOracleMock is TransactionFeesOracle {
    constructor(Controller _controller) TransactionFeesOracle(_controller) public {
        // solium-disable-previous-line no-empty-blocks
    }

    function getEthTokenConstant() external pure returns (address) {
        return ETH;
    }
}
