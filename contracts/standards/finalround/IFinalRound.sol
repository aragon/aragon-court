pragma solidity ^0.4.24;

import "../erc900/IStaking.sol";
import "../voting/ICRVoting.sol";


interface IFinalRound {
    function init(address _owner, ICRVoting _voting, IStaking _staking, uint16 _finalRoundReduction, uint256 _maxRegularAppealRounds) external;
    function createRound(uint256 _disputeId, uint64 _draftTermId, address _triggeredby, uint64 _termId, ERC20 _feeToken, uint256 _heartbeatFee, uint256 _jurorFee, uint16 _penaltyPct, uint64 _commitTerms, uint64 _revealTerms) external returns (uint64 appealJurorNumber);
    function settleFinalRoundSlashing(uint256 _disputeId, uint64 _termId) external returns (uint256 collectedTokens);
    function canCommitFinalRound(uint256 _disputeId, address _voter, uint64 _termId) external returns (uint256 weight);
    function canRevealFinalRound(uint256 _disputeId, address _voter, uint64 _termId) external view returns (uint256 weight);
    function getAppealDetails(uint64 _termId, uint256 _heartbeatFee, uint256 _jurorFee) external view returns (uint64 appealJurorNumber, uint256 feeAmount);
    function isFinalRoundEnded(uint256 _disputeId, uint64 _termId) external view returns (bool);
}
