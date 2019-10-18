pragma solidity ^0.5.8;

import "../../court/IClock.sol";
import "../../registry/JurorsRegistry.sol";


contract CourtMockForRegistry {
    JurorsRegistry internal registry;

    event Slashed(uint256 collected);
    event Collected(bool collected);
    event Drafted(address[] addresses, uint256 length);

    constructor(JurorsRegistry _registry) public {
        registry = _registry;
    }

    function assignTokens(address _juror, uint256 _amount) public {
        registry.assignTokens(_juror, _amount);
    }

    function burnTokens(uint256 _amount) public {
        registry.burnTokens(_amount);
    }

    function slashOrUnlock(address[] memory _jurors, uint256[] memory _lockedAmounts, bool[] memory _rewardedJurors) public {
        uint256 collectedTokens = registry.slashOrUnlock(_termId(), _jurors, _lockedAmounts, _rewardedJurors);
        emit Slashed(collectedTokens);
    }

    function collect(address _juror, uint256 _amount) public {
        bool collected = registry.collectTokens(_juror, _amount, _termId());
        emit Collected(collected);
    }

    function draft(
        bytes32 _termRandomness,
        uint256 _disputeId,
        uint256 _selectedJurors,
        uint256 _batchRequestedJurors,
        uint64 _roundRequestedJurors,
        uint16 _lockPct
    )
        public
    {
        uint256[7] memory draftParams = [
            uint256(_termRandomness),
            _disputeId,
            _termId(),
            _selectedJurors,
            _batchRequestedJurors,
            _roundRequestedJurors,
            _lockPct
        ];

        (address[] memory jurors, uint256 length) = registry.draft(draftParams);
        emit Drafted(jurors, length);
    }

    function _termId() internal view returns (uint64) {
        Controller controller = registry.getController();
        IClock clock = IClock(controller.getClock());
        return clock.getLastEnsuredTermId();
    }
}
