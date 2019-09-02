pragma solidity ^0.5.8;


library BytesHelpers {
    function toBytes4(bytes memory _self) internal pure returns (bytes4 result) {
        uint256 length = _self.length;
        assembly { result := mload(add(_self, 0x20)) }

        if (length < 4) {
            uint256 shiftingPositions = 8 - length * 2;
            result = toBytes4(toUint256(result) / (16 ** shiftingPositions));
        }
    }

    function toBytes4(uint256 i) private pure returns (bytes4 o) {
        assembly { o := mload(add(i, 0x20)) }
    }

    function toUint256(bytes4 i) private pure returns (uint256 o) {
        assembly { o := mload(add(i, 0x20)) }
    }
}
