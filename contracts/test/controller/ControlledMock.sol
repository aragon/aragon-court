pragma solidity ^0.5.8;

import "../../controller/Controlled.sol";


contract ControlledMock is Controlled {
    event OnlyCourtCalled();
    event OnlyConfigGovernorCalled();

    constructor(Controller _controller) Controlled(_controller) public {}

    function onlyCourtFn() external onlyCourt {
        emit OnlyCourtCalled();
    }

    function onlyConfigGovernorFn() external onlyConfigGovernor {
        emit OnlyConfigGovernorCalled();
    }
}
