pragma solidity ^0.5.8;

import "@aragon/os/contracts/lib/math/SafeMath.sol";


library PctHelpers {
    using SafeMath for uint256;

    uint256 internal constant PCT_BASE = 10000; // ‱ (1 / 10,000)

    function isValid(uint16 _pct) internal pure returns (bool) {
        return _pct <= PCT_BASE;
    }

    function pct(uint256 self, uint16 _pct) internal pure returns (uint256) {
        return self.mul(uint256(_pct)) / PCT_BASE;
    }

    function pctIncrease(uint256 self, uint16 _pct) internal pure returns (uint256) {
        return self.mul(PCT_BASE + uint256(_pct)) / PCT_BASE;
    }
}
