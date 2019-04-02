pragma solidity ^0.4.24;

import "./HexSumTree.sol";


library TierTreesWrapper {
    using HexSumTree for HexSumTree.Tree;

    string private constant ERROR_WRONG_THRESHOLDS = "TTW_WRONG_THRESHOLDS";
    string private constant ERROR_WRONG_KEY = "TTW_WRONG_KEY";
    string private constant ERROR_UPDATE_OVERFLOW = "TTW_UPDATE_OVERFLOW";
    string private constant ERROR_SORTITION_OUT_OF_BOUNDS = "TTW_SORTITION_OUT_OF_BOUNDS";

    struct TierTrees {
        uint256[] thresholds;
        HexSumTree.Tree[] trees;
        uint256 treesSum;
    }

    function init(TierTrees storage self, uint256[] _thresholds) internal {
        uint256 thresholdsLength = _thresholds.length;
        require(thresholdsLength > 0, ERROR_WRONG_THRESHOLDS);
        // one less than trees (see below), which is 1 byte max:
        require(thresholdsLength < 254, ERROR_WRONG_THRESHOLDS);
        self.thresholds = _thresholds;
        // there will be one more element in trees than in thresholds, if n = thresholds.length
        // first tree (0-th) goes [0, thresholds[0]),
        // tree i-th, 0 < i < n, goes [thresholds[i-1], thresholds[i])
        // tree n-th goes [thresholds[n-1], infinity)
        for (uint256 i = 0; i <= thresholdsLength; i ++) {
            self.trees.length++;
            self.trees[i].init();
        }
    }

    function insert(TierTrees storage self, uint256 value) internal returns (uint256) {
        _updateSums(self, value, true);

        uint256 treeId = _getTreeId(self, value);
        uint256 treeKey = self.trees[treeId].insert(value);
        return _encodeKey(treeId, treeKey);
    }

    function set(TierTrees storage self, uint256 key, uint256 value) internal returns (uint256 newKey, uint256 delta, bool positive) {
        (uint256 treeId, uint256 treeKey) = decodeKey(self, key);
        uint256 newTreeId = _getTreeId(self, value);
        if (treeId == newTreeId) {
            (newKey, delta, positive) = self.trees[treeId].set(treeKey, value);
        } else {
            uint256 oldValue = getItem(self, treeId, treeKey);
            if (newTreeId > treeId) {
                positive = true;
                delta = value - oldValue;
            } else {
                positive = false;
                delta = oldValue - value;
            }
            // remove from old tree
            self.trees[treeId].set(treeKey, 0);
            // add to new tree
            newKey = _encodeKey(newTreeId, self.trees[newTreeId].insert(value));
        }
        _updateSums(self, delta, positive);
    }

    function update(TierTrees storage self, uint256 key, uint256 delta, bool positive) internal returns (uint256 newKey) {
        (uint256 treeId, uint256 treeKey) = decodeKey(self, key);
        uint256 oldValue = self.trees[treeId].getItem(key);
        uint256 newValue = positive ? oldValue + delta : oldValue - delta;
        uint256 newTreeId = _getTreeId(self, newValue);
        if (treeId == newTreeId) {
            self.trees[treeId].update(treeKey, delta, positive);
            newKey = key;
        } else {
            // remove from old tree
            self.trees[treeId].set(treeKey, 0);
            // add to new tree
            newKey = _encodeKey(newTreeId, self.trees[newTreeId].insert(newValue));
        }
        _updateSums(self, delta, positive);
    }

    function sortition(TierTrees storage self, uint256 value) internal view returns (uint256 key, uint256 nodeValue) {
        return _sortition(self, value);
    }

    function randomSortition(TierTrees storage self, uint256 seed) internal view returns (uint256 key, uint256 nodeValue) {
        uint256 value = seed % totalSum(self);
        return _sortition(self, value);
    }

    function randomSortition(TierTrees storage self, uint256 seed, uint256 minTreeId) internal view returns (uint256 key, uint256 nodeValue) {
        uint256 offset;
        for (uint256 i = 0; i < minTreeId; i++) {
            // this can't overflow because offset <= self.treeSum
            offset += self.trees[i].totalSum();
        }
        uint256 value = offset + seed % (totalSum(self) - offset);
        return _sortition(self, value);
    }

    function totalSum(TierTrees storage self) internal view returns (uint256) {
        return self.treesSum;
    }

    function get(TierTrees storage self, uint256 depth, uint256 key) internal view returns (uint256) {
        (uint256 treeId, uint256 treeKey) = decodeKey(self, key);
        return self.trees[treeId].get(depth, treeKey);
    }

    function getItem(TierTrees storage self, uint256 key) internal view returns (uint256) {
        (uint256 treeId, uint256 treeKey) = decodeKey(self, key);
        return self.trees[treeId].getItem(treeKey);
    }

    function getItem(TierTrees storage self, uint256 treeId, uint256 treeKey) internal view returns (uint256) {
        return self.trees[treeId].getItem(treeKey);
    }

    function getTreeSum(TierTrees storage self, uint256 treeId) internal returns (uint256) {
        return self.trees[treeId].totalSum();
    }

    function _getTreeId(TierTrees storage self, uint256 value) private view returns (uint256) {
        for (uint256 i = 0; i < self.thresholds.length; i++) {
            if (value < self.thresholds[i]) {
                return i;
            }
        }

        return i;
    }

    function _updateSums(TierTrees storage self, uint256 delta, bool positive) private {
        // Invariant: this will never underflow.
        self.treesSum = positive ? self.treesSum + delta : self.treesSum - delta;
        require(!positive || self.treesSum >= delta, ERROR_UPDATE_OVERFLOW);
    }

    function _sortition(TierTrees storage self, uint256 value) private returns (uint256 key, uint256 nodeValue) {
        for (uint256 i = 0; i < self.trees.length; i ++) {
            uint256 treeSum = self.trees[i].totalSum();
            if (value < treeSum) {
                return self.trees[i].sortition(value);
            }
            value = value - treeSum;
        }
        revert(ERROR_SORTITION_OUT_OF_BOUNDS);
    }

    // we reserve the first byte for the tree id
    function _encodeKey(uint256 treeId, uint256 treeKey) private pure returns (uint256 key) {
        // not needed: there's no way the key can grow that big
        //require(treeKey & 0x00FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF == key);
        key = treeId << 248 + treeKey;
    }

    function decodeKey(TierTrees storage self, uint256 key) internal view returns (uint256 treeId, uint256 treeKey) {
        treeId = key >> 248;
        require(treeId <= self.thresholds.length, ERROR_WRONG_KEY);
        treeKey = key & 0x00FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF;
    }
}
