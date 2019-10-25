pragma solidity ^0.5.8;

import "@aragon/os/contracts/lib/math/SafeMath.sol";

import "./HexSumTree.sol";


/**
* @title JurorsTreeSortition - Library to perform jurors sortition over a `HexSumTree`
*/
library JurorsTreeSortition {
    using SafeMath for uint256;
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
            _termRandomness,
            _disputeId,
            _sortitionIteration,
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
        // No need for SafeMath: the number of round requested jurors is always ensured to be greater than zero in the Court config
        low = _selectedJurors.mul(totalActiveBalance) / _roundRequestedJurors;

        // No need for SafeMath: these are originally uint64
        uint256 newSelectedJurors = _selectedJurors + _batchRequestedJurors;

        // This function assumes that `_roundRequestedJurors` is greater than or equal to `newSelectedJurors`
        // Besides, _roundRequestedJurors can't be zero because firstRoundJurorsNumber and appealStepFactor are checked in Court config
        high = newSelectedJurors.mul(totalActiveBalance) / _roundRequestedJurors;
    }

    /**
    * @dev Get a random list of active balances to be searched in the jurors tree for a given draft batch
    * @param _termRandomness Randomness to compute the seed for the draft
    * @param _disputeId Identification number of the dispute to draft jurors for (for randomness)
    * @param _sortitionIteration Number of sortitions already performed for the given draft (for randomness)
    * @param _batchRequestedJurors Number of jurors to be selected in the given batch of the draft
    * @param _lowBatchBound Low bound to be used for the sortition batch to draft the requested number of jurors
    * @param _highBatchBound High bound to be used for the sortition batch to draft the requested number of jurors
    * @return Random list of active balances to be searched in the jurors tree for the given draft batch
    */
    function _computeSearchRandomBalances(
        bytes32 _termRandomness,
        uint256 _disputeId,
        uint256 _sortitionIteration,
        uint256 _batchRequestedJurors,
        uint256 _lowBatchBound,
        uint256 _highBatchBound
    )
        internal
        pure
        returns (uint256[] memory)
    {
        // Calculate the interval to be used to search the balances in the tree. Since we are using a modulo function to compute the
        // random balances to be searched, intervals will be closed on the left and open on the right, for example [0,10).
        // No need for SafeMath: see function getSearchBatchBounds to check that this is always >= 0
        uint256 interval = _highBatchBound - _lowBatchBound;

        // If the given interval is zero, we don't need to compute a random search
        if (interval == 0) {
            // If the requested number of jurors for the batch was zero, simply return an empty array
            if (_batchRequestedJurors == 0) {
                return new uint256[](0);
            }

            // Otherwise, simply fill the resulting array with the unique bound
            uint256[] memory balances = new uint256[](_batchRequestedJurors);
            for (uint256 batchJurorNumber = 0; batchJurorNumber < _batchRequestedJurors; batchJurorNumber++) {
                balances[batchJurorNumber] = _lowBatchBound;
            }
            return balances;
        }

        // If the interval was not zero, compute an ordered list of random active balance to be searched in the jurors tree
        uint256[] memory balances = new uint256[](_batchRequestedJurors);
        for (uint256 batchJurorNumber = 0; batchJurorNumber < _batchRequestedJurors; batchJurorNumber++) {
            // Compute a random seed using:
            // - The inherent randomness associated to the term from blockhash
            // - The disputeId, so 2 disputes in the same term will have different outcomes
            // - The sortition iteration, to avoid getting stuck if resulting jurors are dismissed due to locked balance
            // - The juror number in this batch
            bytes32 seed = keccak256(abi.encodePacked(_termRandomness, _disputeId, _sortitionIteration, batchJurorNumber));

            // Compute a random active balance to be searched in the jurors tree using the generated seed within the
            // boundaries computed for the current batch.
            // No need for SafeMath: note that the computed balance will be always lower than or equal to the high batch bound given
            // since low + seed % (high - low) <= low + (high - low) <= high.
            balances[batchJurorNumber] = _lowBatchBound + uint256(seed) % interval;

            // Make sure it's ordered, flip values if necessary
            for (uint256 i = batchJurorNumber; i > 0 && balances[i] < balances[i - 1]; i--) {
                uint256 tmp = balances[i - 1];
                balances[i - 1] = balances[i];
                balances[i] = tmp;
            }
        }
        return balances;
    }
}
