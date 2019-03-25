pragma solidity ^0.4.24;

import "@aragon/apps-shared-minime/contracts/MiniMeToken.sol";
import "../Court.sol";

import "@aragon/apps-shared-migrations/contracts/Migrations.sol";

contract Factory {
    event Deployed(address addr);
}

contract TokenFactory is Factory {
    function newToken(string symbol, uint256 initialBalance) external {
        MiniMeToken token = new MiniMeToken(
            MiniMeTokenFactory(0),
            MiniMeToken(0),
            0,
            symbol,
            0,
            symbol,
            true
        );

        token.generateTokens(msg.sender, initialBalance);
        token.changeController(msg.sender);

        emit Deployed(address(token));
    }
}
