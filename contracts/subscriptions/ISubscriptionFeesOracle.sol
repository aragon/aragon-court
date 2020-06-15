pragma solidity ^0.5.8;

import "../lib/os/ERC20.sol";


interface ISubscriptionFeesOracle {
    function setFee(bytes32 appId, ERC20 token, uint256 amount) external;
    function getFee(bytes32 appId) external view returns (ERC20, uint256);
}
