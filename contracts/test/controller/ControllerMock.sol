pragma solidity ^0.5.8;

import "../../controller/Controller.sol";


contract ControllerMock is Controller {
    constructor() Controller(msg.sender, msg.sender, msg.sender) public {}

    function setCourt(address _addr) external {
        _setModule(COURT, _addr);
    }

    function setCourtMock(address _addr) external {
        // This function allows setting any address as the court module
        modules[COURT] = _addr;
        emit ModuleSet(COURT, _addr);
    }

    function setClock(address _addr) external {
        _setModule(CLOCK, _addr);
    }

    function setAccounting(address _addr) external {
        _setModule(ACCOUNTING, _addr);
    }

    function setVoting(address _addr) external {
        _setModule(VOTING, _addr);
    }

    function setJurorsRegistry(address _addr) external {
        _setModule(JURORS_REGISTRY, _addr);
    }

    function setSubscriptions(address _addr) external {
        _setModule(SUBSCRIPTIONS, _addr);
    }
}
