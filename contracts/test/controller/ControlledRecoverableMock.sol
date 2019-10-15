pragma solidity ^0.5.8;

import "../../controller/ControlledRecoverable.sol";


contract ControlledRecoverableMock is ControlledRecoverable {
    constructor(Controller _controller) ControlledRecoverable(_controller) public {}
}
