pragma solidity ^0.5.8;

contract IPriceOracle {
    function consult(address tokenIn, uint256 amountIn, address tokenOut) external view returns (uint256 amountOut);
}
