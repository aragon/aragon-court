pragma solidity ^0.5.8;

import "./HexSumTree.sol";


/**
* @title JurorsTreeSortition - Library to perform jurors sortition over a `HexSumTree`
*/
library JurorsTreeSortition {
    using HexSumTree for HexSumTree.Tree;

    string internal constant ERROR_SORTITION_LENGTHS_MISMATCH = "TREE_SORTITION_LENGTHS_MISMATCH";

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
        // Note that the low bound will be always equal to the previous high bound incremented by one, or one for the
        // first iteration. Thus, we can make sure we are not excluding any juror from the tree.
        uint256 totalActiveBalance = tree.getTotalAt(_termId, true);
        uint256 ratio = totalActiveBalance / _roundRequestedJurors;
        low = _selectedJurors == 0 ? 1 : (_selectedJurors * ratio) + 1;

        // This function assumes that `_roundRequestedJurors` is greater than or equal to `newSelectedJurors`
        uint256 newSelectedJurors = _selectedJurors + _batchRequestedJurors;
        bool lastBatch = newSelectedJurors == _roundRequestedJurors;

        // If we are computing bounds for the last batch, make sure we include the last inserted juror
        high = lastBatch ? totalActiveBalance : (newSelectedJurors * ratio);
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
        // Calculate the interval to be used to search the balances in the tree. Since we are using a modulo function
        // to compute the random balances to be searched, we add one to the difference to make sure the last number
        // of the range is also included. For example, to compute a range [1,10] we need to compute using modulo 10.
        uint256 interval = _highBatchBound - _lowBatchBound + 1;
        uint256[] memory balances = new uint256[](_batchRequestedJurors);

        // Compute an ordered list of random active balance to be searched in the jurors tree
        for (uint256 batchJurorNumber = 0; batchJurorNumber < _batchRequestedJurors; batchJurorNumber++) {
            balances[batchJurorNumber] = _computeRandomBalance(_randomnessHash, batchJurorNumber, _lowBatchBound, interval);
            for (uint256 i = batchJurorNumber; i > 0 && balances[i] < balances[i - 1]; i--) {
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
