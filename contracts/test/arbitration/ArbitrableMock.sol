pragma solidity ^0.5.8;

import "../../court/Court.sol";
import "../../standards/ERC165.sol";
import "../../arbitration/IArbitrable.sol";
import "../../arbitration/IArbitrator.sol";


contract ArbitrableMock is IArbitrable, ERC165 {
    bytes4 private constant ARBITRABLE_INTERFACE_ID = bytes4(0x311a6c56);

    event Ruled(IArbitrator indexed arbitrator, uint256 indexed disputeId, uint256 ruling);

    IArbitrator internal arbitrator;

    constructor (IArbitrator _arbitrator) public {
        arbitrator = _arbitrator;
    }

    function createDispute(uint8 _possibleRulings, bytes calldata _metadata) external {
        (address recipient, ERC20 feeToken, uint256 disputeFees) = arbitrator.getDisputeFees();
        feeToken.approve(recipient, disputeFees);
        arbitrator.createDispute(_possibleRulings, _metadata);
    }

    function rule(uint256 _disputeId, uint256 _ruling) external {
        emit Ruled(IArbitrator(msg.sender), _disputeId, _ruling);
    }

    function supportsInterface(bytes4 _interfaceId) external pure returns (bool) {
        return _interfaceId == ARBITRABLE_INTERFACE_ID;
    }
}
