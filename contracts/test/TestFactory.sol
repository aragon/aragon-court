pragma solidity ^0.4.24;

import "@aragon/apps-shared-minime/contracts/MiniMeToken.sol";


contract TokenFactory {
    event Deployed(address addr);

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
