pragma solidity ^0.5.8;

import "../court/controller/Controller.sol";
import "../court/controller/Controlled.sol";
import "../lib/os/EtherTokenConstant.sol";

import "./ITransactionFeesOracle.sol";


contract TransactionFeesOracle is Controlled, ITransactionFeesOracle, EtherTokenConstant {
    string private constant ERROR_APP_ID_NOT_SET = "SFO_APP_NOT_SET";
    string private constant ERROR_WRONG_TOKEN = "SFO_WRONG_TOKEN";
    string private constant ERROR_COURT_HAS_NOT_STARTED = "SFO_COURT_HAS_NOT_STARTED";
    string private constant ERROR_WRONG_TOKENS_LENGTH = "SFO_WRONG_TOKENS_LENGTH";
    string private constant ERROR_WRONG_AMOUNTS_LENGTH = "SFO_WRONG_AMOUNTS_LENGTH";

    struct AppFee {
        bool set;
        ERC20 token;
        uint256 amount;
    }

    mapping (bytes32 => AppFee) internal appFees;

    /**
    * @dev Initialize court subscription fees oracle
    * @param _controller Address of the controller
    */
    constructor(Controller _controller) Controlled(_controller) public {
        // solium-disable-previous-line no-empty-blocks
    }

    /**
    * @notice Set fees for app with id `_appId` to @tokenAmount(`_token`, `_amount`)
    * @param _appId Id of the app
    * @param _token Token for the fee
    * @param _amount Amount of fee tokens
    */
    function setTransactionFee(bytes32 _appId, ERC20 _token, uint256 _amount) external onlyConfigGovernor {
        _setTransactionFee(_appId, _token, _amount);
    }

    /**
    * @notice Set fees for apps with ids `_appIds`
    * @param _appIds Id of the apps
    * @param _tokens Token for the fees for each app
    * @param _amounts Amount of fee tokens for each app
    */
    function setTransactionFees(bytes32[] calldata _appIds, ERC20[] calldata _tokens, uint256[] calldata _amounts) external onlyConfigGovernor {
        require(_appIds.length == _tokens.length, ERROR_WRONG_TOKENS_LENGTH);
        require(_appIds.length == _amounts.length, ERROR_WRONG_AMOUNTS_LENGTH);

        for (uint256 i = 0; i < _appIds.length; i++) {
            _setTransactionFee(_appIds[i], _tokens[i], _amounts[i]);
        }
    }

    /**
    * @notice Unset fees for app with id `_appId`
    * @param _appId Id of the app
    */
    function unsetTransactionFee(bytes32 _appId) external onlyConfigGovernor {
        _unsetTransactionFee(_appId);
    }

    /**
    * @notice Unset fees for apps with ids `_appIds`
    * @param _appIds Ids of the apps
    */
    function unsetTransactionFees(bytes32[] calldata _appIds) external onlyConfigGovernor {
        for (uint256 i = 0; i < _appIds.length; i++) {
            _unsetTransactionFee(_appIds[i]);
        }
    }

    // TODO: To be integrated with CourtSubscriptions with the new trusted model
    function payTransactionFees(bytes32 _appId, uint256 _actionId) external {
        emit TransactionFeePaid(msg.sender, _appId, _actionId);
    }

    /**
    * @notice Get fees for app with id `_appId`
    * @param _appId Id of the app
    * @return Token for the fees
    * @return Amount of fee tokens
    * @return Beneficiary to send the fees to
    */
    function getTransactionFee(bytes32 _appId) external view returns (ERC20 token, uint256 amount, address beneficiary) {
        AppFee storage appFee = appFees[_appId];

        require(appFee.set, ERROR_APP_ID_NOT_SET);

        return (appFee.token, appFee.amount, address(_subscriptions()));
    }

    function _setTransactionFee(bytes32 _appId, ERC20 _token, uint256 _amount) internal {
        require(address(_token) == ETH || isContract(address(_token)), ERROR_WRONG_TOKEN);

        AppFee storage appFee = appFees[_appId];

        appFee.set = true;
        appFee.token = _token;
        appFee.amount = _amount;

        emit TransactionFeeSet(_appId, _token, _amount);
    }

    function _unsetTransactionFee(bytes32 _appId) internal {
        require(appFees[_appId].set, ERROR_APP_ID_NOT_SET);

        delete appFees[_appId];

        emit TransactionFeeUnset(_appId);
    }
}
