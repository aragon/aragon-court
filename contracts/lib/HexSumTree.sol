pragma solidity ^0.4.24;

import "./Checkpointing.sol"; // TODO: import from Staking (or somewhere else)


library HexSumTree {
    using Checkpointing for Checkpointing.History;

    struct Tree {
        uint256 nextKey;
        uint256 rootDepth;
        mapping (uint256 => mapping (uint256 => Checkpointing.History)) nodes; // depth -> key -> value
    }

    struct PackedArguments {
        uint256 valuesStart;
        uint256 keysLength;
        uint256 depth;
        uint64 time;
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

    function sortition(Tree storage self, uint256 value, uint64 time) internal view returns (uint256 key, uint256 nodeValue) {
        require(totalSumPast(self, time) > value, ERROR_SORTITION_OUT_OF_BOUNDS);

        return _sortition(self, value, BASE_KEY, self.rootDepth, time);
    }

    function randomSortition(Tree storage self, uint256 seed, uint64 time) internal view returns (uint256 key, uint256 nodeValue) {
        return _sortition(self, seed % totalSumPast(self, time), BASE_KEY, self.rootDepth, time);
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

    function _sortition(Tree storage self, uint256 value, uint256 node, uint256 depth, uint64 time) private view returns (uint256 key, uint256 nodeValue) {
        uint256 checkedValue = 0; // Can optimize by having checkedValue = value - remainingValue

        uint256 checkingLevel = depth - 1;
        // Invariant: node has 0's "after the depth" (so no need for masking)
        uint256 shift = checkingLevel * BITS_IN_NIBBLE;
        uint parentNode = node;
        uint256 child;
        uint256 checkingNode;
        uint256 nodeSum;
        for (; checkingLevel > INSERTION_DEPTH; checkingLevel--) {
            for (child = 0; child < CHILDREN; child++) {
                // shift the iterator and add it to node 0x00..0i00 (for depth = 3)
                checkingNode = parentNode + (child << shift);

                // TODO: 3 options
                // - leave it as is
                // -> use always get(time), as Checkpointing already short cuts it
                // - create another version of sortition for historic values, at the cost of repeating even more code
                if (time > 0) {
                    nodeSum = self.nodes[checkingLevel][checkingNode].get(time);
                } else {
                    nodeSum = self.nodes[checkingLevel][checkingNode].getLast();
                }
                if (checkedValue + nodeSum <= value) { // not reached yet, move to next child
                    checkedValue += nodeSum;
                } else { // value reached, move to next level
                    parentNode = checkingNode;
                    break;
                }
            }
            shift = shift - BITS_IN_NIBBLE;
        }
        // Leaves level:
        for (child = 0; child < CHILDREN; child++) {
            checkingNode = parentNode + child;
            // TODO: see above
            if (time > 0) {
                nodeSum = self.nodes[INSERTION_DEPTH][checkingNode].get(time);
            } else {
                nodeSum = self.nodes[INSERTION_DEPTH][checkingNode].getLast();
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
     * @param values Must be ordered ascending
     */
    function multiSortition(Tree storage self, uint256[] values, uint64 time) internal view returns (uint256[] keys) {
        return _multiSortition(self, values, PackedArguments(0, values.length, self.rootDepth, time, 0, BASE_KEY));
    }

    function _multiSortition(Tree storage self, uint256[] values, PackedArguments memory packedArguments) private view returns (uint256[] keys) {
        keys = new uint256[](packedArguments.keysLength);

        uint256 shift = (packedArguments.depth - 1) * BITS_IN_NIBBLE;
        uint256 checkingValue = packedArguments.accumulatedValue;
        uint256 keysIndex = 0;
        for (uint256 i = 0; i < CHILDREN; i++) {
            if (packedArguments.valuesStart >= values.length) {
                break;
            }
            // shift the iterator and add it to node 0x00..0i00 (for depth = 3)
            uint256 checkingNode = packedArguments.node + (i << shift); // uint256
            checkingValue = checkingValue + self.nodes[packedArguments.depth - 1][checkingNode].get(packedArguments.time);

            uint256 newLength = _getNodeValuesLength(values, checkingValue, packedArguments.valuesStart);
            if (newLength > 0) {
                uint256 k;
                if (packedArguments.depth == 1) { // node found at the end of the tree
                    for (k = 0; k < newLength; k++) {
                        keys[keysIndex + k] = checkingNode;
                    }
                } else {
                    uint256[] memory subLevelKeys = _multiSortition(
                        self,
                        values,
                        PackedArguments(packedArguments.valuesStart,
                            newLength,
                            packedArguments.depth - 1,
                            packedArguments.time,
                            packedArguments.accumulatedValue,
                            checkingNode
                        )
                    );
                    for (k = 0; k < newLength; k++) {
                        keys[keysIndex + k] = subLevelKeys[k];
                    }
                }
                packedArguments.valuesStart += newLength;
                keysIndex += newLength;
            }
            packedArguments.accumulatedValue = checkingValue;
        }
        return keys;
    }

    function _getNodeValuesLength(uint256[] values, uint256 checkingValue, uint256 valuesStart) private pure returns (uint256){
        uint256 j = valuesStart;
        while (j < values.length && values[j] < checkingValue) {
            j++;
        }
        return j - valuesStart;
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

    function totalSum(Tree storage self) internal view returns (uint256) {
        return self.nodes[self.rootDepth][BASE_KEY].getLast();
    }

    function totalSumPast(Tree storage self, uint64 time) internal view returns (uint256) {
        return self.nodes[self.rootDepth][BASE_KEY].get(time);
    }

    function get(Tree storage self, uint256 depth, uint256 key) internal view returns (uint256) {
        return self.nodes[depth][key].getLast();
    }

    function getPast(Tree storage self, uint256 depth, uint256 key, uint64 time) internal view returns (uint256) {
        return self.nodes[depth][key].get(time);
    }

    function getItem(Tree storage self, uint256 key) internal view returns (uint256) {
        return self.nodes[INSERTION_DEPTH][key].getLast();
    }

    function getPastItem(Tree storage self, uint256 key, uint64 time) internal view returns (uint256) {
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
    /*
    function sharedPrefix(uint256 depth, uint256 key) internal pure returns (uint256) {
        uint256 shift = depth * BITS_IN_NIBBLE;
        uint256 mask = uint256(-1) << shift;
        uint keyAncestor = key & mask;

        // in our use case this while should only have 1 iteration,
        // as new keys are always going to be "adjacent"
        while (keyAncestor != BASE_KEY) {
            mask = mask << BITS_IN_NIBBLE;
            keyAncestor &= mask;
            depth++;
        }
        return depth;
    }
    */

    function getChildren(Tree storage) internal view returns (uint256) {
        return CHILDREN;
    }

    function getBitsInNibble(Tree storage) internal view returns (uint256) {
        return BITS_IN_NIBBLE;
    }
}
