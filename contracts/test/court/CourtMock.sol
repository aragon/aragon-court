pragma solidity ^0.5.8;

import "../../court/Court.sol";
import "../lib/TimeHelpersMock.sol";


contract CourtMock is Court, TimeHelpersMock {
    constructor(
        Controller _controller,
        uint64 _termDuration,
        uint64 _firstTermStartTime,
        uint64 _maxJurorsToBeDraftedPerBatch,
        ERC20 _feeToken,
        uint256[4] memory _fees,                    // jurorFee, heartbeatFee, draftFee, settleFee
        uint64[4] memory _roundStateDurations,      // commitTerms, revealTerms, appealTerms, appealConfirmationTerms
        uint16[2] memory _pcts,                     // penaltyPct, finalRoundReduction
        uint64[3] memory _roundParams,              // firstRoundJurorsNumber, appealStepFactor, maxRegularAppealRounds
        uint256[2] memory _appealCollateralParams   // appealCollateralFactor, appealConfirmCollateralFactor
    )
        public
        Court(
            _controller,
            _termDuration,
            _firstTermStartTime,
            _maxJurorsToBeDraftedPerBatch,
            _feeToken,
            _fees,
            _roundStateDurations,
            _pcts,
            _roundParams,
            _appealCollateralParams
        )
    {}

    function collect(address _juror, uint256 _amount) external {
        IJurorsRegistry jurorsRegistry = _jurorsRegistry();
        jurorsRegistry.collectTokens(_juror, _amount, termId);
    }
}
