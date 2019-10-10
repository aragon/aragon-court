pragma solidity ^0.5.8;

import "@aragon/os/contracts/common/IsContract.sol";


contract Controller is IsContract {
    string private constant ERROR_SENDER_NOT_GOVERNOR = "CTR_SENDER_NOT_GOVERNOR";
    string private constant ERROR_INVALID_GOVERNOR_ADDRESS = "CTR_INVALID_GOVERNOR_ADDRESS";
    string private constant ERROR_ZERO_IMPLEMENTATION_OWNER = "CTR_ZERO_MODULE_OWNER";
    string private constant ERROR_IMPLEMENTATION_NOT_CONTRACT = "CTR_IMPLEMENTATION_NOT_CONTRACT";
    string private constant ERROR_INVALID_IMPLS_INPUT_LENGTH = "CTR_INVALID_IMPLS_INPUT_LENGTH";

    address private constant ZERO_ADDRESS = address(0);

    // Court module ID - keccak256(abi.encodePacked("COURT"))
    bytes32 internal constant COURT = 0x26f3b895987e349a46d6d91132234924c6d45cfdc564b33427f53e3f9284955c;

    // Accounting module ID - keccak256(abi.encodePacked("ACCOUNTING"))
    bytes32 internal constant ACCOUNTING = 0x3ec26b85a7d49ed13a920deeaceb063fa458eb25266fa7b504696047900a5b0f;

    // Voting module ID - keccak256(abi.encodePacked("VOTING"))
    bytes32 internal constant VOTING = 0x7cbb12e82a6d63ff16fe43977f43e3e2b247ecd4e62c0e340da8800a48c67346;

    // JurorsRegistry module ID - keccak256(abi.encodePacked("JURORS_REGISTRY"))
    bytes32 internal constant JURORS_REGISTRY = 0x3b21d36b36308c830e6c4053fb40a3b6d79dde78947fbf6b0accd30720ab5370;

    // Subscriptions module ID - keccak256(abi.encodePacked("SUBSCRIPTIONS"))
    bytes32 internal constant SUBSCRIPTIONS = 0x2bfa3327fe52344390da94c32a346eeb1b65a8b583e4335a419b9471e88c1365;

    // Governor of the whole system. This address can be unset at any time. While set, this address is the only one allowed
    // to plug/unplug system modules. Some modules are also ERC20-funds recoverable, which can only be executed by the governor.
    address private governor;

    // List of modules registered for the system indexed by ID
    mapping (bytes32 => address) private modules;

    event ModuleSet(bytes32 id, address addr);
    event GovernorChanged(address previousGovernor, address currentGovernor);

    /**
    * @dev Ensure the msg.sender is the controller's governor
    */
    modifier onlyGovernor {
        require(msg.sender == governor, ERROR_SENDER_NOT_GOVERNOR);
        _;
    }

    /**
    * @dev Constructor function
    * @param _governor Address of the governor
    */
    constructor(address _governor) public {
        _setGovernor(_governor);
    }

    /**
    * @notice Change governor address to `_newGovernor`
    * @param _newGovernor Address of the new governor to be set
    */
    function changeGovernor(address _newGovernor) external onlyGovernor {
        require(_newGovernor != ZERO_ADDRESS, ERROR_INVALID_GOVERNOR_ADDRESS);
        _setGovernor(_newGovernor);
    }

    /**
    * @notice Remove the governor. Set governor to the zero address.
    * @dev This action cannot be rolled back, once the governor has been unset the system modules cannot be changed
    */
    function eject() external onlyGovernor {
        _setGovernor(ZERO_ADDRESS);
    }

    /**
    * @notice Set module `_id` to `_addr`
    * @param _id ID of the module to be set
    * @param _addr Address of the module to be set
    */
    function setModule(bytes32 _id, address _addr) external onlyGovernor {
        _setModule(_id, _addr);
    }

    /**
    * @notice Set many modules at once
    * @param _ids List of ids of each module to be set
    * @param _addresses List of addressed of each the module to be set
    */
    function setModules(bytes32[] calldata _ids, address[] calldata _addresses) external onlyGovernor {
        require(_ids.length == _addresses.length, ERROR_INVALID_IMPLS_INPUT_LENGTH);

        for (uint256 i = 0; i < _ids.length; i++) {
            _setModule(_ids[i], _addresses[i]);
        }
    }

    /**
    * @dev Tell the address of the governor
    * @return Address of the governor
    */
    function getGovernor() external view returns (address) {
        return governor;
    }

    /**
    * @dev Tell address of a module based on a given ID
    * @param _id ID of the module being queried
    * @return Address of the requested module
    */
    function getModule(bytes32 _id) external view returns (address) {
        return _getModule(_id);
    }

    /**
    * @dev Tell the address of the Accounting module
    * @return Address of the Accounting module
    */
    function getCourt() external view returns (address) {
        return _getModule(COURT);
    }

    /**
    * @dev Tell the address of the Accounting module
    * @return Address of the Accounting module
    */
    function getAccounting() external view returns (address) {
        return _getModule(ACCOUNTING);
    }

    /**
    * @dev Tell the address of the Voting module
    * @return Address of the Voting module
    */
    function getVoting() external view returns (address) {
        return _getModule(VOTING);
    }

    /**
    * @dev Tell the address of the JurorsRegistry module
    * @return Address of the JurorsRegistry module
    */
    function getJurorsRegistry() external view returns (address) {
        return _getModule(JURORS_REGISTRY);
    }

    /**
    * @dev Tell the address of the Subscriptions module
    * @return Address of the Subscriptions module
    */
    function getSubscriptions() external view returns (address) {
        return _getModule(SUBSCRIPTIONS);
    }

    /**
    * @dev Internal function to set the governor address
    * @param _newGovernor Address of the new governor to be set
    */
    function _setGovernor(address _newGovernor) internal {
        emit GovernorChanged(governor, _newGovernor);
        governor = _newGovernor;
    }

    /**
    * @dev Internal function to set a module
    * @param _id Id of the module to be set
    * @param _addr Address of the module to be set
    */
    function _setModule(bytes32 _id, address _addr) internal {
        require(isContract(_addr), ERROR_IMPLEMENTATION_NOT_CONTRACT);
        modules[_id] = _addr;
        emit ModuleSet(_id, _addr);
    }

    /**
    * @dev Internal function to tell address of a module based on a given ID
    * @param _id ID of the module being queried
    * @return Address of the requested module
    */
    function _getModule(bytes32 _id) internal view returns (address) {
        return modules[_id];
    }
}
