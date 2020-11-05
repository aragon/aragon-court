pragma solidity ^0.5.8;

import "../../feesUpdater/IPriceOracle.sol";

contract MockPriceOracle is IPriceOracle {

    uint256 public feeTokenPriceInStableToken;

    constructor(uint256 _feeTokenPriceInStableToken) public {
        feeTokenPriceInStableToken = _feeTokenPriceInStableToken;
    }

    function consult(address tokenIn, uint256 amountIn, address tokenOut) external view returns (uint256 amountOut) {
        return amountIn / feeTokenPriceInStableToken;
    }
}
