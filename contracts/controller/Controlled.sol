pragma solidity ^0.5.8;

import "@aragon/os/contracts/common/IsContract.sol";

import "./Controller.sol";
import "../court/IClock.sol";
import "../voting/ICRVoting.sol";
import "../accounting/IAccounting.sol";
import "../registry/IJurorsRegistry.sol";
import "../subscriptions/ISubscriptions.sol";


contract Controlled is IsContract {
    string private constant ERROR_CONTROLLER_NOT_CONTRACT = "CTD_CONTROLLER_NOT_CONTRACT";
    string private constant ERROR_SENDER_NOT_COURT_MODULE = "CTD_SENDER_NOT_COURT_MODULE";
    string private constant ERROR_SENDER_NOT_CONFIG_GOVERNOR = "CTD_SENDER_NOT_CONFIG_GOVERNOR";

    // Address of the controller
    Controller internal controller;

    /**
    * @dev Ensure the msg.sender is the court module
    */
    modifier onlyCourt() {
        require(msg.sender == _court(), ERROR_SENDER_NOT_COURT_MODULE);
        _;
    }

    /**
    * @dev Ensure the msg.sender is the controller's config governor
    */
    modifier onlyConfigGovernor {
        require(msg.sender == _configGovernor(), ERROR_SENDER_NOT_CONFIG_GOVERNOR);
        _;
    }

    /**
    * @dev Constructor function
    * @param _controller Address of the controller
    */
    constructor(Controller _controller) public {
        require(isContract(address(_controller)), ERROR_CONTROLLER_NOT_CONTRACT);
        controller = _controller;
    }

    /**
    * @dev Tell the address of the controller
    * @return Address of the controller
    */
    function getController() external view returns (Controller) {
        return controller;
    }

    /**
    * @dev Internal function to ensure the current term of the Court
    * @return Identification number of the last ensured term
    */
    function _ensureTermId() internal returns (uint64) {
        return _clock().ensureTermId();
    }

    /**
    * @dev Internal function to fetch the last ensured term id of the Court
    * @return Identification number of the last ensured term
    */
    function _getLastEnsuredTermId() internal view returns (uint64) {
        return _clock().getLastEnsuredTermId();
    }

    /**
    * @dev Internal function to tell the current term identification number
    * @return Identification number of the current term
    */
    function _getCurrentTermId() internal view returns (uint64) {
        return _clock().getCurrentTermId();
    }

    /**
    * @dev Internal function to tell the number of terms the Court should transition to be up-to-date
    * @return Number of terms the Court should transition to be up-to-date
    */
    function _getNeededTermTransitions() internal view returns (uint64) {
        return _clock().getNeededTermTransitions();
    }

    /**
    * @dev Internal function to fetch the controller's config governor
    * @return Address of the controller's governor
    */
    function _configGovernor() internal view returns (address) {
        return controller.getConfigGovernor();
    }

    /**
    * @dev Internal function to fetch the address of the Accounting module implementation from the controller
    * @return Address of the Accounting module implementation
    */
    function _accounting() internal view returns (IAccounting) {
        return IAccounting(controller.getAccounting());
    }

    /**
    * @dev Internal function to fetch the address of the Voting module implementation from the controller
    * @return Address of the Voting module implementation
    */
    function _voting() internal view returns (ICRVoting) {
        return ICRVoting(controller.getVoting());
    }

    /**
    * @dev Internal function to fetch the address of the Voting module owner from the controller
    * @return Address of the Voting module owner
    */
    function _votingOwner() internal view returns (ICRVotingOwner) {
        return ICRVotingOwner(_court());
    }

    /**
    * @dev Internal function to fetch the address of the JurorRegistry module implementation from the controller
    * @return Address of the JurorRegistry module implementation
    */
    function _jurorsRegistry() internal view returns (IJurorsRegistry) {
        return IJurorsRegistry(controller.getJurorsRegistry());
    }

    /**
    * @dev Internal function to fetch the address of the Subscriptions module implementation from the controller
    * @return Address of the Subscriptions module implementation
    */
    function _subscriptions() internal view returns (ISubscriptions) {
        return ISubscriptions(controller.getSubscriptions());
    }

    /**
    * @dev Internal function to fetch the address of the Clock module from the controller
    * @return Address of the Clock module
    */
    function _clock() internal view returns (IClock) {
        return IClock(controller.getClock());
    }

    /**
    * @dev Internal function to fetch the address of the Court module from the controller
    * @return Address of the Court module
    */
    function _court() internal view returns (address) {
        return controller.getCourt();
    }
}
