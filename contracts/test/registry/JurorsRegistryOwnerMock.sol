pragma solidity ^0.4.24;

import "../../standards/erc900/IJurorsRegistry.sol";
import "../../standards/erc900/IJurorsRegistryOwner.sol";


contract JurorsRegistryOwnerMock is IJurorsRegistryOwner {
    uint64 internal termId;
    IJurorsRegistry internal registry;

    event Slashed(uint256 collectedTokens);
    event Collected(bool collected);

    constructor(IJurorsRegistry _registry) public {
        registry = _registry;
    }

    function ensureAndGetTermId() external returns (uint64) {
        return termId;
    }

    function getLastEnsuredTermId() external view returns (uint64) {
        return termId;
    }

    function incrementTerm() public {
        termId += 1;
    }

    function assignTokens(address _juror, uint256 _amount) public {
        registry.assignTokens(_juror, _amount);
    }

    function burnTokens(uint256 _amount) public {
        registry.burnTokens(_amount);
    }

    function slashOrUnlock(address[] _jurors, uint256[] _penalties, uint8[] _castVotes, uint8 _winningRuling) public {
        uint256 collectedTokens = registry.slashOrUnlock(termId, _jurors, _penalties, _castVotes, _winningRuling);
        emit Slashed(collectedTokens);
    }

    function collect(address _juror, uint256 _amount) public {
        bool collected = registry.collectTokens(_juror, _amount, termId);
        emit Collected(collected);
    }
}
