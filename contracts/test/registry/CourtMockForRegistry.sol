pragma solidity ^0.5.8;

import "../../controller/Controlled.sol";
import "../../controller/Controller.sol";


contract CourtMockForRegistry is Controlled {
    event Slashed(uint256 collected);
    event Collected(bool collected);
    event Drafted(address[] addresses, uint64[] weights, uint256 outputLength);

    constructor(Controller _controller) Controlled(_controller) public {}

    function assignTokens(address _juror, uint256 _amount) external {
        _jurorsRegistry().assignTokens(_juror, _amount);
    }

    function burnTokens(uint256 _amount) external {
        _jurorsRegistry().burnTokens(_amount);
    }

    function slashOrUnlock(address[] calldata _jurors, uint256[] calldata _lockedAmounts, bool[] calldata _rewardedJurors) external {
        uint256 collectedTokens = _jurorsRegistry().slashOrUnlock(_getLastEnsuredTermId(), _jurors, _lockedAmounts, _rewardedJurors);
        emit Slashed(collectedTokens);
    }

    function collect(address _juror, uint256 _amount) external {
        bool collected = _jurorsRegistry().collectTokens(_juror, _amount, _getLastEnsuredTermId());
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
        external
    {
        uint256[7] memory draftParams = [
            uint256(_termRandomness),
            _disputeId,
            _getLastEnsuredTermId(),
            _selectedJurors,
            _batchRequestedJurors,
            _roundRequestedJurors,
            _lockPct
        ];
        (address[] memory jurors, uint64[] memory weights, uint256 outputLength) = _jurorsRegistry().draft(draftParams);
        emit Drafted(jurors, weights, outputLength);
    }
}
