pragma solidity ^0.5.8;

contract RegisterAndCall {

    /**
    * @dev This allows users to verify their BrightId account and interact with a contract in one transaction.
    *      Implementers of this function should check that msg.sender is the BrightIdRegister contract expected.
    * @param _usersUniqueId The unique address assigned to the registered BrightId user
    * @param _data Optional data that can be used to determine what operations to execute in the recipient contract
    */
    function receiveRegistration(address _usersUniqueId, bytes calldata _data) external;
}
