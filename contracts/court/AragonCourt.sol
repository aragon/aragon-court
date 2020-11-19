pragma solidity ^0.5.8;

import "../lib/os/Uint256Helpers.sol";

import "./controller/Controller.sol";
import "../arbitration/IArbitrator.sol";
import "../arbitration/IArbitrable.sol";
import "../disputes/IDisputeManager.sol";


contract AragonCourt is Controller, IArbitrator {
    using Uint256Helpers for uint256;

    // Arbitrable interface ID based on ERC-165
    bytes4 private constant ARBITRABLE_INTERFACE_ID = bytes4(0x88f3ee69);

    /**
    * @dev Constructor function
    * @param _termParams Array containing:
    *        0. _termDuration Duration in seconds per term
    *        1. _firstTermStartTime Timestamp in seconds when the court will open (to give time for juror on-boarding)
    * @param _governors Array containing:
    *        0. _fundsGovernor Address of the funds governor
    *        1. _configGovernor Address of the config governor
    *        2. _oracle Address of the price oracle
    *        3. _modulesGovernor Address of the modules governor
    * @param _feeToken Address of the token contract that is used to pay for fees
    * @param _fees Array containing:
    *        0. jurorFee Amount of fee tokens that is paid per juror per dispute
    *        1. draftFee Amount of fee tokens per juror to cover the drafting cost
    *        2. settleFee Amount of fee tokens per juror to cover round settlement cost
    * @param _roundStateDurations Array containing the durations in terms of the different phases of a dispute:
    *        0. evidenceTerms Max submitting evidence period duration in terms
    *        1. commitTerms Commit period duration in terms
    *        2. revealTerms Reveal period duration in terms
    *        3. appealTerms Appeal period duration in terms
    *        4. appealConfirmationTerms Appeal confirmation period duration in terms
    * @param _pcts Array containing:
    *        0. penaltyPct Permyriad of min active tokens balance to be locked to each drafted jurors (‱ - 1/10,000)
    *        1. finalRoundReduction Permyriad of fee reduction for the last appeal round (‱ - 1/10,000)
    * @param _roundParams Array containing params for rounds:
    *        0. firstRoundJurorsNumber Number of jurors to be drafted for the first round of disputes
    *        1. appealStepFactor Increasing factor for the number of jurors of each round of a dispute
    *        2. maxRegularAppealRounds Number of regular appeal rounds before the final round is triggered
    *        3. finalRoundLockTerms Number of terms that a coherent juror in a final round is disallowed to withdraw (to prevent 51% attacks)
    * @param _appealCollateralParams Array containing params for appeal collateral:
    *        0. appealCollateralFactor Permyriad multiple of dispute fees required to appeal a preliminary ruling
    *        1. appealConfirmCollateralFactor Permyriad multiple of dispute fees required to confirm appeal
    * @param _jurorsParams Array containing params for juror registry:
    *        0. minActiveBalance Minimum amount of juror tokens that can be activated
    *        1. minMaxPctTotalSupply The min max percent of the total supply a juror can activate, applied for total supply active stake
    *        2. maxMaxPctTotalSupply The max max percent of the total supply a juror can activate, applied for 0 active stake
    */
    constructor(
        uint64[2] memory _termParams,
        address[4] memory _governors,
        ERC20 _feeToken,
        uint256[3] memory _fees,
        uint64[5] memory _roundStateDurations,
        uint16[2] memory _pcts,
        uint64[4] memory _roundParams,
        uint256[2] memory _appealCollateralParams,
        uint256[3] memory _jurorsParams
    )
        public
        Controller(
            _termParams,
            _governors,
            _feeToken,
            _fees,
            _roundStateDurations,
            _pcts,
            _roundParams,
            _appealCollateralParams,
            _jurorsParams
        )
    {
        // solium-disable-previous-line no-empty-blocks
    }

    /**
    * @notice Create a dispute with `_possibleRulings` possible rulings
    * @param _possibleRulings Number of possible rulings allowed for the drafted jurors to vote on the dispute
    * @param _metadata Optional metadata that can be used to provide additional information on the dispute to be created
    * @return Dispute identification number
    */
    function createDispute(uint256 _possibleRulings, bytes calldata _metadata) external returns (uint256) {
        IArbitrable subject = IArbitrable(msg.sender);
        IDisputeManager disputeManager = IDisputeManager(_getDisputeManager());
        return disputeManager.createDispute(subject, _possibleRulings.toUint8(), _metadata);
    }

    /**
    * @notice Submit `_evidence` as evidence from `_submitter` for dispute #`_disputeId`
    * @param _disputeId Id of the dispute in the Protocol
    * @param _submitter Address of the account submitting the evidence
    * @param _evidence Data submitted for the evidence related to the dispute
    */
    function submitEvidence(uint256 _disputeId, address _submitter, bytes calldata _evidence) external {
        IDisputeManager disputeManager = IDisputeManager(_getDisputeManager());
        IArbitrable subject = IArbitrable(msg.sender);
        disputeManager.submitEvidence(subject, _disputeId, _submitter, _evidence);
    }

    /**
    * @notice Close the evidence period of dispute #`_disputeId`
    * @param _disputeId Identification number of the dispute to close its evidence submitting period
    */
    function closeEvidencePeriod(uint256 _disputeId) external {
        IArbitrable subject = IArbitrable(msg.sender);
        IDisputeManager disputeManager = IDisputeManager(_getDisputeManager());
        disputeManager.closeEvidencePeriod(subject, _disputeId);
    }

    /**
    * @notice Rule dispute #`_disputeId` if ready
    * @param _disputeId Identification number of the dispute to be ruled
    * @return subject Arbitrable instance associated to the dispute
    * @return ruling Ruling number computed for the given dispute
    */
    function rule(uint256 _disputeId) external returns (address subject, uint256 ruling) {
        IDisputeManager disputeManager = IDisputeManager(_getDisputeManager());
        (IArbitrable _subject, uint8 _ruling) = disputeManager.computeRuling(_disputeId);
        return (address(_subject), uint256(_ruling));
    }

    /**
    * @dev Tell the dispute fees information to create a dispute
    * @return recipient Address where the corresponding dispute fees must be transferred to
    * @return feeToken ERC20 token used for the fees
    * @return feeAmount Total amount of fees that must be allowed to the recipient
    */
    function getDisputeFees() external view returns (address recipient, ERC20 feeToken, uint256 feeAmount) {
        recipient = _getDisputeManager();
        IDisputeManager disputeManager = IDisputeManager(recipient);
        (feeToken, feeAmount) = disputeManager.getDisputeFees();
    }

}
