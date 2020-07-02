pragma solidity ^0.5.8;

import "../lib/os/ERC20.sol";


interface IAragonAppFeesCashier {
    event AppFeeSet(bytes32 indexed appId, ERC20 token, uint256 amount);
    event AppFeeUnset(bytes32 indexed appId);
    event AppFeePaid(address indexed by, bytes32 appId, uint256 actionId);

    function setAppFee(bytes32 _appId, ERC20 _token, uint256 _amount) external;
    function setAppFees(bytes32[] calldata _appIds, ERC20[] calldata _tokens, uint256[] calldata _amounts) external;
    function unsetAppFee(bytes32 _appId) external;
    function unsetAppFees(bytes32[] calldata _appIds) external;
    function payAppFees(bytes32 _appId, uint256 _actionId) external;
    function getAppFee(bytes32 _appId) external view returns (ERC20, uint256);
}
