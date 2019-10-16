pragma solidity ^0.5.8;

import "../../court/Court.sol";


contract CourtMock is Court {
    constructor(
        Controller _controller,
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
        jurorsRegistry.collectTokens(_juror, _amount, _getLastEnsuredTermId());
    }
}
