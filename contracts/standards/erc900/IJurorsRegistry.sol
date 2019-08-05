pragma solidity ^0.4.24;

import "./IJurorsRegistryOwner.sol";
import "@aragon/os/contracts/lib/token/ERC20.sol";


interface IJurorsRegistry {
    function init(IJurorsRegistryOwner _owner, ERC20 _jurorToken, uint256 _jurorMinStake) external;
    function activate(uint256 _amount) external;
    function deactivate(uint256 _amount) external;
    function draft(uint256[7] _draftParams) external returns (address[] jurors, uint64[] weights, uint256 jurorsLength, uint64 filledSeats);
    function slash(uint64 _termId, address[] _jurors, uint256[] _penalties, uint8[] _castVotes, uint8 _winningRuling) external returns (uint256 collectedTokens);
    function burnTokens(uint256 _amount) external;
    function assignTokens(address _to, uint256 _amount) external;
    function collectTokens(address _juror, uint256 _amount, uint64 _termId) external returns (bool);

    function minJurorsActiveBalance() external view returns (uint256);
    function getJurorId(address _juror) external view returns (uint256);
    function activeBalanceOfAt(address _juror, uint64 _termId) external view returns (uint256);
    function totalActiveBalanceAt(uint64 _termId) external view returns (uint256);
    function getLastTotalActiveBalanceFrom(uint64 _termId) external view returns (uint256);
}
