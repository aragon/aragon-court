pragma solidity ^0.4.24;

import "@aragon/os/contracts/lib/token/ERC20.sol";

import "../sumtree/ISumTree.sol";
import "./IStakingOwner.sol";


interface IStaking {
    function init(IStakingOwner _owner, ISumTree _sumTree, ERC20 _jurorToken, uint256 _jurorMinStake) external;
    function activate() external;
    function deactivate() external;
    function draft(uint256[7] _draftParams) external returns (address[] jurors, uint64[] weights, uint256 jurorsLength, uint64 filledSeats);
    function slash(uint64 _termId, address[] _jurors, uint256[] _penalties, uint8[] _castVotes, uint8 _winningRuling) external returns (uint256 collectedTokens);
    function burnTokens(uint256 _amount) external;
    function assignTokens(address _to, uint256 _amount) external;
    function collectTokens(uint64 _termId, address _juror, uint256 _amount) external returns (bool);
    function getAccountSumTreeId(address _juror) external view returns (uint256);
    function getAccountPastTreeStake(address _juror, uint64 _termId) external returns (uint256);
}
