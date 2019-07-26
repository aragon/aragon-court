pragma solidity ^0.4.24;

import "@aragon/apps-shared-migrations/contracts/Migrations.sol";
import "@aragon/apps-shared-minime/contracts/MiniMeToken.sol";

import "@aragon/os/contracts/kernel/Kernel.sol";
import "@aragon/os/contracts/acl/ACL.sol";
import "@aragon/os/contracts/factory/DAOFactory.sol";

import "@ablack/fundraising-market-maker-bancor/contracts/BancorMarketMaker.sol";
import "@ablack/fundraising-market-maker-bancor/contracts/test/mocks/SimpleMarketMakerController.sol";


contract TestImports {
    constructor() public {
        // solium-disable-previous-line no-empty-blocks
    }
}
