pragma solidity ^0.5.8;

import "./IArbitrator.sol";


contract IAragonCourtArbitrator is IArbitrator {

    /**
    * @dev Tell address of a module based on a given ID
    * @param _id ID of the module being queried
    * @return Address of the requested module
    */
    function getModule(bytes32 _id) external view returns (address);
}
