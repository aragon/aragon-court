pragma solidity ^0.4.24;


library Checkpointing {
    struct Checkpoint {
        uint64 blockNumber;
        uint192 value;
    }

    struct History {
        Checkpoint[] history;
    }

    uint256 private constant MAX_UINT192 = uint256(uint192(-1));
    uint256 private constant MAX_UINT64 = uint256(uint64(-1));

    function add192(History storage self, uint64 blockNumber, uint192 value) internal {
        if (self.history.length == 0 || self.history[self.history.length - 1].blockNumber < blockNumber) {
            self.history.push(Checkpoint(blockNumber, value));
        } else {
            Checkpoint storage currentCheckpoint = self.history[self.history.length - 1];
            require(blockNumber == currentCheckpoint.blockNumber); // ensure list ordering

            currentCheckpoint.value = value;
        }
    }

    function get192(History storage self, uint64 blockNumber) internal view returns (uint192) {
        uint256 length = self.history.length;

        if (length == 0) {
            return 0;
        }

        uint256 lastIndex = length - 1;

        // short-circuit
        if (blockNumber >= self.history[lastIndex].blockNumber) {
            return self.history[lastIndex].value;
        }

        if (blockNumber < self.history[0].blockNumber) {
            return 0;
        }

        uint256 low = 0;
        uint256 high = lastIndex;

        while (high > low) {
            uint256 mid = (high + low + 1) / 2; // average, ceil round

            if (blockNumber >= self.history[mid].blockNumber) {
                low = mid;
            } else { // blockNumber < self.history[mid].blockNumber
                high = mid - 1;
            }
        }

        return self.history[low].value;
    }

    function lastUpdated(History storage self) internal view returns (uint256) {
        if (self.history.length > 0) {
            return uint256(self.history[self.history.length - 1].blockNumber);
        }

        return 0;
    }

    function add(History storage self, uint256 blockNumber, uint256 value) internal {
        require(blockNumber <= MAX_UINT64);
        require(value <= MAX_UINT192);

        add192(self, uint64(blockNumber), uint192(value));
    }

    function get(History storage self, uint256 blockNumber) internal view returns (uint256) {
        require(blockNumber <= MAX_UINT64);

        return uint256(get192(self, uint64(blockNumber)));
    }

    function getLast(History storage self) internal view returns (uint256) {
        if (self.history.length > 0) {
            return uint256(self.history[self.history.length - 1].value);
        }

        return 0;
    }

}
