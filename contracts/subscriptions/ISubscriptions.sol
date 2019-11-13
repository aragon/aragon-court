pragma solidity ^0.5.8;

import "../lib/os/ERC20.sol";


interface ISubscriptions {
    /**
    * @dev Tell whether a certain subscriber has paid all the fees up to current period or not
    * @param _subscriber Address of subscriber being checked
    * @return True if subscriber has paid all the fees up to current period, false otherwise
    */
    function isUpToDate(address _subscriber) external view returns (bool);

    /**
    * @dev Tell the minimum amount of fees to pay and resulting last paid period for a given subscriber in order to be up-to-date
    * @param _subscriber Address of the subscriber willing to pay
    * @return feeToken ERC20 token used for the subscription fees
    * @return amountToPay Amount of subscription fee tokens to be paid
    * @return newLastPeriodId Identification number of the resulting last paid period
    */
    function getOwedFeesDetails(address _subscriber) external view returns (ERC20, uint256, uint256);
}
