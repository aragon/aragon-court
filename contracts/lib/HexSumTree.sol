pragma solidity ^0.4.24;

// TODO: import from Staking (or somewhere else)
import "./Checkpointing.sol";


/**
* @title HexSumTree - Library to operate checkpointed 16-ary (hex) sum trees.
* @dev A sum tree is a particular case of a tree where the value of a node is equal to the sum of the values of its
*      children. This library provides a set of functions to operate 16-ary sum trees, i.e. trees where every non-leaf
*      node has 16 children and its value is equivalent to the sum of the values of all of them. Additionally, a
*      checkpointed tree means that each time a value on a node is updated, its previous value will be saved to allow
*      accessing historic information.
*
*      Example of a checkpointed binary sum tree:
*
*                                          CURRENT                                      PREVIOUS
*
*             Level 2                        100  ---------------------------------------- 70
*                                       ______|_______                               ______|_______
*                                      /              \                             /              \
*             Level 1                 34              66 ------------------------- 23              47
*                                _____|_____      _____|_____                 _____|_____      _____|_____
*                               /           \    /           \               /           \    /           \
*             Level 0          22           12  53           13 ----------- 22            1  17           30
*
*/
library HexSumTree { // TODO: rename to CheckpointedHexSumTree?
    using Checkpointing for Checkpointing.History;

    string private constant ERROR_UPDATE_OVERFLOW = "SUM_TREE_UPDATE_OVERFLOW";
    string private constant ERROR_KEY_DOES_NOT_EXIST = "SUM_TREE_KEY_DOES_NOT_EXIST";

    // Constants used to perform tree computations
    uint256 private constant CHILDREN = 16;
    uint256 private constant BITS_IN_NIBBLE = 4;

    // Leaves are at height or level zero, root height will be increasing as new levels are inserted in the tree
    uint256 private constant LEAVES_LEVEL = 0;

    // Tree nodes are identified with a 32-bytes length key. Leaves are identified with consecutive incremental keys
    // starting with 0x0000000000000000000000000000000000000000000000000000000000000000, while non-leaf nodes' keys
    // are computed based on their level and their children keys.
    uint256 private constant BASE_KEY = 0;

    // Timestamp used to checkpoint the first value of the tree height during initialization
    uint64 private constant INITIALIZATION_INITIAL_TIME = uint64(0);

    /**
    * @dev The tree is stored using the following structure:
    *      - nodes: A mapping indexed by a pair (level, key) with a history of the values for each node.
    *      - height: A history of the heights of the tree.
    *      - nextKey: The next key to be used to identify the next new value that will be inserted into the tree.
    */
    struct Tree {
        uint256 nextKey;
        Checkpointing.History height;
        mapping (uint256 => mapping (uint256 => Checkpointing.History)) nodes; // level -> key -> value
    }

    // TODO: describe
    struct PackedArguments {
        uint256 valuesStart;
        uint256 height;
        uint64 time;
        uint256 accumulatedValue;
        uint256 node;
    }

    /**
    * @dev Initialize tree setting the next key and first height checkpoint
    */
    function init(Tree storage self) internal {
        self.height.add(INITIALIZATION_INITIAL_TIME, LEAVES_LEVEL + 1);
        self.nextKey = BASE_KEY;
    }

    /**
    * @dev Insert a new item to the tree at given point in time
    * @param _time Point in time to register the given value
    * @param _value New numeric value to be added to the tree
    * @return Unique key identifying the new value inserted
    */
    function insert(Tree storage self, uint64 _time, uint256 _value) internal returns (uint256) {
        // As the values are always stored in the leaves of the tree (level 0), the key to index each of them will be
        // always incrementing, starting from zero.
        uint256 key = self.nextKey++;

        // If the new value is not zero, first set the value of the new leaf node, then add a new level at the top of
        // the tree if necessary, and finally update sums cached in all the non-leaf nodes.
        if (_value > 0) {
            // TODO: tree height is never checked to be under 64, at least add a comment telling why
            _add(self, LEAVES_LEVEL, key, _time, _value);
            _addLevelIfNecessary(self, key, _time);
            _updateSums(self, key, _time, _value, true);
        }
        return key;
    }

    /**
    * @dev Set the value of a leaf node indexed by its key at given point in time
    * @param _time Point in time to set the given value
    * @param _key Key of the leaf node to be set in the tree
    * @param _value New numeric value to be set for the given key
    */
    function set(Tree storage self, uint256 _key, uint64 _time, uint256 _value) internal {
        require(_key < self.nextKey, ERROR_KEY_DOES_NOT_EXIST);

        // Set the new value for the requested leaf node
        uint256 lastValue = getItem(self, _key);
        _add(self, LEAVES_LEVEL, _key, _time, _value);

        // Update sums cached in the non-leaf nodes. Note that overflows is being checked at the end of the whole update.
        if (_value > lastValue) {
            _updateSums(self, _key, _time, _value - lastValue, true);
        } else if (_value < lastValue) {
            _updateSums(self, _key, _time, lastValue - _value, false);
        }
    }

    /**
    * @dev Update the value of a non-leaf node indexed by its key at given point in time based on a delta
    * @param _key Key of the leaf node to be updated in the tree
    * @param _time Point in time to update the given value
    * @param _delta Numeric delta to update the value of the given key
    * @param _positive Boolean to tell whether the given delta should be added to or subtracted from the current value
    */
    function update(Tree storage self, uint256 _key, uint64 _time, uint256 _delta, bool _positive) internal {
        require(_key < self.nextKey, ERROR_KEY_DOES_NOT_EXIST);

        // Update the value of the requested leaf node based on the given delta
        uint256 lastValue = getItem(self, _key);
        uint256 newValue = _positive ? lastValue + _delta : lastValue - _delta;
        _add(self, LEAVES_LEVEL, _key, _time, newValue);

        // Update sums cached in the non-leaf nodes. Note that overflows is being checked at the end of the whole update.
        _updateSums(self, _key, _time, _delta, _positive);
    }

    function multiSortition(
        Tree storage self,
        bytes32 _termRandomness,
        uint256 _disputeId,
        uint64 _time,
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
        return multiSortition(self, values, _time);
    }

    /**
     * @notice Performs sortition for several values at once
     * @param _values An array with the values sought in the sortition. Must be ordered ascending.
     * @param _time The checkpoint timestamp at which the sortition is performed
     * @return An array of keys, one for each value in input param (therefore the same size), and in the same order, along with an array of the corresponding node values
     */
    function multiSortition(Tree storage self, uint256[] _values, uint64 _time) internal view returns (uint256[] keys, uint256[] nodeValues) {
        uint256 length = _values.length;
        // those two arrays will be used to fill in the results, they are passed as parameters to avoid extra copies
        keys = new uint256[](length);
        nodeValues = new uint256[](length);
        uint256 height = getHeightAt(self, _time);
        _multiSortition(self, _values, PackedArguments(0, height, _time, 0, BASE_KEY), keys, nodeValues);
    }

    /**
    * @dev Tell the sum of the all the items (leaves) stored in the tree, i.e. value of the root of the tree
    */
    function getTotal(Tree storage self) internal view returns (uint256) {
        uint256 rootLevel = getHeight(self);
        return getNode(self, rootLevel, BASE_KEY);
    }

    /**
    * @dev Tell the sum of the all the items (leaves) stored in the tree, i.e. value of the root of the tree, at a given point in time
    * @param _time Point in time to query the sum of all the items (leaves) stored in the tree
    * @param _recent Boolean indicating whether the given point in time is known to be recent or not
    */
    function getTotalAt(Tree storage self, uint64 _time, bool _recent) internal view returns (uint256) {
        uint256 rootLevel = getHeightAt(self, _time, _recent);
        return getNodeAt(self, rootLevel, BASE_KEY, _time, _recent);
    }

    /**
    * @dev Tell the value of a certain leaf indexed by a given key
    * @param _key Key of the leaf node querying the value of
    */
    function getItem(Tree storage self, uint256 _key) internal view returns (uint256) {
        return getNode(self, LEAVES_LEVEL, _key);
    }

    /**
    * @dev Tell the value of a certain leaf indexed by a given key at a given point in time
    * @param _key Key of the leaf node querying the value of
    * @param _time Point in time to query the value of the requested leaf
    */
    function getItemAt(Tree storage self, uint256 _key, uint64 _time) internal view returns (uint256) {
        return getNodeAt(self, LEAVES_LEVEL, _key, _time);
    }

    /**
    * @dev Tell the value of a certain node indexed by a given (level,key) pair
    * @param _level Level of the node querying the value of
    * @param _key Key of the node querying the value of
    */
    function getNode(Tree storage self, uint256 _level, uint256 _key) internal view returns (uint256) {
        return self.nodes[_level][_key].getLast();
    }

    /**
    * @dev Tell the value of a certain node indexed by a given (level,key) pair at a given point in time
    * @param _level Level of the node querying the value of
    * @param _key Key of the node querying the value of
    * @param _time Point in time to query the value of the requested node
    */
    function getNodeAt(Tree storage self, uint256 _level, uint256 _key, uint64 _time) internal view returns (uint256) {
        return self.nodes[_level][_key].get(_time);
    }

    /**
    * @dev Tell the value of a certain node indexed by a given (level,key) pair at a given point in time
    * @param _level Level of the node querying the value of
    * @param _key Key of the node querying the value of
    * @param _time Point in time to query the value of the requested node
    * @param _recent Boolean indicating whether the given point in time is known to be recent or not
    */
    function getNodeAt(Tree storage self, uint256 _level, uint256 _key, uint64 _time, bool _recent) internal view returns (uint256) {
        return self.nodes[_level][_key].get(_time, _recent);
    }

    /**
    * @dev Tell the height of the tree
    */
    function getHeight(Tree storage self) internal view returns (uint256) {
        return self.height.getLast();
    }

    /**
    * @dev Tell the height of the tree at a given point in time
    * @param _time Point in time to query the height of the tree
    */
    function getHeightAt(Tree storage self, uint64 _time) internal view returns (uint256) {
        return self.height.get(_time);
    }

    /**
    * @dev Tell the height of the tree at a given point in time
    * @param _time Point in time to query the height of the tree
    * @param _recent Boolean indicating whether the given point in time is known to be recent or not
    */
    function getHeightAt(Tree storage self, uint64 _time, bool _recent) internal view returns (uint256) {
        return self.height.get(_time, _recent);
    }

    function getChildren(Tree storage) internal pure returns (uint256) {
        return CHILDREN;
    }

    function getBitsInNibble(Tree storage) internal pure returns (uint256) {
        return BITS_IN_NIBBLE;
    }

    /**
    * @dev Private function to update the values of all the ancestors of the given leaf node based on the delta updated
    * @param _key Key of the leaf node to update the ancestors of
    * @param _time Point in time to update the ancestors' values of the given leaf node
    * @param _delta Numeric delta to update the ancestors' values of the given leaf node
    * @param _positive Boolean to tell whether the given delta should be added to or subtracted from ancestors' values
    */
    function _updateSums(Tree storage self, uint256 _key, uint64 _time, uint256 _delta, bool _positive) private {
        uint256 mask = uint256(-1);
        uint256 ancestorKey = _key;
        uint256 currentHeight = getHeight(self);
        for (uint256 level = 1; level <= currentHeight; level++) {
            // Build a mask to get the key of the ancestor at a certain level. For example:
            // Level  0: leaves don't have children
            // Level  1: 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff0 (up to 16 leaves)
            // Level  2: 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00 (up to 32 leaves)
            // ...
            // Level 63: 0x0000000000000000000000000000000000000000000000000000000000000000 (up to 16^64 leaves - max tree height is 64)
            mask = mask << BITS_IN_NIBBLE;

            // The key of the ancestor at that level "i" is equivalent to the "(64 - i)-th" most significant nibbles
            // of the ancestor's key of the previous level "i - 1". Thus, we can compute the key of an ancestor at a
            // certain level applying the mask to the ancestor's key of the previous level. Note that for the first
            // iteration, the key of the ancestor of the previous level is simply the key of the leaf being updated.
            ancestorKey = ancestorKey & mask;

            // TODO: This is not true, however since the biggest value that can be checkpointed is max uint192, the
            //       biggest addition we can have here is max uint192 * 2, which is smaller than max uint256. In case
            //       of subtraction, it will end being greater than max uint192 as well.
            // Invariant: this will never underflow.
            uint256 lastValue = getNode(self, level, ancestorKey);
            uint256 newValue = _positive ? lastValue + _delta : lastValue - _delta;
            _add(self, level, ancestorKey, _time, newValue);
        }

        // Check if update overflowed. Note that we only need to check the root value since the sum only increases
        // going up through the tree.
        require(!_positive || getNode(self, currentHeight, ancestorKey) >= _delta, ERROR_UPDATE_OVERFLOW);
    }

    /**
    * @dev Private function to add a new level to the tree based on a new key that will be inserted
    * @param _newKey New key willing to be inserted in the tree
    * @param _time Point in time when the new key will be inserted
    */
    function _addLevelIfNecessary(Tree storage self, uint256 _newKey, uint64 _time) private {
        uint256 currentHeight = getHeight(self);
        if (_shouldAddLevel(currentHeight, _newKey)) {
            uint256 newHeight = currentHeight + 1;
            uint256 rootValue = getNode(self, currentHeight, BASE_KEY);
            _add(self, newHeight, BASE_KEY, _time, rootValue);
            self.height.add(_time, newHeight);
        }
    }

    /**
    * @dev Private function to register a new value in the history of a node at a given point in time
    * @param _level Level of the node to add a new value at a given point in time to
    * @param _key Key of the node to add a new value at a given point in time to
    * @param _time Point in time to register a value for the given node
    * @param _value Numeric value to be registered for the given node at a given point in time
    */
    function _add(Tree storage self, uint256 _level, uint256 _key, uint64 _time, uint256 _value) private {
        self.nodes[_level][_key].add(_time, _value);
    }

    /**
     * @dev Recursive function to descend the Sum Tree.
     *      Every time it checks a node, it traverses the input array to find the initial subset of elements that are
     *      below its accumulated value and passes that sub-array to the next iteration. Actually the array is always
     *      the same, to avoid making exta copies, it just passes the initial index to start checking, to avoid checking
     *      values that went thru a different branch.
     *      The same happens with the "result" arrays for keys and node values: it's always the same on every recursion
     *      step, the same initial index for input values acts as a needle to know where in those arrays the function has to write.
     *      The accumulated value is carried over to next iterations, to avoid having to subtract to all elements in array.
     *      PackedArguments struct is used to avoid "stack too deep" issue.
     */
    function _multiSortition(Tree storage self, uint256[] values, PackedArguments memory packedArguments, uint256[] keys, uint256[] nodeValues) private view {
        // TODO: sortition out of bounds?
        uint256 shift = (packedArguments.height - 1) * BITS_IN_NIBBLE;
        uint256 checkingValue = packedArguments.accumulatedValue;
        for (uint256 i = 0; i < CHILDREN; i++) {
            if (packedArguments.valuesStart >= values.length) {
                break;
            }
            // shift the iterator and add it to node 0x00..0i00 (for height = 3)
            uint256 checkingNodeKey = packedArguments.node + (i << shift); // uint256
            uint256 nodeValue = getNodeAt(self, packedArguments.height - 1, checkingNodeKey, packedArguments.time, true); // fetch always recent values
            checkingValue = checkingValue + nodeValue;

            // Check how many values belong to this node. As they are ordered, it will be a contiguous subset starting from the beginning, so we only need to know the length of that subset
            uint256 newLength = _getNodeValuesLength(values, checkingValue, packedArguments.valuesStart);
            // if the values subset belonging to this node is not empty
            if (newLength > 0) {
                uint256 k;
                // node found at the end of the tree
                if (packedArguments.height == 1) {
                    // add this leaf to the result, one time for each value belonging to it
                    // use input values start index to write in the proper segment of the result arrays, which are global
                    for (k = 0; k < newLength; k++) {
                        keys[packedArguments.valuesStart + k] = checkingNodeKey;
                        nodeValues[packedArguments.valuesStart + k] = nodeValue;
                    }
                } else { // node found at upper levels
                    // recursion step: descend one level
                    _multiSortition(
                        self,
                        values,
                        PackedArguments(
                            packedArguments.valuesStart,
                            packedArguments.height - 1,
                            packedArguments.time,
                            packedArguments.accumulatedValue,
                            checkingNodeKey
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
        uint256 ratio = getTotalAt(self, _time, true) / _jurorNumber;
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

    /**
    * @dev Private function to check if a new key can be added to the tree based on the current height of the tree
    * @param _currentHeight Current height of the tree to check if it supports adding the given key
    * @param _newKey Key willing to be added to the tree with the given current height
    * @return True if the current height of the tree should be increased to add the new key, false otherwise.
    */
    function _shouldAddLevel(uint256 _currentHeight, uint256 _newKey) private pure returns (bool) {
        // Build a mask that will match all the possible keys for the given height. For example:
        // Height  1: 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff0 (up to 16 keys)
        // Height  2: 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00 (up to 32 keys)
        // ...
        // Height 64: 0x0000000000000000000000000000000000000000000000000000000000000000 (up to 16^64 keys - max height is 64)
        uint256 shift = _currentHeight * BITS_IN_NIBBLE;
        uint256 mask = uint256(-1) << shift;

        // Check if the given key can be represented in the tree with the current given height using the mask.
        return (_newKey & mask) != uint256(0);
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
