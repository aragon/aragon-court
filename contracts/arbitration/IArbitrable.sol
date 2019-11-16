pragma solidity ^0.5.8;

import "./IArbitrator.sol";


interface IArbitrable {
    // bytes4 constant INTERFACE_ID = 0x88f3ee69;

    event Ruled(IArbitrator indexed arbitrator, uint256 indexed disputeId, uint256 ruling);
    event EvidenceSubmitted(uint256 indexed disputeId, address indexed submitter, bytes evidence, bool finished);

    /**
    * @dev Submit evidence for a dispute
    * @param _disputeId Id of the dispute in the Court
    * @param _evidence Data submitted for the evidence related to the dispute
    * @param _finished Whether or not the submitter has finished submitting evidence
    */
    function submitEvidence(uint256 _disputeId, bytes calldata _evidence, bool _finished) external;

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
