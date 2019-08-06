pragma solidity ^0.4.24;

// TODO: import from Staking (or somewhere else)
import "./Checkpointing.sol";


library HexSumTree {
    using Checkpointing for Checkpointing.History;

    struct Tree {
        uint256 nextKey;
        uint256 rootDepth;
        mapping (uint256 => mapping (uint256 => Checkpointing.History)) nodes; // depth -> key -> value
    }

    struct PackedArguments {
        uint256 valuesStart;
        uint256 depth;
        uint64 time;
        bool past;
        uint256 accumulatedValue;
        uint256 node;
    }

    /* @dev
     * If you change any of the following 3 constants, make sure that:
     * 2^BITS_IN_NIBBLE = CHILDREN
     * BITS_IN_NIBBLE * MAX_DEPTH = 256
     */
    uint256 private constant CHILDREN = 16;
    //uint256 private constant MAX_DEPTH = 64;
    uint256 private constant BITS_IN_NIBBLE = 4;
    uint256 private constant INSERTION_DEPTH = 0;
    uint256 private constant BASE_KEY = 0; // tree starts on the very left

    string private constant ERROR_SORTITION_OUT_OF_BOUNDS = "SUM_TREE_SORTITION_OUT_OF_BOUNDS";
    string private constant ERROR_NEW_KEY_NOT_ADJACENT = "SUM_TREE_NEW_KEY_NOT_ADJACENT";
    string private constant ERROR_UPDATE_OVERFLOW = "SUM_TREE_UPDATE_OVERFLOW";
    string private constant ERROR_INEXISTENT_ITEM = "SUM_TREE_INEXISTENT_ITEM";

    function init(Tree storage self) internal {
        self.rootDepth = INSERTION_DEPTH + 1;
        self.nextKey = BASE_KEY;
    }

    function insert(Tree storage self, uint64 time, uint256 value) internal returns (uint256) {
        uint256 key = self.nextKey;
        self.nextKey++;

        if (value > 0) {
            _set(self, key, time, value);
        }

        return key;
    }

    function set(Tree storage self, uint256 key, uint64 time, uint256 value) internal {
        require(key <= self.nextKey, ERROR_NEW_KEY_NOT_ADJACENT);
        _set(self, key, time, value);
    }

    function update(Tree storage self, uint256 key, uint64 time, uint256 delta, bool positive) internal {
        require(key < self.nextKey, ERROR_INEXISTENT_ITEM);

        uint256 oldValue = self.nodes[INSERTION_DEPTH][key].getLast();
        self.nodes[INSERTION_DEPTH][key].add(time, positive ? oldValue + delta : oldValue - delta);

        _updateSums(self, key, time, delta, positive);
    }

    function sortition(Tree storage self, uint256 value, uint64 time, bool past) internal view returns (uint256 key, uint256 nodeValue) {
        require(totalSumPast(self, time) > value, ERROR_SORTITION_OUT_OF_BOUNDS);

        return _sortition(self, value, BASE_KEY, self.rootDepth, time, past);
    }

    function randomSortition(Tree storage self, uint256 seed, uint64 time, bool past) internal view returns (uint256 key, uint256 nodeValue) {
        return _sortition(self, seed % totalSumPast(self, time), BASE_KEY, self.rootDepth, time, past);
    }

    function multiSortition(
        Tree storage self,
        bytes32 _termRandomness,
        uint256 _disputeId,
        uint64 _time,
        bool _past,
        uint256 _filledSeats,
        uint256 _jurorsRequested,
        uint256 _jurorNumber,
        uint256 _sortitionIteration
    )
        internal
        view
        returns (uint256[] keys, uint256[] nodeValues)
    {
        (uint256 stakeFrom, uint256 stakeTo) = _getStakeBounds(self, _time, _filledSeats, _jurorsRequested, _jurorNumber);
        uint256[] memory values = _getOrderedValues(_termRandomness, _disputeId, _time, _filledSeats, _jurorsRequested, _jurorNumber, _sortitionIteration, stakeFrom, stakeTo);
        return multiSortition(self, values, _time, _past);
    }

    /**
     * @notice Performs sortition for several values at once
     * @param values An array with the values sought in the sortition. Must be ordered ascending.
     * @param time The checkpoint timestamp at which the sortition is performed
     * @param past If true, it means that we are seeking a checkpoint in the past, therefore when descending the sum tree it will use binary searches for checkpoints. Otherwise, it will use linear searches from the end, as we are looking for the last or the previous one.
     * @return An array of keys, one for each value in input param (therefore the same size), and in the same order, along with an array of the corresponding node values
     */
    function multiSortition(Tree storage self, uint256[] values, uint64 time, bool past) internal view returns (uint256[] keys, uint256[] nodeValues) {
        uint256 length = values.length;
        // those two arrays will be used to fill in the results, they are passed as parameters to avoid extra copies
        keys = new uint256[](length);
        nodeValues = new uint256[](length);
        _multiSortition(self, values, PackedArguments(0, self.rootDepth, time, past, 0, BASE_KEY), keys, nodeValues);
    }

    function totalSum(Tree storage self) internal view returns (uint256) {
        return self.nodes[self.rootDepth][BASE_KEY].getLast();
    }

    function totalSumPresent(Tree storage self, uint64 currentTime) internal view returns (uint256) {
        return self.nodes[self.rootDepth][BASE_KEY].getLastPresent(currentTime);
    }

    function totalSumPast(Tree storage self, uint64 time) internal view returns (uint256) {
        return self.nodes[self.rootDepth][BASE_KEY].get(time);
    }

    function get(Tree storage self, uint256 depth, uint256 key) internal view returns (uint256) {
        return self.nodes[depth][key].getLast();
    }

    function getPresent(Tree storage self, uint256 depth, uint256 key, uint64 currentTime) internal view returns (uint256) {
        return self.nodes[depth][key].getLastPresent(currentTime);
    }

    function getPast(Tree storage self, uint256 depth, uint256 key, uint64 time) internal view returns (uint256) {
        return self.nodes[depth][key].get(time);
    }

    function getItem(Tree storage self, uint256 key) internal view returns (uint256) {
        return self.nodes[INSERTION_DEPTH][key].getLast();
    }

    function getItemPresent(Tree storage self, uint256 key, uint64 currentTime) internal view returns (uint256) {
        return self.nodes[INSERTION_DEPTH][key].getLastPresent(currentTime);
    }

    function getItemPast(Tree storage self, uint256 key, uint64 time) internal view returns (uint256) {
        return self.nodes[INSERTION_DEPTH][key].get(time);
    }

    function sharedPrefix(uint256 depth, uint256 key) internal pure returns (uint256) {
        uint256 shift = depth * BITS_IN_NIBBLE;
        uint256 mask = uint256(-1) << shift;
        uint keyAncestor = key & mask;

        if (keyAncestor != BASE_KEY) {
            return depth + 1;
        }

        return depth;
    }

    function getChildren(Tree storage) internal pure returns (uint256) {
        return CHILDREN;
    }

    function getBitsInNibble(Tree storage) internal pure returns (uint256) {
        return BITS_IN_NIBBLE;
    }

    function _set(Tree storage self, uint256 key, uint64 time, uint256 value) private {
        uint256 oldValue = self.nodes[INSERTION_DEPTH][key].getLast();
        self.nodes[INSERTION_DEPTH][key].add(time, value);

        if (value > oldValue) {
            _updateSums(self, key, time, value - oldValue, true);
        } else if (value < oldValue) {
            _updateSums(self, key, time, oldValue - value, false);
        }
    }

    function _updateSums(Tree storage self, uint256 key, uint64 time, uint256 delta, bool positive) private {
        uint256 newRootDepth = sharedPrefix(self.rootDepth, key);

        if (self.rootDepth != newRootDepth) {
            self.nodes[newRootDepth][BASE_KEY].add(time, self.nodes[self.rootDepth][BASE_KEY].getLast());
            self.rootDepth = newRootDepth;
        }

        uint256 mask = uint256(-1);
        uint256 ancestorKey = key;
        for (uint256 i = 1; i <= self.rootDepth; i++) {
            mask = mask << BITS_IN_NIBBLE;
            ancestorKey = ancestorKey & mask;

            // Invariant: this will never underflow.
            self.nodes[i][ancestorKey].add(time, positive ? self.nodes[i][ancestorKey].getLast() + delta : self.nodes[i][ancestorKey].getLast() - delta);
        }
        // it's only needed to check the last one, as the sum increases going up through the tree
        require(!positive || self.nodes[self.rootDepth][ancestorKey].getLast() >= delta, ERROR_UPDATE_OVERFLOW);
    }

    function _sortition(Tree storage self, uint256 value, uint256 node, uint256 depth, uint64 time, bool past) private view returns (uint256 key, uint256 nodeValue) {
        uint256 checkedValue = 0; // Can optimize by having checkedValue = value - remainingValue

        uint256 checkingLevel = depth - 1;
        // Invariant: node has 0's "after the depth" (so no need for masking)
        // TODO: removed because of stack too deep issue
        //uint256 shift = checkingLevel * BITS_IN_NIBBLE;
        uint256 parentNode = node;
        uint256 child;
        uint256 checkingNode;
        uint256 nodeSum;
        for (; checkingLevel > INSERTION_DEPTH; checkingLevel--) {
            for (child = 0; child < CHILDREN; child++) {
                // shift the iterator and add it to node 0x00..0i00 (for depth = 3)
                checkingNode = parentNode + (child << (checkingLevel * BITS_IN_NIBBLE)/* shift */);

                // TODO: remove one??
                if (past) {
                    nodeSum = self.nodes[checkingLevel][checkingNode].get(time);
                } else {
                    nodeSum = self.nodes[checkingLevel][checkingNode].getLastPresent(time);
                }
                if (checkedValue + nodeSum <= value) { // not reached yet, move to next child
                    checkedValue += nodeSum;
                } else { // value reached, move to next level
                    parentNode = checkingNode;
                    break;
                }
            }
            //shift = shift - BITS_IN_NIBBLE;
        }
        // Leaves level:
        for (child = 0; child < CHILDREN; child++) {
            checkingNode = parentNode + child;
            if (past) {
                nodeSum = self.nodes[INSERTION_DEPTH][checkingNode].get(time);
            } else {
                nodeSum = self.nodes[INSERTION_DEPTH][checkingNode].getLastPresent(time);
            }
            if (checkedValue + nodeSum <= value) { // not reached yet, move to next child
                checkedValue += nodeSum;
            } else { // value reached
                return (checkingNode, nodeSum);
            }
        }
        // Invariant: this point should never be reached
    }

    /**
     * @dev Recursive function to descend the Sum Tree.
     *      Every time it checks a node, it traverses the input array to find the initial subset of elements that are below its accumulated value and passes that sub-array to the next iteration. Actually the array is always the same, to avoid making exta copies, it just passes the initial index to start checking, to avoid checking values that went thru a different branch.
     *      The same happens with the "result" arrays for keys and node values: it's always the same on every recursion step, the same initial index for input values acts as a needle to know where in those arrays the function has to write.
     *      The accumulated value is carried over to next iterations, to avoid having to subtract to all elements in array.
     *      PackedArguments struct is used to avoid "stack too deep" issue.
     */
    function _multiSortition(Tree storage self, uint256[] values, PackedArguments memory packedArguments, uint256[] keys, uint256[] nodeValues) private view {
        uint256 shift = (packedArguments.depth - 1) * BITS_IN_NIBBLE;
        uint256 checkingValue = packedArguments.accumulatedValue;
        for (uint256 i = 0; i < CHILDREN; i++) {
            if (packedArguments.valuesStart >= values.length) {
                break;
            }
            // shift the iterator and add it to node 0x00..0i00 (for depth = 3)
            uint256 checkingNode = packedArguments.node + (i << shift); // uint256
            // TODO: find a better way or remove if we only need getLastPresent
            uint256 nodeValue;
            if (packedArguments.past) {
                nodeValue = self.nodes[packedArguments.depth - 1][checkingNode].get(packedArguments.time);
            } else {
                nodeValue = self.nodes[packedArguments.depth - 1][checkingNode].getLastPresent(packedArguments.time);
            }
            checkingValue = checkingValue + nodeValue;

            // Check how many values belong to this node. As they are ordered, it will be a contiguous subset starting from the beginning, so we only need to know the length of that subset
            uint256 newLength = _getNodeValuesLength(values, checkingValue, packedArguments.valuesStart);
            // if the values subset belonging to this node is not empty
            if (newLength > 0) {
                uint256 k;
                // node found at the end of the tree
                if (packedArguments.depth == 1) {
                    // add this leave to the result, one time for each value belonging to it
                    // use input values start index to write in the proper segment of the result arrays, which are global
                    for (k = 0; k < newLength; k++) {
                        keys[packedArguments.valuesStart + k] = checkingNode;
                        nodeValues[packedArguments.valuesStart + k] = nodeValue;
                    }
                } else { // node found at upper levels
                    // recursion step: descend one level
                    _multiSortition(
                        self,
                        values,
                        PackedArguments(
                            packedArguments.valuesStart,
                            packedArguments.depth - 1,
                            packedArguments.time,
                            packedArguments.past,
                            packedArguments.accumulatedValue,
                            checkingNode
                        ),
                        keys,
                        nodeValues
                    );
                }
                // for the next node we don't need to check values that were already assigned
                packedArguments.valuesStart += newLength;
            }
            // carry over already checked value to the next node in this level
            packedArguments.accumulatedValue = checkingValue;
        }
    }

    function _getStakeBounds(Tree storage self, uint64 _time, uint256 _filledSeats, uint256 _jurorsRequested, uint256 _jurorNumber) private view
        returns (uint256 stakeFrom, uint256 stakeTo)
    {
        uint256 ratio = totalSumPresent(self, _time) / _jurorNumber;
        // TODO: roundings?
        stakeFrom = _filledSeats * ratio;
        uint256 newFilledSeats = _filledSeats + _jurorsRequested;
        // TODO: this should never happen
        /*
        if (newFilledSeats > _jurorNumber) {
            newFilledSeats = _jurorNumber;
        }
        */
        stakeTo = newFilledSeats * ratio;
    }

    function _getOrderedValues(
        bytes32 _termRandomness,
        uint256 _disputeId,
        uint64 /* _time */,
        uint256 /* _filledSeats */,
        uint256 _jurorsRequested,
        uint256 /* _jurorNumber */,
        uint256 _sortitionIteration,
        uint256 stakeFrom,
        uint256 stakeTo
    )
        private
        pure
        returns (uint256[] values)
    {
        uint256 stakeInterval = stakeTo - stakeFrom;
        values = new uint256[](_jurorsRequested);
        for (uint256 i = 0; i < _jurorsRequested; i++) {
            bytes32 seed = keccak256(abi.encodePacked(_termRandomness, _disputeId, i, _sortitionIteration));
            uint256 value = stakeFrom + uint256(seed) % stakeInterval;
            values[i] = value;
            // make sure it's ordered
            uint256 j = i;
            while (j > 0 && values[j] < values[j - 1]) {
                // flip them
                uint256 tmp = values[j - 1];
                values[j - 1] = values[j];
                values[j] = tmp;
                j--;
            }
        }
    }

    function _getNodeValuesLength(uint256[] values, uint256 checkingValue, uint256 valuesStart) private pure returns (uint256) {
        uint256 j = valuesStart;
        while (j < values.length && values[j] < checkingValue) {
            j++;
        }
        return j - valuesStart;
    }
}
