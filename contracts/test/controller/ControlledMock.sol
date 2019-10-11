pragma solidity ^0.5.8;

import "../../controller/Controlled.sol";


contract ControlledMock is Controlled {
    event OnlyConfigGovernorCalled();

    constructor(Controller _controller) Controlled(_controller) public {}

    function onlyConfigGovernorFn() external onlyConfigGovernor {
        emit OnlyConfigGovernorCalled();
    }
}
