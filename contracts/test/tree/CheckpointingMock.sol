pragma solidity ^0.5.8;

import "../../lib/Checkpointing.sol";


contract CheckpointingMock {
    using Checkpointing for Checkpointing.History;

    Checkpointing.History internal history;

    function add(uint64 _time, uint256 _value) public {
        history.add(_time, _value);
    }

    function getLast() public view returns (uint256) {
        return history.getLast();
    }

    function get(uint64 _time, bool _recent) public view returns (uint256) {
        return history.get(_time, _recent);
    }
}
