pragma solidity ^0.5.8;

import "../court/AragonCourt.sol";
import "./IPriceOracle.sol";
import "../lib/os/ERC20.sol";

contract FeesUpdater {

    IPriceOracle public priceOracle;
    AragonCourt public court;
    address public courtFeeToken;
    address public courtStableToken;
    uint256[3] public courtStableValueFees;

    constructor(
        IPriceOracle _priceOracle,
        AragonCourt _court,
        address _courtFeeToken,
        address _courtStableToken,
        uint256[3] memory _courtStableValueFees
    ) public {
        priceOracle = _priceOracle;
        court = _court;
        courtFeeToken = _courtFeeToken;
        courtStableToken = _courtStableToken;
        courtStableValueFees = _courtStableValueFees;
    }

    function getStableFees() external view returns (uint256[3] memory) {
        return courtStableValueFees;
    }

    /**
    * @notice Convert the court fees from their stable value to the fee token value and update the court config from the
    *   next term with them. This function can be called any number of times during a court term, the closer to the
    *   start of the following term the more accurate the configured fees will be.
    */
    function updateCourtFees() external {
        uint64 currentTerm = court.ensureCurrentTerm();

        // We use the latest possible term to ensure that if the config has been updated by an account other
        // than this oracle, the config fetched will be the updated one. However, this does mean that a config update
        // that is scheduled for a future term will be scheduled for the next term instead.
        uint64 latestPossibleTerm = uint64(-1);
        (ERC20 feeToken,,
        uint64[5] memory roundStateDurations,
        uint16[2] memory pcts,
        uint64[4] memory roundParams,
        uint256[2] memory appealCollateralParams,
        uint256[3] memory jurorsParams
        ) = court.getConfig(latestPossibleTerm);

        uint256[3] memory convertedFees;
        convertedFees[0] = priceOracle.consult(courtStableToken, courtStableValueFees[0], courtFeeToken);
        convertedFees[1] = priceOracle.consult(courtStableToken, courtStableValueFees[1], courtFeeToken);
        convertedFees[2] = priceOracle.consult(courtStableToken, courtStableValueFees[2], courtFeeToken);

        court.setConfig(currentTerm + 1, feeToken, convertedFees, roundStateDurations, pcts, roundParams,
            appealCollateralParams, jurorsParams);
    }
}
