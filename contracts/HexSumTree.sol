pragma solidity ^0.4.24;


library HexSumTree {
    struct Tree {
        bytes32 nextKey;
        bytes32 rootAncestor;
        uint8 rootDepth; // could optimize by having this byte as the MSB of rootAncestor to save one sstore
        mapping (uint8 => mapping (bytes32 => uint256)) nodes; // depth -> key -> value
    }
    
    uint256 private constant CHILDS = 16;
    uint256 private constant MAX_DEPTH = 64;
    uint256 private constant BITS_IN_NIBBLE = 4;
    uint8 private constant INSERTION_DEPTH = 0;
    bytes32 private constant BASE_KEY = bytes32(-1); // tree starts on the very right
    
    string private constant ERROR_SORTITION_OUT_OF_BOUNDS = "SORTITION_OUT_OF_BOUNDS";
    
    function init(Tree storage self) internal {
        self.rootDepth = 1;
        self.rootAncestor = BASE_KEY << BITS_IN_NIBBLE; // 0xffff...fff0
        self.nextKey = BASE_KEY;
    }

    function insert(Tree storage self, uint256 value) internal returns (bytes32) {
        bytes32 key = self.nextKey;
        self.nextKey = nextKey(key);
        
        set(self, key, value);

        return translateKey(key);
    }
    
    function set(Tree storage self, bytes32 key, uint256 value) internal {
        uint256 oldValue = self.nodes[INSERTION_DEPTH][key];
        self.nodes[INSERTION_DEPTH][key] = value;
        
        if (value > oldValue) {
            updateSums(self, key, value - oldValue, true);
        } else if (value < oldValue) {
            updateSums(self, key, oldValue - value, false);
        }
    }
    
    function sortition(Tree storage self, uint256 value) internal view returns (bytes32 key) {
        require(totalSum(self) >= value, ERROR_SORTITION_OUT_OF_BOUNDS);   

        return translateKey(_sortition(self, value, self.rootAncestor, self.rootDepth));
    }

    function _sortition(Tree storage self, uint256 value, bytes32 node, uint8 depth) private view returns (bytes32 key) {
        uint256 checkedValue = 0; // Can optimize by having checkedValue = value - remainingValue 

        // Always start from the end as the tree is inverted
        for (uint256 i = CHILDS - 1; i >= 0; i--) {
            // shift the iteratior and add it to node 0x00..0i00 (for depth = 3)
            uint256 iterator = i << ((depth - 1) * BITS_IN_NIBBLE);
            bytes32 checkingNode = bytes32(uint256(node) + iterator);

            uint256 nodeSum = self.nodes[depth - 1][checkingNode];
            // TODO: check extrict equality (risk of off-by-ones)
            if (checkedValue + nodeSum <= value) {
                checkedValue += nodeSum;
            } else if (depth == 1) { // node found at the end of the tree
                return checkingNode;
            } else {
                return _sortition(self, value - checkedValue, checkingNode, depth - 1);
            }
        }
    }
    
    function updateSums(Tree storage self, bytes32 key, uint256 delta, bool sum) private {
        bytes32 rootAncestor = self.rootAncestor;
        uint8 rootDepth = self.rootDepth;
        bytes32 newRootAncestor = sharedPrefix(self.rootAncestor, key);
        
        if (rootAncestor != newRootAncestor) {
            uint8 newRootDepth = rootDepth + 1;
            
            self.rootDepth = newRootDepth;
            self.rootAncestor = newRootAncestor;
    
            self.nodes[newRootDepth][newRootAncestor] = self.nodes[rootDepth][rootAncestor];
            
            rootDepth = newRootDepth;
            rootAncestor = newRootAncestor;
        }
        
        for (uint8 i = 1; i <= rootDepth; i++) {
            bytes32 ancestorKey = zeroSuffixNibbles(key, i);
            uint256 currentSum = self.nodes[i][ancestorKey];
            
            self.nodes[i][ancestorKey] = sum ? currentSum + delta : currentSum - delta;
        }
    }

    function totalSum(Tree storage self) internal view returns (uint256) {
        return self.nodes[self.rootDepth][self.rootAncestor];
    }

    function get(Tree storage self, uint8 depth, bytes32 key) internal view returns (uint256) {
        return self.nodes[depth][translateKey(key)];
    }
    
    function nextKey(bytes32 fromKey) private pure returns (bytes32) {
        return bytes32(uint256(fromKey) - 1);
    }

    function translateKey(bytes32 key) private pure returns (bytes32) {
        return bytes32(uint256(BASE_KEY) - uint256(key));
    }
    
    function zeroSuffixNibbles(bytes32 key, uint256 n) internal pure returns (bytes32) {
        if (n == MAX_DEPTH) {
            return bytes32(0);
        }
        
        uint256 shift = n * BITS_IN_NIBBLE;
        return (key >> shift) << shift;
    }

    function sharedPrefix(bytes32 keyA, bytes32 keyB) internal pure returns (bytes32) {
        if (keyA == keyB) {
            return keyA;
        }
        
        bytes32 shared;
        
        // TODO: optimize checking from the end of the key
        for (uint256 i = MAX_DEPTH; i > 0; --i) {
            uint256 shift = i * BITS_IN_NIBBLE;
            bytes32 shiftedA = keyA >> shift;
            bytes32 shiftedB = keyB >> shift;
            
            if (shiftedA == shiftedB) {
                shared = shiftedA;
            } else {
                return shared << (i + 1) * BITS_IN_NIBBLE;
            }
        }
        
        return keyA; // both keys are the same
    }
}
