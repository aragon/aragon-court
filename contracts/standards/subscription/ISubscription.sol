pragma solidity ^0.4.24; // TODO: pin solc

import "@aragon/os/contracts/lib/token/ERC20.sol";


interface ISubscription {
    function setFeeAmount(uint256 _feeAmount) external;
    function setFeeToken(ERC20 _feeToken, uint256 _feeAmount) external;
    function setPrePaymentPeriods(uint256 _prePaymentPeriods) external;
    function setLatePaymentPenaltyPct(uint16 _latePaymentPenaltyPct) external;
    function setGovernorSharePct(uint16 _governorSharePct) external;
}
