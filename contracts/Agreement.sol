pragma solidity ^0.4.15;

import "./standards/arbitration/Arbitrable.sol";


contract Agreement is Arbitrable /* AragonApp/Trigger */ {
    address[] parties;

    // TODO: Probably needs to be moved into an 'initialize()' function at some point
    constructor(address _court, address[] _parties)
        public 
        Arbitrable(_court) {
        
        parties = _parties;
    }

    function canSubmitEvidence(uint256 _disputeId, address _submitter) public view returns (bool) {
        // TODO: should check court to see whether evidence can be submitted for this particular dispute at this point
        uint256 partiesLength = parties.length;
        for (uint256 i = 0; i < partiesLength; i++) {
            if (parties[i] == msg.sender) {
                return true;
            }
        }
    }

    /**
     *  @dev Execute a ruling of a dispute.
     *  @param _disputeId Id of the dispute in the Court contract.
     *  @param _ruling Ruling given by the arbitrator. Note that 0 is reserved for "Not able/wanting to make a decision".
     */
    function _executeRuling(uint256 _disputeId, uint256 _ruling) internal;
}
