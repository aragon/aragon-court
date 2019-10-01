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

    bytes32 internal constant ACCOUNTING = keccak256(abi.encodePacked("ACCOUNTING"));
    bytes32 internal constant CR_VOTING = keccak256(abi.encodePacked("CR_VOTING"));
    bytes32 internal constant JURORS_REGISTRY = keccak256(abi.encodePacked("JURORS_REGISTRY"));
    bytes32 internal constant SUBSCRIPTIONS = keccak256(abi.encodePacked("SUBSCRIPTIONS"));

    struct Module {
        address owner;
        address implementation;
    }

    address private governor;
    mapping (bytes32 => Module) private modules;

    event ModuleSet(bytes32 id, address owner, address implementation);
    event GovernorChanged(address previousGovernor, address currentGovernor);

    modifier onlyGovernor {
        require(msg.sender == governor, ERROR_SENDER_NOT_GOVERNOR);
        _;
    }

    constructor(address _governor) public {
        _setGovernor(_governor);
    }

    function changeGovernor(address _newGovernor) external onlyGovernor {
        require(_newGovernor != ZERO_ADDRESS, ERROR_INVALID_GOVERNOR_ADDRESS);
        _setGovernor(_newGovernor);
    }

    function eject() external onlyGovernor {
        _setGovernor(ZERO_ADDRESS);
    }

    function setModule(bytes32 _id, address _owner, address _implementation) external onlyGovernor {
        _setImplementation(_id, _owner, _implementation);
    }

    function setModules(bytes32[] calldata _ids, address[] calldata _owners, address[] calldata _implementations) external onlyGovernor {
        require(_ids.length == _owners.length, ERROR_INVALID_IMPLS_INPUT_LENGTH);
        require(_ids.length == _implementations.length, ERROR_INVALID_IMPLS_INPUT_LENGTH);

        for (uint256 i = 0; i < _ids.length; i++) {
            _setImplementation(_ids[i], _owners[i], _implementations[i]);
        }
    }

    function getGovernor() external view returns (address) {
        return governor;
    }

    function getModule(bytes32 _id) external view returns (address owner, address implementation) {
        Module storage module = _getModule(_id);
        return (module.owner, module.implementation);
    }

    function getAccounting() external view returns (IAccounting) {
        return IAccounting(_getModuleImplementation(ACCOUNTING));
    }

    function getAccountingOwner() external view returns (address) {
        return _getModuleOwner(ACCOUNTING);
    }

    function getCRVoting() external view returns (ICRVoting) {
        return ICRVoting(_getModuleImplementation(CR_VOTING));
    }

    function getCRVotingOwner() external view returns (ICRVotingOwner) {
        return ICRVotingOwner(_getModuleOwner(CR_VOTING));
    }

    function getJurorsRegistry() external view returns (IJurorsRegistry) {
        return IJurorsRegistry(_getModuleImplementation(JURORS_REGISTRY));
    }

    function getJurorsRegistryOwner() external view returns (IJurorsRegistryOwner) {
        return IJurorsRegistryOwner(_getModuleOwner(JURORS_REGISTRY));
    }

    function getSubscriptions() external view returns (ISubscriptions) {
        return ISubscriptions(_getModuleImplementation(SUBSCRIPTIONS));
    }

    function getSubscriptionsOwner() external view returns (ISubscriptionsOwner) {
        return ISubscriptionsOwner(_getModuleOwner(SUBSCRIPTIONS));
    }

    function _setGovernor(address _newGovernor) internal {
        emit GovernorChanged(governor, _newGovernor);
        governor = _newGovernor;
    }

    function _setImplementation(bytes32 _id, address _owner, address _implementation) internal {
        require(_owner != ZERO_ADDRESS, ERROR_ZERO_IMPLEMENTATION_OWNER);
        require(isContract(_implementation), ERROR_IMPLEMENTATION_NOT_CONTRACT);

        modules[_id] = Module({ owner: _owner, implementation: _implementation });
        emit ModuleSet(_id, _owner, _implementation);
    }

    function _getModuleImplementation(bytes32 _id) internal view returns (address) {
        return _getModule(_id).implementation;
    }

    function _getModuleOwner(bytes32 _id) internal view returns (address) {
        return _getModule(_id).owner;
    }

    function _getModule(bytes32 _id) internal view returns (Module storage) {
        return modules[_id];
    }
}
