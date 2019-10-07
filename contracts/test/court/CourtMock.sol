pragma solidity ^0.5.8;

import "../../court/Court.sol";
import "../lib/TimeHelpersMock.sol";


contract CourtMock is Court, TimeHelpersMock {
    constructor(
        uint64 _termDuration,
        ERC20[2] memory _tokens,
        IJurorsRegistry _jurorsRegistry,
        IAccounting _accounting,
        ICRVoting _voting,
        ISubscriptions _subscriptions,
        uint256[4] memory _fees, // _jurorFee, _heartbeatFee, _draftFee, _settleFee
        address _governor,
        uint64 _firstTermStartTime,
        uint256 _jurorMinStake,
        uint64[4] memory _roundStateDurations,
        uint16[2] memory _pcts,
        uint64[3] memory _roundParams, // _firstRoundJurorsNumber, _appealStepFactor, _maxRegularAppealRounds
        uint256[2] memory _appealCollateralParams, // _appealCollateralFactor, _appealConfirmCollateralFactor
        uint256[5] memory _subscriptionParams // _periodDuration, _feeAmount, _prePaymentPeriods, _latePaymentPenaltyPct, _governorSharePct
    )
        Court(
            _termDuration,
            _tokens,
            _jurorsRegistry,
            _accounting,
            _voting,
            _subscriptions,
            _fees,
            _governor,
            _firstTermStartTime,
            _jurorMinStake,
            _roundStateDurations,
            _pcts,
            _roundParams,
            _appealCollateralParams,
            _subscriptionParams
        )
        public
    {}

    function collect(address _juror, uint256 _amount) external {
        jurorsRegistry.collectTokens(_juror, _amount, termId);
    }
}
