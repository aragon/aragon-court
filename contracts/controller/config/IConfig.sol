pragma solidity ^0.5.8;

import "@aragon/os/contracts/lib/token/ERC20.sol";


interface IConfig {
    function getConfig(uint64 _termId) external view
        returns (
            ERC20 feeToken,
            uint256[3] memory fees,
            uint64[4] memory roundStateDurations,
            uint16[2] memory pcts,
            uint64[3] memory roundParams,
            uint256[2] memory appealCollateralParams
        );
}
