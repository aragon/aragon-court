pragma solidity ^0.5.8;

import "../../court/Court.sol";
import "../../standards/ERC165.sol";
import "../../arbitration/IArbitrable.sol";


contract ArbitrableMock is IArbitrable, ERC165 {
    bytes4 private constant ARBITRABLE_INTERFACE_ID = bytes4(0x311a6c56);

    event CourtRuling(address indexed court, uint256 indexed disputeId, uint256 ruling);

    Court internal court;

    constructor (Court _court) public {
        court = _court;
    }

    function createDispute(uint8 _possibleRulings, bytes calldata _metadata) external {
        (ERC20 feeToken, uint256 disputeFees) = court.getDisputeFees();
        feeToken.approve(address(court), disputeFees);
        court.createDispute(_possibleRulings, _metadata);
    }

    function rule(uint256 _disputeId, uint256 _ruling) external {
        emit CourtRuling(msg.sender, _disputeId, _ruling);
    }

    function supportsInterface(bytes4 _interfaceId) external pure returns (bool) {
        return _interfaceId == ARBITRABLE_INTERFACE_ID;
    }
}
