pragma solidity ^0.5.8;

import "../../arbitration/IArbitrable.sol";
import "../../arbitration/IArbitrator.sol";


contract ArbitrableMock is IArbitrable {
    bytes4 public constant ERC165_INTERFACE = ERC165_INTERFACE_ID;
    bytes4 public constant ARBITRABLE_INTERFACE = ARBITRABLE_INTERFACE_ID;

    IArbitrator internal arbitrator;

    constructor (IArbitrator _arbitrator) public {
        arbitrator = _arbitrator;
    }

    function createDispute(uint8 _possibleRulings, bytes calldata _metadata) external {
        (address recipient, ERC20 feeToken, uint256 disputeFees) = arbitrator.getDisputeFees();
        feeToken.approve(recipient, disputeFees);
        arbitrator.createDispute(_possibleRulings, _metadata);
    }

    function submitEvidence(uint256 _disputeId, bytes calldata _evidence, bool _finished) external {
        emit EvidenceSubmitted(_disputeId, msg.sender, _evidence, _finished);
        if (_finished) arbitrator.closeEvidencePeriod(_disputeId);
    }

    function rule(uint256 _disputeId, uint256 _ruling) external {
        emit Ruled(IArbitrator(msg.sender), _disputeId, _ruling);
    }

    function interfaceID() external pure returns (bytes4) {
        IArbitrable arbitrable;
        return arbitrable.submitEvidence.selector ^ arbitrable.rule.selector;
    }
}
