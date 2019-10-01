pragma solidity ^0.5.8;

import "./Controller.sol";
import "@aragon/os/contracts/common/IsContract.sol";


contract Controlled is IsContract {
    string private constant ERROR_SENDER_NOT_GOVERNOR = "CTD_SENDER_NOT_GOVERNOR";
    string private constant ERROR_CONTROLLER_NOT_CONTRACT = "CTD_CONTROLLER_NOT_CONTRACT";

    Controller internal controller;

    modifier onlyGovernor {
        require(msg.sender == _governor(), ERROR_SENDER_NOT_GOVERNOR);
        _;
    }

    constructor(Controller _controller) public {
        require(isContract(address(_controller)), ERROR_CONTROLLER_NOT_CONTRACT);
        controller = _controller;
    }

    function getController() external view returns (Controller) {
        return controller;
    }

    function _governor() internal view returns (address) {
        return controller.getGovernor();
    }

    function _accounting() internal view returns (IAccounting) {
        return controller.getAccounting();
    }

    function _accountingOwner() internal view returns (address) {
        return controller.getAccountingOwner();
    }

    function _voting() internal view returns (ICRVoting) {
        return controller.getCRVoting();
    }

    function _votingOwner() internal view returns (ICRVotingOwner) {
        return controller.getCRVotingOwner();
    }

    function _jurorsRegistry() internal view returns (IJurorsRegistry) {
        return controller.getJurorsRegistry();
    }

    function _jurorsRegistryOwner() internal view returns (IJurorsRegistryOwner) {
        return controller.getJurorsRegistryOwner();
    }

    function _subscriptions() internal view returns (ISubscriptions) {
        return controller.getSubscriptions();
    }

    function _subscriptionsOwner() internal view returns (ISubscriptionsOwner) {
        return controller.getSubscriptionsOwner();
    }
}
