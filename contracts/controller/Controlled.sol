pragma solidity ^0.5.8;

import "./Controller.sol";
import "../court/IAccounting.sol";
import "../voting/ICRVoting.sol";
import "../registry/IJurorsRegistry.sol";
import "../subscriptions/ISubscriptions.sol";
import "@aragon/os/contracts/common/IsContract.sol";


contract Controlled is IsContract {
    string private constant ERROR_SENDER_NOT_GOVERNOR = "CTD_SENDER_NOT_GOVERNOR";
    string private constant ERROR_CONTROLLER_NOT_CONTRACT = "CTD_CONTROLLER_NOT_CONTRACT";

    // Address of the controller
    Controller internal controller;

    /**
    * @dev Ensure the msg.sender is the controller's governor
    */
    modifier onlyGovernor {
        require(msg.sender == _governor(), ERROR_SENDER_NOT_GOVERNOR);
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
    * @dev Internal function to fetch the controller's governor
    * @return Address of the controller's governor
    */
    function _governor() internal view returns (address) {
        return controller.getGovernor();
    }

    /**
    * @dev Internal function to fetch the address of the Accounting module implementation from the controller
    * @return Address of the Accounting module implementation
    */
    function _accounting() internal view returns (IAccounting) {
        return IAccounting(controller.getAccounting());
    }

    /**
    * @dev Internal function to fetch the address of the Accounting module owner from the controller
    * @return Address of the Accounting module owner
    */
    function _accountingOwner() internal view returns (address) {
        return _court();
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
    * @dev Internal function to fetch the address of the JurorRegistry module owner from the controller
    * @return Address of the JurorRegistry module owner
    */
    function _jurorsRegistryOwner() internal view returns (IJurorsRegistryOwner) {
        return IJurorsRegistryOwner(_court());
    }

    /**
    * @dev Internal function to fetch the address of the Subscriptions module implementation from the controller
    * @return Address of the Subscriptions module implementation
    */
    function _subscriptions() internal view returns (ISubscriptions) {
        return ISubscriptions(controller.getSubscriptions());
    }

    /**
    * @dev Internal function to fetch the address of the Subscriptions module owner from the controller
    * @return Address of the Subscriptions module owner
    */
    function _subscriptionsOwner() internal view returns (ISubscriptionsOwner) {
        return ISubscriptionsOwner(_court());
    }

    /**
    * @dev Internal function to fetch the address of the Court module from the controller
    * @return Address of the Court module owner
    */
    function _court() internal view returns (address) {
        return controller.getCourt();
    }
}
