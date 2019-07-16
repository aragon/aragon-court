pragma solidity ^0.4.24;

import "@aragon/os/contracts/lib/token/ERC20.sol";

import "../sumtree/ISumTree.sol";
import "./IStakingOwner.sol";


interface IStaking {
    function init(IStakingOwner _owner, address _finalRounds, ISumTree _sumTree, ERC20 _jurorToken, uint256 _jurorMinStake) external;
    function activate() external;
    function deactivate() external;
    function draft(uint256[7] _draftParams) external returns (address[] jurors, uint64[] weights, uint256 jurorsLength, uint64 filledSeats);
    function slash(uint64 _termId, address[] _jurors, uint256[] _penalties, uint8[] _castVotes, uint8 _winningRuling) external returns (uint256 collectedTokens);
    function withdraw(ERC20 _token, uint256 _amount) external;
    function assignTokens(ERC20 _token, address _to, uint256 _amount) external;
    function assignJurorTokens(address _to, uint256 _amount) external;
    function removeTokens(ERC20 _token, address _from, uint256 _amount) external;
    function burnJurorTokens(uint256 _amount) external;
    function canCommitFinalRound(address _juror, uint64 _roundTermId, uint64 _currentTermId, uint256 _precision, uint16 _penaltyPct) external returns (uint256 weight, uint256 weightedPenalty);
    function getAccountPastTreeStake(address _juror, uint64 _termId) external view returns (uint256);
    function getAccountSumTreeId(address _juror) external view returns (uint256);
    function getFinalRoundJurorNumber(uint64 _termId, uint256 _precision) external view returns (uint256);
}
