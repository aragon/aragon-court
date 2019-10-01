pragma solidity ^0.5.8;

import "@aragon/os/contracts/lib/token/ERC20.sol";

import "../../registry/IJurorsRegistryOwner.sol";
import "../../subscriptions/ISubscriptionsOwner.sol";


contract SubscriptionsOwnerMock is ISubscriptionsOwner, IJurorsRegistryOwner {
    uint64 termId;
    bytes32 termRandomness;

    function mockSetTerm(uint64 _termId) external {
        termId = _termId;
    }

    function mockIncreaseTerms(uint64 _terms) external {
        termId += _terms;
    }

    function mockSetTermRandomness(bytes32 _termRandomness) external {
        termRandomness = _termRandomness;
    }

    function ensureAndGetTermId() external returns (uint64) {
        return termId;
    }

    function getCurrentTermId() external view returns (uint64) {
        return termId;
    }

    function getLastEnsuredTermId() external view returns (uint64) {
        return termId;
    }

    function getTermRandomness(uint64) external view returns (bytes32) {
        return termRandomness;
    }
}
