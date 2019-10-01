pragma solidity ^0.5.8;

import "../../controller/Controlled.sol";


contract ControlledMock is Controlled {
    event OnlyGovernorCalled();

    constructor(Controller _controller) Controlled(_controller) public {}

    function onlyGovernorFn() external onlyGovernor {
        emit OnlyGovernorCalled();
    }
}
