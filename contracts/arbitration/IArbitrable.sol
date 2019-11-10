pragma solidity ^0.5.8;


interface IArbitrable {
    // bytes4 constant INTERFACE_ID = 0x311a6c56;

    /**
    * @dev Give a ruling for a certain dispute, the account calling it must have rights to rule on the contract
    * @param _disputeId Identification number of the dispute to be ruled
    * @param _ruling Ruling given by the arbitrator, where 0 is reserved for "refused to make a decision"
    */
    function rule(uint256 _disputeId, uint256 _ruling) external;

    /**
    * @dev ERC165 - Query if a contract implements a certain interface
    * @param _interfaceId The interface identifier being queried, as specified in ERC-165
    * @return True if the given interface ID is equal to 0x311a6c56, false otherwise
    */
    function supportsInterface(bytes4 _interfaceId) external pure returns (bool);
}
