pragma solidity 0.4.24;

import "@1hive/apps-brightid-register/contracts/misc/BrightIdRegisterMock.sol";

import "@aragon/os/contracts/acl/ACL.sol";
import "@aragon/os/contracts/kernel/Kernel.sol";
import "@aragon/os/contracts/factory/DAOFactory.sol";
import "@aragon/os/contracts/factory/EVMScriptRegistryFactory.sol";

// Importing brightid related contracts to allow compiling them with a different version

contract BrightIdRegisterImports {}
