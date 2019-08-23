pragma solidity ^0.4.24;

import "./HexSumTreeMock.sol";
import "../../lib/JurorsTreeSortition.sol";


contract JurorsTreeSortitionMock is HexSumTreeMock {
    using JurorsTreeSortition for HexSumTree.Tree;

    function multiSortition(
        bytes32 _termRandomness,
        uint256 _disputeId,
        uint64 _termId,
        uint256 _selectedJurors,
        uint256 _batchRequestedJurors,
        uint256 _roundRequestedJurors,
        uint256 _sortitionIteration
    )
        public
        view
        returns (uint256[] jurorsIds, uint256[] jurorsBalances)
    {
        return tree.multiSortition(_termRandomness, _disputeId, _termId, _selectedJurors, _batchRequestedJurors, _roundRequestedJurors, _sortitionIteration);
    }

    function getActiveBalancesBatchBounds(uint64 _termId, uint256 _selectedJurors, uint256 _batchRequestedJurors, uint256 _roundRequestedJurors)
        public
        view
        returns (uint256, uint256)
    {
        return tree.getActiveBalancesBatchBounds(_termId, _selectedJurors, _batchRequestedJurors, _roundRequestedJurors);
    }

    function computeSearchRandomBalances(
        bytes32 _randomnessHash,
        uint256 _batchRequestedJurors,
        uint256 _lowActiveBalanceBatchBound,
        uint256 _highActiveBalanceBatchBound
    )
        public
        pure
        returns (uint256[])
    {
        return JurorsTreeSortition._computeSearchRandomBalances(_randomnessHash, _batchRequestedJurors, _lowActiveBalanceBatchBound, _highActiveBalanceBatchBound);
    }

    function computeRandomBalance(
        bytes32 _randomnessHash,
        uint256 _batchJurorNumber,
        uint256 _lowActiveBalanceBatchBound,
        uint256 _activeBalanceInterval
    )
        public
        pure
        returns (uint256)
    {
        return JurorsTreeSortition._computeRandomBalance(_randomnessHash, _batchJurorNumber, _lowActiveBalanceBatchBound, _activeBalanceInterval);
    }
}
