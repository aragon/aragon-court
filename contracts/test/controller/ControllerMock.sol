pragma solidity ^0.5.8;

import "../../controller/Controller.sol";


contract ControllerMock is Controller {
    constructor() Controller(msg.sender) public {}

    function setAccounting(address _owner, address _implementation) external {
        _setImplementation(ACCOUNTING, _owner, _implementation);
    }

    function setVoting(address _owner, address _implementation) external {
        _setImplementation(CR_VOTING, _owner, _implementation);
    }

    function setJurorsRegistry(address _owner, address _implementation) external {
        _setImplementation(JURORS_REGISTRY, _owner, _implementation);
    }

    function setSubscriptions(address _owner, address _implementation) external {
        _setImplementation(SUBSCRIPTIONS, _owner, _implementation);
    }
}
