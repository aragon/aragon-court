pragma solidity ^0.5.8;

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
library HexSumTree {
    using Checkpointing for Checkpointing.History;

    string private constant ERROR_UPDATE_OVERFLOW = "SUM_TREE_UPDATE_OVERFLOW";
    string private constant ERROR_KEY_DOES_NOT_EXIST = "SUM_TREE_KEY_DOES_NOT_EXIST";
    string private constant ERROR_SEARCH_OUT_OF_BOUNDS = "SUM_TREE_SEARCH_OUT_OF_BOUNDS";
    string private constant ERROR_MISSING_SEARCH_VALUES = "SUM_TREE_MISSING_SEARCH_VALUES";

    // Constants used to perform tree computations
    uint256 private constant CHILDREN = 16;
    uint256 private constant BITS_IN_NIBBLE = 4;

    // All items are leaves, inserted at height or level zero. The root height will be increasing as new levels are inserted in the tree.
    uint256 private constant ITEMS_LEVEL = 0;

    // Tree nodes are identified with a 32-bytes length key. Leaves are identified with consecutive incremental keys
    // starting with 0x0000000000000000000000000000000000000000000000000000000000000000, while non-leaf nodes' keys
    // are computed based on their level and their children keys.
    uint256 private constant BASE_KEY = 0;

    // Timestamp used to checkpoint the first value of the tree height during initialization
    uint64 private constant INITIALIZATION_INITIAL_TIME = uint64(0);

    /**
    * @dev The tree is stored using the following structure:
    *      - nodes: A mapping indexed by a pair (level, key) with a history of the values for each node.
    *      - height: A history of the heights of the tree. Minimum height is 1, a root with 16 children.
    *      - nextKey: The next key to be used to identify the next new value that will be inserted into the tree.
    */
    struct Tree {
        uint256 nextKey;
        Checkpointing.History height;
        mapping (uint256 => mapping (uint256 => Checkpointing.History)) nodes; // level -> key -> value
    }

    /**
    * @dev Search params to traverse the tree caching previous results:
    *      - time: Point in time to query the values being searched, this value shouldn't change during a search
    *      - level: Level being analyzed for the search, it starts at the level under the root and decrements till the leaves
    *      - parentKey: Key of the parent of the nodes being analyzed at the given level for the search
    *      - foundValues: Number of values in the list being searched that were already found, it will go from 0 until the size of the list
    *      - visitedTotal: Total sum of values that were already visited during the search, it will fo from 0 until the tree total
    */
    struct SearchParams {
        uint64 time;
        uint256 level;
        uint256 parentKey;
        uint256 foundValues;
        uint256 visitedTotal;
    }

    /**
    * @dev Initialize tree setting the next key and first height checkpoint
    */
    function init(Tree storage self) internal {
        self.height.add(INITIALIZATION_INITIAL_TIME, ITEMS_LEVEL + 1);
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
        // always incrementing, starting from zero. Add a new level if necessary.
        uint256 key = self.nextKey++;
        _addLevelIfNecessary(self, key, _time);

        // If the new value is not zero, first set the value of the new leaf node, then add a new level at the top of
        // the tree if necessary, and finally update sums cached in all the non-leaf nodes.
        if (_value > 0) {
            _add(self, ITEMS_LEVEL, key, _time, _value);
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
        _add(self, ITEMS_LEVEL, _key, _time, _value);

        // Update sums cached in the non-leaf nodes. Note that overflows are being checked at the end of the whole update.
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
        _add(self, ITEMS_LEVEL, _key, _time, newValue);

        // Update sums cached in the non-leaf nodes. Note that overflows is being checked at the end of the whole update.
        _updateSums(self, _key, _time, _delta, _positive);
    }

    /**
     * @dev Search a list of values in the tree at a given point in time. It will return a list with the nearest
     *      high value in case a value cannot be found. This function assumes the given list of given values to be
     *      searched is in ascending order. In case of searching a value out of bounds, it will return zeroed results.
     * @param _values Ordered list of values to be searched in the tree
     * @param _time Point in time to query the values being searched
     * @return keys List of keys found for each requested value in the same order
     * @return values List of node values found for each requested value in the same order
     */
    function search(Tree storage self, uint256[] memory _values, uint64 _time) internal view
        returns (uint256[] memory keys, uint256[] memory values)
    {
        require(_values.length > 0, ERROR_MISSING_SEARCH_VALUES);

        // Throw out-of-bounds error if there are no items in the tree or the highest value being searched is greater than the total
        uint256 total = getTotalAt(self, _time, true);
        require(total > 0 && total >= _values[_values.length - 1], ERROR_SEARCH_OUT_OF_BOUNDS);

        // Build search params for the first iteration
        uint256 rootLevel = getHeightAt(self, _time);
        SearchParams memory searchParams = SearchParams(_time, rootLevel - 1, BASE_KEY, 0, 0);

        // These arrays will be used to fill in the results. We are passing them as parameters to avoid extra copies
        uint256 length = _values.length;
        keys = new uint256[](length);
        values = new uint256[](length);
        _search(self, _values, searchParams, keys, values);
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
        return getNode(self, ITEMS_LEVEL, _key);
    }

    /**
    * @dev Tell the value of a certain leaf indexed by a given key at a given point in time
    * @param _key Key of the leaf node querying the value of
    * @param _time Point in time to query the value of the requested leaf
    */
    function getItemAt(Tree storage self, uint256 _key, uint64 _time) internal view returns (uint256) {
        return getNodeAt(self, ITEMS_LEVEL, _key, _time);
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
        for (uint256 level = ITEMS_LEVEL + 1; level <= currentHeight; level++) {
            // Build a mask to get the key of the ancestor at a certain level. For example:
            // Level  0: leaves don't have children
            // Level  1: 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff0 (up to 16 leaves)
            // Level  2: 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00 (up to 32 leaves)
            // ...
            // Level 63: 0x0000000000000000000000000000000000000000000000000000000000000000 (up to 16^64 leaves - tree max height)
            mask = mask << BITS_IN_NIBBLE;

            // The key of the ancestor at that level "i" is equivalent to the "(64 - i)-th" most significant nibbles
            // of the ancestor's key of the previous level "i - 1". Thus, we can compute the key of an ancestor at a
            // certain level applying the mask to the ancestor's key of the previous level. Note that for the first
            // iteration, the key of the ancestor of the previous level is simply the key of the leaf being updated.
            ancestorKey = ancestorKey & mask;

            // Note that we are safe to avoid SafeMath here since overflows will be caught by the checkpointing lib since
            // it works with uint192 values, or at the end of the update when checking the the total stored at the root.
            uint256 lastValue = getNode(self, level, ancestorKey);
            uint256 newValue = _positive ? lastValue + _delta : lastValue - _delta;
            _add(self, level, ancestorKey, _time, newValue);
        }

        // Check if there was an overflow. Note that we only need to check the value stored in the root since the
        // sum only increases going up through the tree.
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
            // Max height allowed for the tree is 64 since we are using node keys of 32 bytes. However, note that we
            // are not checking if said limit has been hit when inserting new leaves to the tree, for the purpose of
            // this system having 2^256 items inserted is unrealistic.
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
     * @dev Recursive pre-order traversal function
     *      Every time it checks a node, it traverses the input array to find the initial subset of elements that are
     *      below its accumulated value and passes that sub-array to the next iteration. Actually, the array is always
     *      the same, to avoid making extra copies, it just passes the number of values already found , to avoid
     *      checking values that went through a different branch. The same happens with the result lists of keys and
     *      values, these are the same on every recursion step. The visited total is carried over each iteration to
     *      avoid having to subtract all elements in the array.
     * @param _values Ordered list of values to be searched in the tree
     * @param _params Search parameters for the current recursive step
     * @param _resultKeys List of keys found for each requested value in the same order
     * @param _resultValues List of node values found for each requested value in the same order
     */
    function _search(
        Tree storage self,
        uint256[] memory _values,
        SearchParams memory _params,
        uint256[] memory _resultKeys,
        uint256[] memory _resultValues
    )
        private view
    {
        uint256 levelKeyLessSignificantNibble = _params.level * BITS_IN_NIBBLE;
        for (uint256 childNumber = 0; childNumber < CHILDREN; childNumber++) {
            // Return if we already found enough values
            if (_params.foundValues >= _values.length) {
                break;
            }

            // Build child node key shifting the child number to the position of the less significant nibble of
            // the keys for the level being analyzed, and adding it to the key of the parent node. For example,
            // for a tree with height 5, if we are checking the children of the second node of the level 4, whose
            // key is 0x0000000000000000000000000000000000000000000000000000000000001000, its children keys are:
            // Child  0: 0x0000000000000000000000000000000000000000000000000000000000001000
            // Child  1: 0x0000000000000000000000000000000000000000000000000000000000001100
            // Child  2: 0x0000000000000000000000000000000000000000000000000000000000001200
            // ...
            // Child 15: 0x0000000000000000000000000000000000000000000000000000000000001f00
            // Note that this cannot overflow since the root key of the highest tree is 0x0 and its highest child
            // key is 16^64, which is 2^256
            uint256 childNodeKey = _params.parentKey + (childNumber << levelKeyLessSignificantNibble);
            uint256 childNodeValue = getNodeAt(self, _params.level, childNodeKey, _params.time, true);

            // Check how many values belong to the subtree of this node. As they are ordered, it will be a contiguous
            // subset starting from the beginning, so we only need to know the length of that subset.
            uint256 newVisitedTotal = _params.visitedTotal + childNodeValue;
            uint256 subtreeIncludedValues = _getValuesIncludedInSubtree(_values, _params.foundValues, newVisitedTotal);

            // If there are some values included in the subtree of the child node, visit them
            if (subtreeIncludedValues > 0) {
                // If the child node being analyzed is a leaf, add it to the list of results a number of times equals
                // to the number of values that were included in it. Otherwise, descend one level
                if (_params.level == ITEMS_LEVEL) {
                    _copyFoundNode(_params.foundValues, subtreeIncludedValues, childNodeKey, _resultKeys, childNodeValue, _resultValues);
                } else {
                    SearchParams memory nextLevelParams = SearchParams(_params.time, _params.level - 1, childNodeKey, _params.foundValues, _params.visitedTotal);
                    _search(self, _values, nextLevelParams, _resultKeys, _resultValues);
                }
                // Update the number of values that were already found
                _params.foundValues += subtreeIncludedValues;
            }
            // Update the visited total for the next node in this level
            _params.visitedTotal = newVisitedTotal;
        }
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
        // Height 64: 0x0000000000000000000000000000000000000000000000000000000000000000 (up to 16^64 keys - tree max height)
        uint256 shift = _currentHeight * BITS_IN_NIBBLE;
        uint256 mask = uint256(-1) << shift;

        // Check if the given key can be represented in the tree with the current given height using the mask.
        return (_newKey & mask) != 0;
    }

    /**
    * @dev Private function to tell how many values of a list can be found in a subtree
    * @param _values List of values being searched in ascending order
    * @param _foundValues Number of values that were already found and should be ignore
    * @param _subtreeTotal Total sum of the given subtree to check the numbers that are included in it
    * @return Number of values in the list that are included in the given subtree
    */
    function _getValuesIncludedInSubtree(uint256[] memory _values, uint256 _foundValues, uint256 _subtreeTotal) private pure returns (uint256) {
        // If the given subtree total is zero, we already know any value will be included in it
        if (_subtreeTotal == 0) {
            return 0;
        }

        // Otherwise, look for all the values that can be found in the given subtree
        uint256 i = _foundValues;
        while (i < _values.length && _values[i] <= _subtreeTotal) {
            i++;
        }
        return i - _foundValues;
    }

    /**
    * @dev Private function to copy a node a given number of times to a results list. This function assumes the given
    *      results list have enough size to support the requested copy.
    * @param _from Index of the results list to start copying the given node
    * @param _times Number of times the given node will be copied
    * @param _key Key of the node to be copied
    * @param _resultKeys Lists of key results to copy the given node key to
    * @param _value Value of the node to be copied
    * @param _resultValues Lists of value results to copy the given node value to
    */
    function _copyFoundNode(
        uint256 _from,
        uint256 _times,
        uint256 _key,
        uint256[] memory _resultKeys,
        uint256 _value,
        uint256[] memory _resultValues
    )
        private pure
    {
        for (uint256 i = 0; i < _times; i++) {
            _resultKeys[_from + i] = _key;
            _resultValues[_from + i] = _value;
        }
    }
}
