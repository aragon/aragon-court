pragma solidity ^0.5.8;

import "../../court/controller/Controlled.sol";
import "../../court/controller/Controller.sol";


contract DisputeManagerMockForRegistry is Controlled {
    event Slashed(uint256 collected);
    event Collected(bool collected);
    event Drafted(address[] addresses, uint256 length);

    constructor(Controller _controller) Controlled(_controller) public {}

    function assignTokens(address _juror, uint256 _amount) external {
        // We convert to the unique id because the dispute manager will only ever reference
        // unique juror ids but the JurorsRegistry tests may use other addresses
        address uniqueJurorId = _brightIdRegister().uniqueUserId(_juror);
        _jurorsRegistry().assignTokens(uniqueJurorId, _amount);
    }

    function burnTokens(uint256 _amount) external {
        _jurorsRegistry().burnTokens(_amount);
    }

    function slashOrUnlock(address[] calldata _jurors, uint256[] calldata _lockedAmounts, bool[] calldata _rewardedJurors) external {
        // We convert to the unique id because the dispute manager will only ever reference
        // unique juror ids but the JurorsRegistry tests may use other addresses
        address[] memory jurorsUniqueAddresses = new address[](_jurors.length);
        for (uint256 i = 0; i < _jurors.length; i++) {
            jurorsUniqueAddresses[i] = _brightIdRegister().uniqueUserId(_jurors[i]);
        }

        uint256 collectedTokens = _jurorsRegistry().slashOrUnlock(_getLastEnsuredTermId(), jurorsUniqueAddresses, _lockedAmounts, _rewardedJurors);
        emit Slashed(collectedTokens);
    }

    function collect(address _juror, uint256 _amount) external {
        // We convert to the unique id because the dispute manager will only ever reference
        // unique juror ids but the JurorsRegistry tests may use other addresses
        address uniqueJurorId = _brightIdRegister().uniqueUserId(_juror);
        bool collected = _jurorsRegistry().collectTokens(uniqueJurorId, _amount, _getLastEnsuredTermId());
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

        (address[] memory jurors, uint256 length) = _jurorsRegistry().draft(draftParams);
        emit Drafted(jurors, length);
    }
}
