pragma solidity ^0.5.8;


library BytesHelpers {
    function toBytes4(bytes memory _self) internal pure returns (bytes4 result) {
        if (_self.length < 4) {
            return bytes4(0);
        }

        assembly { result := mload(add(_self, 0x20)) }
    }
}
