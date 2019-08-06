pragma solidity ^0.4.24;

import "@aragon/os/contracts/lib/token/ERC20.sol";

import "../standards/subscription/ISubscriptionsOwner.sol";
import "../standards/subscription/ISubscriptions.sol";
import "../standards/erc900/IJurorsRegistryOwner.sol";


contract SubscriptionsOwnerMock is ISubscriptionsOwner, IJurorsRegistryOwner {
    ISubscriptions internal subscription;

    uint64 termId;

    constructor(ISubscriptions _subscription) public {
        subscription = _subscription;
    }

    function setFeeAmount(uint256 _feeAmount) external {
        subscription.setFeeAmount(_feeAmount);
    }

    function setFeeToken(ERC20 _feeToken, uint256 _feeAmount) external {
        subscription.setFeeToken(_feeToken, _feeAmount);
    }

    function setPrePaymentPeriods(uint256 _prePaymentPeriods) external {
        subscription.setPrePaymentPeriods(_prePaymentPeriods);
    }

    function setLatePaymentPenaltyPct(uint16 _latePaymentPenaltyPct) external {
        subscription.setLatePaymentPenaltyPct(_latePaymentPenaltyPct);
    }

    function setGovernorSharePct(uint16 _governorSharePct) external {
        subscription.setGovernorSharePct(_governorSharePct);
    }

    function setCurrentTermId(uint64 _termId) external {
        termId = _termId;
    }

    function addToCurrentTermId(uint64 _terms) external {
        termId += _terms;
    }

    function getCurrentTermId() external view returns (uint64) {
        return termId;
    }

    function getLastEnsuredTermId() external view returns (uint64) {
        return termId;
    }

    function ensureAndGetTermId() external returns (uint64) {
        return termId;
    }

    function getTermRandomness(uint64) external view returns (bytes32) {
        return keccak256("randomness");
    }

    function getGovernor() external view returns (address) {
        return address(this);
    }
}
