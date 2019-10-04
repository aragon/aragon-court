pragma solidity ^0.5.8;

import "./HexSumTreeMock.sol";
import "../../lib/JurorsTreeSortition.sol";


contract JurorsTreeSortitionMock is HexSumTreeMock {
    using JurorsTreeSortition for HexSumTree.Tree;

    function batchedRandomSearch(
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
        returns (uint256[] memory jurorsIds, uint256[] memory activeBalances)
    {
        return tree.batchedRandomSearch(_termRandomness, _disputeId, _termId, _selectedJurors, _batchRequestedJurors, _roundRequestedJurors, _sortitionIteration);
    }

    function getSearchBatchBounds(uint64 _termId, uint256 _selectedJurors, uint256 _batchRequestedJurors, uint256 _roundRequestedJurors)
        public
        view
        returns (uint256 low, uint256 high)
    {
        return tree.getSearchBatchBounds(_termId, _selectedJurors, _batchRequestedJurors, _roundRequestedJurors);
    }

    function computeSearchRandomBalances(
        bytes32 _termRandomness,
        uint256 _disputeId,
        uint256 _sortitionIteration,
        uint256 _batchRequestedJurors,
        uint256 _lowActiveBalanceBatchBound,
        uint256 _highActiveBalanceBatchBound
    )
        public
        pure
        returns (uint256[] memory)
    {
        return JurorsTreeSortition._computeSearchRandomBalances(_termRandomness, _disputeId, _sortitionIteration, _batchRequestedJurors, _lowActiveBalanceBatchBound, _highActiveBalanceBatchBound);
    }
}
