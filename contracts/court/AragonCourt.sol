pragma solidity ^0.5.8;

import "../lib/os/Uint256Helpers.sol";

import "./clock/CourtClock.sol";
import "./config/CourtConfig.sol";
import "./controller/Controller.sol";
import "../arbitration/IArbitrator.sol";
import "../arbitration/IArbitrable.sol";
import "../disputes/IDisputeManager.sol";
import "../subscriptions/ISubscriptions.sol";


contract AragonCourt is Controller, IArbitrator {
    using Uint256Helpers for uint256;

    string private constant ERROR_SUBSCRIPTION_NOT_PAID = "AC_SUBSCRIPTION_NOT_PAID";
    string private constant ERROR_SENDER_NOT_ARBITRABLE = "AC_SENDER_NOT_ARBITRABLE";
    string private constant ERROR_SENDER_NOT_DISPUTE_SUBJECT = "AC_SENDER_NOT_DISPUTE_SUBJECT";

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
    *        2. _modulesGovernor Address of the modules governor
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
    *        1. appealCollateralFactor Permyriad multiple of juror fees required to appeal a preliminary ruling
    *        2. appealConfirmCollateralFactor Permyriad multiple of juror fees required to confirm appeal
    * @param _minActiveBalance Minimum amount of juror tokens that can be activated
    */
    constructor(
        uint64[2] memory _termParams,
        address[3] memory _governors,
        ERC20 _feeToken,
        uint256[3] memory _fees,
        uint64[5] memory _roundStateDurations,
        uint16[2] memory _pcts,
        uint64[4] memory _roundParams,
        uint256[2] memory _appealCollateralParams,
        uint256 _minActiveBalance
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
            _minActiveBalance
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
        require(subject.supportsInterface(ARBITRABLE_INTERFACE_ID), ERROR_SENDER_NOT_ARBITRABLE);

        ISubscriptions subscriptions = ISubscriptions(_getSubscriptions());
        require(subscriptions.isUpToDate(address(subject)), ERROR_SUBSCRIPTION_NOT_PAID);

        IDisputeManager disputeManager = IDisputeManager(_getDisputeManager());
        return disputeManager.createDispute(subject, _possibleRulings.toUint8(), _metadata);
    }

    /**
    * @notice Close the evidence period of dispute #`_disputeId`
    * @param _disputeId Identification number of the dispute to close its evidence submitting period
    */
    function closeEvidencePeriod(uint256 _disputeId) external {
        IDisputeManager disputeManager = IDisputeManager(_getDisputeManager());
        (IArbitrable subject,,,,,) = disputeManager.getDispute(_disputeId);
        require(subject == IArbitrable(msg.sender), ERROR_SENDER_NOT_DISPUTE_SUBJECT);
        disputeManager.closeEvidencePeriod(_disputeId);
    }

    /**
    * @notice Execute the Arbitrable associated to dispute #`_disputeId` based on its final ruling
    * @param _disputeId Identification number of the dispute to be executed
    */
    function executeRuling(uint256 _disputeId) external {
        IDisputeManager disputeManager = IDisputeManager(_getDisputeManager());
        (IArbitrable subject, uint8 ruling) = disputeManager.computeRuling(_disputeId);
        subject.rule(_disputeId, uint256(ruling));
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

    /**
    * @dev Tell the subscription fees information for a subscriber to be up-to-date
    * @param _subscriber Address of the account paying the subscription fees for
    * @return recipient Address where the corresponding subscriptions fees must be transferred to
    * @return feeToken ERC20 token used for the subscription fees
    * @return feeAmount Total amount of fees that must be allowed to the recipient
    */
    function getSubscriptionFees(address _subscriber) external view returns (address recipient, ERC20 feeToken, uint256 feeAmount) {
        recipient = _getSubscriptions();
        ISubscriptions subscriptions = ISubscriptions(recipient);
        (feeToken, feeAmount,) = subscriptions.getOwedFeesDetails(_subscriber);
    }
}
