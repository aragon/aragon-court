pragma solidity ^0.5.8;

import "../court/controller/Controller.sol";
import "../court/controller/Controlled.sol";
import "../lib/os/EtherTokenConstant.sol";

import "./ISubscriptionFeesOracle.sol";


contract SubscriptionFeesOracle is Controlled, ISubscriptionFeesOracle, EtherTokenConstant {
    string private constant ERROR_APP_ID_ZERO = "SFO_APP_ID_ZERO";
    string private constant ERROR_WRONG_TOKEN = "SFO_WRONG_TOKEN";
    string private constant ERROR_COURT_HAS_NOT_STARTED = "SFO_COURT_HAS_NOT_STARTED";

    struct AppFee {
        ERC20 token;
        uint256 amount;
    }

    mapping (bytes32 => AppFee) appFees;

    /**
    * @dev Initialize court subscription fees oracle
    * @param _controller Address of the controller
    */
    constructor(Controller _controller) Controlled(_controller) public {
        // solium-disable-previous-line no-empty-blocks
    }

    function setFee(bytes32 _appId, ERC20 _token, uint256 _amount) external onlyConfigGovernor {
        require(_appId != bytes32(0), ERROR_APP_ID_ZERO);
        require(address(_token) == ETH || isContract(address(_token)), ERROR_WRONG_TOKEN);

        AppFee storage appFee = appFees[_appId];
        appFee.token = _token;
        appFee.amount = _amount;
    }

    function getFee(bytes32 _appId) external view returns (ERC20 token, uint256 amount) {
        require(_appId != bytes32(0), ERROR_APP_ID_ZERO);
        // TODO: should we check this?
        require(_getCurrentTermId() > 0, ERROR_COURT_HAS_NOT_STARTED);

        AppFee storage appFee = appFees[_appId];

        return (appFee.token, appFee.amount);
    }
}
