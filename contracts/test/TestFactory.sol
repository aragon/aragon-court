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

contract CourtFactory is Factory {  
    function newCourtStaking(ERC20 anj) external {
        Court court = new Court(
            60 * 60,  // 1h
            anj,
            ERC20(0), // no fees
            0,
            0,
            0,
            0,
            address(this),
            uint64(block.timestamp + 60 * 60),
            1,
            1,
            1,
            1,
            100
        );

        emit Deployed(address(court));
    }
}
