pragma solidity ^0.5.8;

import "@aragon/os/contracts/lib/token/ERC20.sol";

import "./ISubscriptionsOwner.sol";
import "../registry/IJurorsRegistry.sol";


interface ISubscriptions {
    function init(
        ISubscriptionsOwner _owner,
        IJurorsRegistry _jurorsRegistry,
        uint64 _periodDuration,
        ERC20 _feeToken,
        uint256 _feeAmount,
        uint256 _prePaymentPeriods,
        uint256 _resumePrePaidPeriods,
        uint16 _latePaymentPenaltyPct,
        uint16 _governorSharePct
    ) external;
    function setFeeAmount(uint256 _feeAmount) external;
    function setFeeToken(ERC20 _feeToken, uint256 _feeAmount) external;
    function setPrePaymentPeriods(uint256 _prePaymentPeriods) external;
    function setLatePaymentPenaltyPct(uint16 _latePaymentPenaltyPct) external;
    function setGovernorSharePct(uint16 _governorSharePct) external;
    function setResumePrePaidPeriods(uint256 _resumePrePaidPeriods) external;
    function isUpToDate(address _subscriber) external view returns (bool);
}
