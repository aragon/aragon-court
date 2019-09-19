pragma solidity ^0.5.8;


interface IArbitrable {
    /**
    * @dev To be emitted when a dispute is created to link the correct meta-evidence to the disputeId
    * @param court Address of the Court resolving the dispute
    * @param disputeId Identification number of the associated dispute
    * @param baseEvidence Base evidence or location of the base evidence being submitted
    */
    event NewDispute(address indexed court, uint256 indexed disputeId, bytes baseEvidence);

    /**
    * @dev To be raised when evidence are submitted.
    *      Should point to the resource (evidences are not to be stored on chain due to gas considerations).
    * @param court Address of the Court resolving the dispute
    * @param disputeId Identification number of the associated dispute
    * @param submitter Address of the entity submitting the evidence
    * @param evidence Evidence or location of the evidence being submitted
    */
    event NewEvidence(address indexed court, uint256 indexed disputeId, address indexed submitter, bytes evidence);

    /**
    * @dev To be raised when a ruling is given
    * @param court Address of the Court giving the ruling
    * @param disputeId Identification number of the ruled dispute
    * @param ruling Final ruling of the dispute
    */
    event CourtRuling(address indexed court, uint256 indexed disputeId, uint256 ruling);

    /**
    * @dev Give a ruling for a dispute. Must be called by the court.
    *      The purpose of this function is to ensure that the address calling it has the right to rule on the contract.
    * @param _disputeId Identification number of the dispute to be ruled
    * @param _ruling Ruling given by the arbitrator. Note that 0 is reserved for "Not able/wanting to make a decision".
    */
    function rule(uint256 _disputeId, uint256 _ruling) external;

    /**
    * @dev Tell if a certain submitter can submit evidence for a given dispute or not
    * @param _disputeId Identification number of the dispute to be checked
    * @param _submitter Address of the entity that wishes to submit evidence
    * @return True if the given submitter is allowed to submit evidence for the dispute, false otherwise
    */
    function canSubmitEvidence(uint256 _disputeId, address _submitter) external view returns (bool);
}
