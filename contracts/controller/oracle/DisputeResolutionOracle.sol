pragma solidity ^0.5.8;

import "./IDisputeResolutionOracle.sol";
import "../../court/ICourt.sol";
import "../../arbitration/IArbitrable.sol";
import "../../subscriptions/ISubscriptions.sol";
import "../../lib/os/Uint256Helpers.sol";


contract DisputeResolutionOracle is IDisputeResolutionOracle {
    using Uint256Helpers for uint256;

    string private constant ERROR_SENDER_NOT_ARBITRABLE = "CT_SENDER_NOT_ARBITRABLE";
    string private constant ERROR_SUBSCRIPTION_NOT_PAID = "CT_SUBSCRIPTION_NOT_PAID";

    // Arbitrable interface ID based on ERC-165
    bytes4 private constant ARBITRABLE_INTERFACE_ID = bytes4(0x311a6c56);

    /**
    * @dev Create a dispute over the Arbitrable sender with a number of possible rulings
    * @param _possibleRulings Number of possible rulings allowed for the drafted jurors to vote on the dispute
    * @param _metadata Optional metadata that can be used to provide additional information on the dispute to be created
    * @return Dispute identification number
    */
    function createDispute(uint256 _possibleRulings, bytes calldata _metadata) external returns (uint256) {
        IArbitrable subject = IArbitrable(msg.sender);
        require(subject.supportsInterface(ARBITRABLE_INTERFACE_ID), ERROR_SENDER_NOT_ARBITRABLE);

        ISubscriptions subscriptions = ISubscriptions(_getSubscriptions());
        require(subscriptions.isUpToDate(address(subject)), ERROR_SUBSCRIPTION_NOT_PAID);

        ICourt court = ICourt(_getCourt());
        return court.createDispute(subject, _possibleRulings.toUint8(), _metadata);
    }

    /**
    * @dev Execute the arbitrable associated to a dispute based on its final ruling
    * @param _disputeId Identification number of the dispute to be executed
    */
    function executeRuling(uint256 _disputeId) external {
        ICourt court = ICourt(_getCourt());
        (IArbitrable subject, uint8 ruling) = court.computeRuling(_disputeId);
        subject.rule(_disputeId, uint256(ruling));
    }

    /**
    * @dev Tell the dispute fees information to create a dispute
    * @return recipient Address where the corresponding dispute fees must be transferred to
    * @return feeToken ERC20 token used for the fees
    * @return feeAmount Total amount of fees that must be allowed to the recipient
    */
    function getDisputeFees() external view returns (address recipient, ERC20 feeToken, uint256 feeAmount) {
        recipient = _getCourt();
        ICourt court = ICourt(recipient);
        (feeToken, feeAmount) = court.getDisputeFees();
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

    /**
    * @dev Internal function to tell the address of the Court module
    * @return Address of the Court module
    */
    function _getCourt() internal view returns (address);

    /**
    * @dev Internal function to tell the address of the Subscriptions module
    * @return Address of the Subscriptions module
    */
    function _getSubscriptions() internal view returns (address);
}
