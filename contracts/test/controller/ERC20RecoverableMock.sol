pragma solidity ^0.5.8;

import "../../controller/ERC20Recoverable.sol";


contract ERC20RecoverableMock is ERC20Recoverable {
    constructor(Controller _controller) ERC20Recoverable(_controller) public {}
}
