pragma solidity ^0.5.8;

import "./HexSumTree.sol";


/**
* @title JurorsTreeSortition - Library to perform jurors sortition over a `HexSumTree`
*/
library JurorsTreeSortition {
    using HexSumTree for HexSumTree.Tree;

    string private constant ERROR_SORTITION_LENGTHS_MISMATCH = "TREE_SORTITION_LENGTHS_MISMATCH";

    /**
    * @dev Search random items in the tree based on certain restrictions
    * @param _termRandomness Randomness to compute the seed for the draft
    * @param _disputeId Identification number of the dispute to draft jurors for
    * @param _termId Current term when the draft is being computed
    * @param _selectedJurors Number of jurors already selected for the draft
    * @param _batchRequestedJurors Number of jurors to be selected in the given batch of the draft
    * @param _roundRequestedJurors Total number of jurors requested to be drafted
    * @param _sortitionIteration Number of sortitions already performed for the given draft
    * @return jurorsIds List of juror ids obtained based on the requested search
    * @return jurorsBalances List of active balances for each juror obtained based on the requested search
    */
    function batchedRandomSearch(
        HexSumTree.Tree storage tree,
        bytes32 _termRandomness,
        uint256 _disputeId,
        uint64 _termId,
        uint256 _selectedJurors,
        uint256 _batchRequestedJurors,
        uint256 _roundRequestedJurors,
        uint256 _sortitionIteration
    )
        internal
        view
        returns (uint256[] memory jurorsIds, uint256[] memory jurorsBalances)
    {
        (uint256 low, uint256 high) = getSearchBatchBounds(tree, _termId, _selectedJurors, _batchRequestedJurors, _roundRequestedJurors);
        uint256[] memory balances = _computeSearchRandomBalances(
            _randomnessHash(_termRandomness, _disputeId, _sortitionIteration),
            _batchRequestedJurors,
            low,
            high
        );

        (jurorsIds, jurorsBalances) = tree.search(balances, _termId);

        require(jurorsIds.length == jurorsBalances.length, ERROR_SORTITION_LENGTHS_MISMATCH);
        require(jurorsIds.length == _batchRequestedJurors, ERROR_SORTITION_LENGTHS_MISMATCH);
    }

    /**
    * @dev Get the bounds for a draft batch based on the active balances of the jurors
    * @param _termId Term id of the active balances that will be used to compute the boundaries
    * @param _selectedJurors Number of jurors already selected for the draft
    * @param _batchRequestedJurors Number of jurors to be selected in the given batch of the draft
    * @param _roundRequestedJurors Total number of jurors requested to be drafted
    * @return low Low bound to be used for the sortition to draft the requested number of jurors for the given batch
    * @return high High bound to be used for the sortition to draft the requested number of jurors for the given batch
    */
    function getSearchBatchBounds(
        HexSumTree.Tree storage tree,
        uint64 _termId,
        uint256 _selectedJurors,
        uint256 _batchRequestedJurors,
        uint256 _roundRequestedJurors
    )
        internal
        view
        returns (uint256 low, uint256 high)
    {
        uint256 totalActiveBalance = tree.getRecentTotalAt(_termId);
        // TODO: SafeMath
        low = _selectedJurors * totalActiveBalance / _roundRequestedJurors;

        uint256 newSelectedJurors = _selectedJurors + _batchRequestedJurors;

        // This function assumes that `_roundRequestedJurors` is greater than or equal to `newSelectedJurors`
        // TODO: SafeMath
        high = newSelectedJurors * totalActiveBalance / _roundRequestedJurors;
    }

    /**
    * @dev Get a random list of active balances to be searched in the jurors tree for a given draft batch
    * @param _randomnessHash Hash to be used as random seed
    * @param _batchRequestedJurors Number of jurors to be selected in the given batch of the draft
    * @param _lowBatchBound Low bound to be used for the sortition batch to draft the requested number of jurors
    * @param _highBatchBound High bound to be used for the sortition batch to draft the requested number of jurors
    * @return Random list of active balances to be searched in the jurors tree for the given draft batch
    */
    function _computeSearchRandomBalances(
        bytes32 _randomnessHash,
        uint256 _batchRequestedJurors,
        uint256 _lowBatchBound,
        uint256 _highBatchBound
    )
        internal
        pure
        returns (uint256[] memory)
    {
        uint256 interval = _highBatchBound - _lowBatchBound;
        uint256[] memory balances = new uint256[](_batchRequestedJurors);

        // Compute an ordered list of random active balance to be searched in the jurors tree
        for (uint256 batchJurorNumber = 0; batchJurorNumber < _batchRequestedJurors; batchJurorNumber++) {
            balances[batchJurorNumber] = _computeRandomBalance(_randomnessHash, batchJurorNumber, _lowBatchBound, interval);
            // Make sure it's ordered
            for (uint256 i = batchJurorNumber; i > 0 && balances[i] < balances[i - 1]; i--) {
                // Flip values
                uint256 tmp = balances[i - 1];
                balances[i - 1] = balances[i];
                balances[i] = tmp;
            }
        }
        return balances;
    }

    /**
    * @dev Get a random active balance to be searched in the jurors tree for a given juror number of the draft batch
    * @param _randomnessHash Hash to be used as random seed
    * @param _batchJurorNumber Number of the juror to be selected in the given batch of the draft
    * @param _lowBatchBound Low bound to be used for the sortition batch to draft the requested juror number
    * @param _interval Bounds interval to be used for the sortition batch to draft the requested juror number
    * @return Random active balance to be searched in the jurors tree for the given juror number of the draft batch
    */
    function _computeRandomBalance(
        bytes32 _randomnessHash,
        uint256 _batchJurorNumber,
        uint256 _lowBatchBound,
        uint256 _interval
    )
        internal
        pure
        returns (uint256)
    {
        // Compute a random seed using the given randomness hash and the juror number
        bytes32 seed = keccak256(abi.encodePacked(_randomnessHash, _batchJurorNumber));

        // Compute a random active balance to be searched in the jurors tree using the generated seed within the
        // boundaries computed for the current batch.
        return _lowBatchBound + uint256(seed) % _interval;
    }

    /**
    * @dev Get the randomness hash to be used as the random seed for the jurors sortition for a given term and dispute
    * @param _termRandomness Randomness hash of a certain term to draft jurors
    * @param _disputeId Identification number of the dispute to draft jurors for
    * @param _sortitionIteration Number of sortitions already performed for the given draft
    * @return Randomness hash to be used as the random seed for jurors sortition
    */
    function _randomnessHash(bytes32 _termRandomness, uint256 _disputeId, uint256 _sortitionIteration)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(_termRandomness, _disputeId, _sortitionIteration));
    }
}
