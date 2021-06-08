pragma solidity ^0.5.8;

import "@openzeppelin/contracts/ownership/Ownable.sol";
import "../court/AragonCourt.sol";
import "./CourtSubscriptions.sol";
import "../registry/JurorsRegistry.sol";
import "../lib/PctHelpers.sol";
import "../lib/os/SafeERC20.sol";
import "../lib/os/ERC20.sol";

contract DonatedFeesDrip is Ownable {
    using PctHelpers for uint256;
    using SafeERC20 for ERC20;

    AragonCourt public arbitrator;
    uint256 public previousDripPeriodId;
    uint256 public periodPercentageYield;

    /**
    * @param _arbitrator The AragonCourt/Celeste instance
    * @param _periodPercentageYield The period yield where 100% == 1e18
    */
    constructor (AragonCourt _arbitrator, uint256 _periodPercentageYield) public {
        arbitrator = _arbitrator;
        periodPercentageYield = _periodPercentageYield;
    }

    function dripFees() external {
        CourtSubscriptions courtSubscriptions = CourtSubscriptions(arbitrator.getSubscriptions());
        uint256 currentPeriodId = courtSubscriptions.getCurrentPeriodId();
        require(currentPeriodId > previousDripPeriodId, "ERROR: Not new period");
        previousDripPeriodId = currentPeriodId;

        JurorsRegistry jurorsRegistry = JurorsRegistry(arbitrator.getJurorsRegistry());
        uint256 donatedFeeAmount = jurorsRegistry.totalStaked().pctHighPrecision(periodPercentageYield);
        ERC20 feeToken = courtSubscriptions.currentFeeToken();
        require(feeToken.safeTransfer(address(courtSubscriptions), donatedFeeAmount), "ERROR: Not enough funds");
    }

    function reclaimFunds(ERC20 _token, address _receiver) external onlyOwner {
        uint256 fundsToReturn = _token.balanceOf(address(this));
        require(_token.safeTransfer(_receiver, fundsToReturn), "ERROR: Not enough funds");
    }

    function updatePeriodPercentageYield(uint256 _periodPercentageYield) external onlyOwner {
        periodPercentageYield = _periodPercentageYield;
    }
}

