pragma solidity ^0.5.8;

import "../court/IAccounting.sol";
import "../voting/ICRVoting.sol";
import "../registry/IJurorsRegistry.sol";
import "../subscriptions/ISubscriptions.sol";
import "@aragon/os/contracts/common/IsContract.sol";


contract Controller is IsContract {
    string private constant ERROR_SENDER_NOT_GOVERNOR = "CTR_SENDER_NOT_GOVERNOR";
    string private constant ERROR_INVALID_GOVERNOR_ADDRESS = "CTR_INVALID_GOVERNOR_ADDRESS";
    string private constant ERROR_ZERO_IMPLEMENTATION_OWNER = "CTR_ZERO_MODULE_OWNER";
    string private constant ERROR_IMPLEMENTATION_NOT_CONTRACT = "CTR_IMPLEMENTATION_NOT_CONTRACT";
    string private constant ERROR_INVALID_IMPLS_INPUT_LENGTH = "CTR_INVALID_IMPLS_INPUT_LENGTH";

    address private constant ZERO_ADDRESS = address(0);

    // Accounting module ID
    bytes32 internal constant ACCOUNTING = keccak256(abi.encodePacked("ACCOUNTING"));

    // Voting module ID
    bytes32 internal constant CR_VOTING = keccak256(abi.encodePacked("CR_VOTING"));

    // JurorsRegistry module ID
    bytes32 internal constant JURORS_REGISTRY = keccak256(abi.encodePacked("JURORS_REGISTRY"));

    // Subscriptions module ID
    bytes32 internal constant SUBSCRIPTIONS = keccak256(abi.encodePacked("SUBSCRIPTIONS"));

    /**
    * @dev Each system module is supposed to have an implementation address and an owner which is meant to be another module
    */
    struct Module {
        address owner;          // Address of the module owner, generally another module's implementation address
        address implementation; // Address of the module implementation
    }

    // Governor of the whole system. This address can be unset at any time. While set, this address is the only one allowed
    // to plug/unplug system modules. Some modules are also ERC20-funds recoverable, which can only be executed by the governor.
    address private governor;

    // List of modules registered for the system indexed by ID
    mapping (bytes32 => Module) private modules;

    event ModuleSet(bytes32 id, address owner, address implementation);
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
    * @notice Set module `_id` with owner `_owner` and implementation `_implementation`
    * @param _id Id of the module to be set
    * @param _owner Address of the module's owner to be set
    * @param _implementation Address of the module's implementation to be set
    */
    function setModule(bytes32 _id, address _owner, address _implementation) external onlyGovernor {
        _setImplementation(_id, _owner, _implementation);
    }

    /**
    * @notice Set many modules at once
    * @param _ids List of ids of each module to be set
    * @param _owners List of addresses of each module's owner to be set
    * @param _implementations List of addressed of each the module's implementation to be set
    */
    function setModules(bytes32[] calldata _ids, address[] calldata _owners, address[] calldata _implementations) external onlyGovernor {
        require(_ids.length == _owners.length, ERROR_INVALID_IMPLS_INPUT_LENGTH);
        require(_ids.length == _implementations.length, ERROR_INVALID_IMPLS_INPUT_LENGTH);

        for (uint256 i = 0; i < _ids.length; i++) {
            _setImplementation(_ids[i], _owners[i], _implementations[i]);
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
    * @dev Tell module information for a certain module ID
    * @param _id ID of the module being queried
    * @return owner Address of the module's owner
    * @return implementation Address of module's implementation
    */
    function getModule(bytes32 _id) external view returns (address owner, address implementation) {
        Module storage module = _getModule(_id);
        return (module.owner, module.implementation);
    }

    /**
    * @dev Tell the implementation address of the Accounting module
    * @return Implementation address of the Accounting module
    */
    function getAccounting() external view returns (IAccounting) {
        return IAccounting(_getModuleImplementation(ACCOUNTING));
    }

    /**
    * @dev Tell the owner address of the Accounting module
    * @return Owner address of the Accounting module
    */
    function getAccountingOwner() external view returns (address) {
        return _getModuleOwner(ACCOUNTING);
    }

    /**
    * @dev Tell the implementation address of the Voting module
    * @return Implementation address of the Voting module
    */
    function getCRVoting() external view returns (ICRVoting) {
        return ICRVoting(_getModuleImplementation(CR_VOTING));
    }

    /**
    * @dev Tell the owner address of the Voting module
    * @return Owner address of the Voting module
    */
    function getCRVotingOwner() external view returns (ICRVotingOwner) {
        return ICRVotingOwner(_getModuleOwner(CR_VOTING));
    }

    /**
    * @dev Tell the implementation address of the JurorsRegistry module
    * @return Implementation address of the JurorsRegistry module
    */
    function getJurorsRegistry() external view returns (IJurorsRegistry) {
        return IJurorsRegistry(_getModuleImplementation(JURORS_REGISTRY));
    }

    /**
    * @dev Tell the owner address of the JurorsRegistry module
    * @return Owner address of the JurorsRegistry module
    */
    function getJurorsRegistryOwner() external view returns (IJurorsRegistryOwner) {
        return IJurorsRegistryOwner(_getModuleOwner(JURORS_REGISTRY));
    }

    /**
    * @dev Tell the implementation address of the Subscriptions module
    * @return Implementation address of the Subscriptions module
    */
    function getSubscriptions() external view returns (ISubscriptions) {
        return ISubscriptions(_getModuleImplementation(SUBSCRIPTIONS));
    }

    /**
    * @dev Tell the owner address of the Subscriptions module
    * @return Owner address of the Subscriptions module
    */
    function getSubscriptionsOwner() external view returns (ISubscriptionsOwner) {
        return ISubscriptionsOwner(_getModuleOwner(SUBSCRIPTIONS));
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
    * @param _owner Address of the module's owner to be set
    * @param _implementation Address of the module's implementation to be set
    */
    function _setImplementation(bytes32 _id, address _owner, address _implementation) internal {
        require(_owner != ZERO_ADDRESS, ERROR_ZERO_IMPLEMENTATION_OWNER);
        require(isContract(_implementation), ERROR_IMPLEMENTATION_NOT_CONTRACT);

        modules[_id] = Module({ owner: _owner, implementation: _implementation });
        emit ModuleSet(_id, _owner, _implementation);
    }

    /**
    * @dev Internal function to tell the implementation address of a certain module
    * @param _id ID of the module querying the implementation address of
    * @return Implementation address of the module being queried
    */
    function _getModuleImplementation(bytes32 _id) internal view returns (address) {
        return _getModule(_id).implementation;
    }

    /**
    * @dev Internal function to tell the owner address of a certain module
    * @param _id ID of the module querying the implementation address of
    * @return Owner address of the module being queried
    */
    function _getModuleOwner(bytes32 _id) internal view returns (address) {
        return _getModule(_id).owner;
    }

    /**
    * @dev Internal function to tell module information for a certain module ID
    * @param _id ID of the module being queried
    * @return Module being queried
    */
    function _getModule(bytes32 _id) internal view returns (Module storage) {
        return modules[_id];
    }
}
