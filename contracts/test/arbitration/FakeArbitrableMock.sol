pragma solidity ^0.5.8;

import "./ArbitrableMock.sol";


contract FakeArbitrableMock is ArbitrableMock {
    constructor (Court _court) ArbitrableMock(_court) public {}

    function supportsInterface(bytes4 /* _interfaceId */) external pure returns (bool) {
        return false;
    }
}
