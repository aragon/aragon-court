pragma solidity ^0.4.15;

import "./IArbitrable.sol";
import "../erc165/ERC165.sol";


contract Arbitrable is IArbitrable, ERC165 {
    address public court; // TODO: replace for ICourt or Court interface

    bytes4 private constant ERC165_INTERFACE_ID = 0x01ffc9a7;
    bytes4 private constant ARBITRABLE_INTERFACE_ID = 0xabababab; // TODO: interface id

    string private constant ERROR_NOT_COURT = "ARBITRABLE_NOT_COURT";
    string private constant ERROR_CANNOT_SUBMIT_EVIDENCE = "ARBITRABLE_CANNOT_SUBMIT_EVIDENCE";

    /** @dev Constructor. Choose the arbitrator.
     *  @param _court The address of the court that arbitrates the contract.
     */
    constructor(address _court) public {
        court = _court;
    }

    /**
     *  @dev Give a ruling for a dispute. Must be called by the arbitrator.
     *  The purpose of this function is to ensure that the address calling it has the right to rule on the contract.
     *  @param _disputeId Id of the dispute in the Court contract.
     *  @param _ruling Ruling given by the arbitrator. Note that 0 is reserved for "Not able/wanting to make a decision".
     */
    function rule(uint256 _disputeId, uint256 _ruling) external {
        require(msg.sender == court, ERROR_NOT_COURT);

        _executeRuling(_disputeId, _ruling);

        emit CourtRuling(msg.sender, _disputeId, _ruling);
    }

    function submitEvidence(uint256 _disputeId, bytes _evidence) external {
        require(canSubmitEvidence(_disputeId, msg.sender), ERROR_CANNOT_SUBMIT_EVIDENCE);

        emit NewEvidence(court, _disputeId, msg.sender, _evidence);
    }

    function supportsInterface(bytes4 _interfaceId) external pure returns (bool) {
        return _interfaceId == ARBITRABLE_INTERFACE_ID || _interfaceId == ERC165_INTERFACE_ID;
    }

    /**
     *  @dev Execute a ruling of a dispute.
     *  @param _disputeId Id of the dispute in the Court contract.
     *  @param _ruling Ruling given by the arbitrator. Note that 0 is reserved for "Not able/wanting to make a decision".
     */
    function _executeRuling(uint256 _disputeId, uint256 _ruling) internal;
}
