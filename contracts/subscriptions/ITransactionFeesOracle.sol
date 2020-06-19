pragma solidity ^0.5.8;

import "../lib/os/ERC20.sol";


interface ITransactionFeesOracle {
    function setFee(bytes32 appId, ERC20 token, uint256 amount) external;
    function setFees(bytes32[] calldata _appIds, ERC20[] calldata _tokens, uint256[] calldata _amounts) external;
    function unsetFee(bytes32 _appId) external;
    function unsetFees(bytes32[] calldata _appIds) external;
    function getFee(bytes32 appId) external view returns (ERC20, uint256, address);
}
