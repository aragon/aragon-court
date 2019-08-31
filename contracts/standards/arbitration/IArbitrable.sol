pragma solidity ^0.4.15;


interface IArbitrable {
    /**
    * @dev To be emitted when a dispute is created to link the correct meta-evidence to the disputeId
    * @param court The court resolving the dispute
    * @param disputeId Id of the dispute in the Court
    * @param baseEvidence Base evidence or location of the base evidence being submitted
    */
    event NewDispute(address indexed court, uint256 indexed disputeId, bytes baseEvidence);

    /**
    * @dev To be raised when evidence are submitted. Should point to the resource (evidences are not to be stored on chain due to gas
    *      considerations).
    * @param court The court resolving the dispute
    * @param disputeId Id of the dispute in the Court
    * @param submitter The address of the entity submitting the evidence
    * @param evidence Evidence or location of the evidence being submitted
    */
    event NewEvidence(address indexed court, uint256 indexed disputeId, address indexed submitter, bytes evidence);

    /**
    * @dev To be raised when a ruling is given
    * @param court The court giving the ruling
    * @param disputeId Id of the dispute in the Court
    * @param ruling The ruling which was given
    */
    event CourtRuling(address indexed court, uint256 indexed disputeId, uint256 ruling);

    /**
    * @dev Give a ruling for a dispute. Must be called by the court. The purpose of this function is to ensure that the address calling it has
    *      the right to rule on the contract.
    * @param _disputeId Id of the dispute in the Court
    * @param _ruling Ruling given by the court. Note that 0 is reserved for "Not able/wanting to make a decision".
    */
    function rule(uint256 _disputeId, uint256 _ruling) external;

    /**
    * @param _disputeId Id of the dispute in the Court
    * @param _submitter address of the entity that wishes to submit evidence
    * @return bool whether the submitter is allowed to submit evidence for the dispute
    */
    function canSubmitEvidence(uint256 _disputeId, address _submitter) public view returns (bool);
}
