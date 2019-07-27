pragma solidity ^0.4.24;


library BytesHelpers {
    function toBytes4(bytes memory _self) internal pure returns (bytes4 result) {
        uint256 length = _self.length;
        assembly { result := mload(add(_self, 0x20)) }

        if (length < 4) {
            uint256 shiftingPositions = 8 - length * 2;
            result = bytes4(uint256(result) / (16 ** shiftingPositions));
        }
    }
}
