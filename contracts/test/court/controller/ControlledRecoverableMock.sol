pragma solidity ^0.5.8;

import "../../../court/controller/Controller.sol";
import "../../../court/controller/ControlledRecoverable.sol";


contract ControlledRecoverableMock is ControlledRecoverable {
    constructor(Controller _controller) ControlledRecoverable(_controller) public {}
}
