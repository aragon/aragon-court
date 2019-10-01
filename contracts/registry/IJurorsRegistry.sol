pragma solidity ^0.5.8;

import "@aragon/os/contracts/lib/token/ERC20.sol";

import "./IJurorsRegistryOwner.sol";


interface IJurorsRegistry {
    function burnTokens(uint256 _amount) external;
    function assignTokens(address _to, uint256 _amount) external;
    function draft(uint256[7] calldata _draftParams) external returns (address[] memory jurors, uint64[] memory weights, uint256 outputLength);
    function slashOrUnlock(uint64 _termId, address[] calldata _jurors, uint256[] calldata _penalties, bool[] calldata _rewardedJurors) external
        returns (uint256 collectedTokens);
    function collectTokens(address _juror, uint256 _amount, uint64 _termId) external returns (bool);
    function minJurorsActiveBalance() external view returns (uint256);
    function activeBalanceOfAt(address _juror, uint64 _termId) external view returns (uint256);
    function totalActiveBalanceAt(uint64 _termId) external view returns (uint256);
}
