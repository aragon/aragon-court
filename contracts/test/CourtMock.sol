pragma solidity ^0.4.24;

import "../Court.sol";


contract CourtMock is Court {
    uint64 internal mockTime = 0;
    uint64 internal mockBn = 0;
    bool internal treeSearchHijacked = false;

    constructor(
        uint64 _termDuration,
        ERC20 _jurorToken,
        ERC20 _feeToken,
        ICRVoting _voting,
        ISumTree _sumTree,
        uint256 _jurorFee,
        uint256 _heartbeatFee,
        uint256 _draftFee,
        uint256 _settleFee,
        uint16 _governanceShare,
        address _governor,
        uint64 _firstTermStartTime,
        uint256 _jurorMinStake,
        uint64[3] _roundStateDurations,
        uint16 _penaltyPct
    ) Court(
        _termDuration,
        _jurorToken,
        _feeToken,
        _voting,
        _sumTree,
        _jurorFee,
        _heartbeatFee,
        _draftFee,
        _settleFee,
        _governanceShare,
        _governor,
        _firstTermStartTime,
        _jurorMinStake,
        _roundStateDurations,
        _penaltyPct
    ) public {}

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

    function mock_hijackTreeSearch() external {
        treeSearchHijacked = true;
    }

    // as block numbers here are fake, we need to set this manually beacuse blockhash won't work
    function setTermRandomness() external {
        Term storage draftTerm = terms[termId];
        draftTerm.randomness = keccak256(abi.encodePacked(draftTerm.randomnessBN));
    }

    function _treeSearch(
        bytes32 _termRandomness,
        uint256 _disputeId,
        uint256 _nextJurorToDraft,
        uint256 _jurorsRequested,
        uint256 _jurorNumber,
        uint256 _sortitionIteration
    )
        internal
        view
        returns (uint256[] keys, uint256[] nodeValues)
    {
        if (!treeSearchHijacked) {
            return super._treeSearch(_termRandomness, _disputeId, _nextJurorToDraft, _jurorsRequested, _jurorNumber, _sortitionIteration);
        }

        keys = new uint256[](_jurorsRequested);
        nodeValues = new uint256[](_jurorsRequested);
        for (uint256 i = 0; i < _jurorsRequested; i++) {
            uint256 key = i % (sumTree.getNextKey() - 1) + 1; // loop, and avoid 0
            keys[i] = key;
            nodeValues[i] = sumTree.getItem(key);
        }
    }

    function mock_sortition(uint256 v) public view returns (address) {
        (uint256 k, ) = sumTree.sortition(v, _time(), false);
        return jurorsByTreeId[k];
    }

    function mock_treeTotalSum() public view returns (uint256) {
        return sumTree.totalSumPresent(_time());
    }

    function getMaxJurorsPerBatch() public pure returns (uint256) {
        return MAX_JURORS_PER_BATCH;
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
