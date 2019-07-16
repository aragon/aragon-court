pragma solidity ^0.4.24;

import "../Court.sol";


contract CourtMock is Court {
    uint64 internal mockTime = 0;
    uint64 internal mockBn = 0;

    constructor(
        uint64 _termDuration,
        uint64 _firstTermStartTime,
        ERC20 _feeToken,
        uint256[4] _fees, // _jurorFee, _heartbeatFee, _draftFee, _settleFee
        address _governor,
        uint64[3] _roundStateDurations,
        uint16 _penaltyPct
    ) Court(
        _termDuration,
        _firstTermStartTime,
        _feeToken,
        _fees,
        _governor,
        _roundStateDurations,
        _penaltyPct
    ) public {}

    function init(
        IStaking _staking,
        ICRVoting _voting,
        ISumTree _sumTree,
        ISubscriptions _subscriptions,
        IFinalRound _finalRounds,
        ERC20 _jurorToken,
        uint256 _jurorMinStake,
        uint16 _finalRoundReduction,
        uint256[5] _subscriptionParams // _periodDuration, _feeAmount, _prePaymentPeriods, _latePaymentPenaltyPct, _governorSharePct
    )
        public
    {
        super.init(
            _staking,
            _voting,
            _sumTree,
            _subscriptions,
            _finalRounds,
            _jurorToken,
            _jurorMinStake,
            _finalRoundReduction,
            _subscriptionParams
        );
    }

    function mock_setTime(uint64 time) external {
        mockTime = time;
    }

    function mock_timeTravel(uint64 time) external {
        mockTime += time;
    }

    function mock_setBlockNumber(uint64 bn) external {
        mockBn = bn;
    }

    function mock_blockTravel(uint64 inc) external {
        mockBn += inc;
    }

    // as block numbers here are fake, we need to set this manually beacuse blockhash won't work
    function setTermRandomness() external {
        Term storage draftTerm = terms[termId];
        draftTerm.randomness = keccak256(abi.encodePacked(draftTerm.randomnessBN));
    }

    function getMaxJurorsPerDraftBatch() public pure returns (uint256) {
        return MAX_JURORS_PER_DRAFT_BATCH;
    }

    function getMaxRegularAppealRounds() public pure returns (uint256) {
        return MAX_REGULAR_APPEAL_ROUNDS;
    }

    function getAppealStepFactor() public pure returns (uint64) {
        return APPEAL_STEP_FACTOR;
    }

    function getAdjudicationState(uint256 _disputeId, uint256 _roundId, uint64 _termId) public view returns (AdjudicationState) {
        return _adjudicationStateAtTerm(_disputeId, _roundId, _termId);
    }

    function _time() internal view returns (uint64) {
        return mockTime;
    }

    function _blockNumber() internal view returns (uint64) {
        return mockBn;
    }
}
