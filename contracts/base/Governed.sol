pragma solidity ^0.5.8;


contract Governed {
    string private constant ERROR_SENDER_NOT_GOVERNOR = "GVD_SENDER_NOT_GOVERNOR";
    string private constant ERROR_INVALID_GOVERNOR_ADDRESS = "GVD_INVALID_GOVERNOR_ADDRESS";

    address private constant NO_GOVERNOR = address(0);

    address private governor;

    event GovernorChanged(address previousGovernor, address currentGovernor);

    modifier onlyGovernor {
        require(msg.sender == governor, ERROR_SENDER_NOT_GOVERNOR);
        _;
    }

    constructor (address _governor) public {
        governor = _governor;
    }

    function changeGovernor(address _newGovernor) external onlyGovernor {
        require(_newGovernor != NO_GOVERNOR, ERROR_INVALID_GOVERNOR_ADDRESS);
        _setGovernor(_newGovernor);
    }

    function eject() external onlyGovernor {
        _setGovernor(NO_GOVERNOR);
    }

    function getGovernor() external returns (address) {
        return governor;
    }

    function _setGovernor(address _newGovernor) private {
        emit GovernorChanged(governor, _newGovernor);
        governor = _newGovernor;
    }
}
