pragma solidity ^0.4.24;

import "@aragon/os/contracts/common/TimeHelpers.sol";
import "@aragon/os/contracts/lib/math/SafeMath.sol";
import "@aragon/os/contracts/lib/math/SafeMath64.sol";


contract TimeHelpersMock is TimeHelpers {
    using SafeMath for uint256;
    using SafeMath64 for uint64;

    // TODO: Current mocks need to start from timestamp 0 and blocknumber 1 due to how tests are built, fix tests to be able to start with current values
    uint256 mockedTimestamp;
    uint256 mockedBlockNumber;

    /**
    * @dev Tells the mocked block number in uint256, or the real block number if it wasn't mocked
    */
    function getBlockNumberExt() public view returns (uint256) {
        return getBlockNumber();
    }

    /**
    * @dev Tells the mocked block number in uint64, or the real block number if it wasn't mocked
    */
    function getBlockNumber64Ext() public view returns (uint64) {
        return getBlockNumber64();
    }

    /**
    * @dev Tells the mocked timestamp value in uint256, or the real timestamp if it wasn't mocked
    */
    function getTimestampExt() public view returns (uint256) {
        return getTimestamp();
    }

    /**
    * @dev Tells the mocked timestamp value in uint64, or the real timestamp if it wasn't mocked
    */
    function getTimestamp64Ext() public view returns (uint64) {
        return getTimestamp64();
    }

    /**
    * @dev Sets a mocked block number value, used only for testing purposes
    */
    function mockSetBlockNumber(uint256 _number) public {
        mockedBlockNumber = _number;
    }

    /**
    * @dev Advances the mocked block number value, used only for testing purposes
    */
    function mockAdvanceBlocks(uint256 _number) public {
        if (mockedBlockNumber != 0) mockedBlockNumber = mockedBlockNumber.add(_number);
        else mockedBlockNumber = block.number.add(_number);
    }

    /**
    * @dev Sets a mocked timestamp value, used only for testing purposes
    */
    function mockSetTimestamp(uint256 _timestamp) public {
        mockedTimestamp = _timestamp;
    }

    /**
    * @dev Increases the mocked timestamp value, used only for testing purposes
    */
    function mockIncreaseTime(uint256 _seconds) public {
        if (mockedTimestamp != 0) mockedTimestamp = mockedTimestamp.add(_seconds);
        else mockedTimestamp = block.timestamp.add(_seconds);
    }

    /**
    * @dev Internal function to get the mocked block number if it was set, or current `block.number`
    */
    function getBlockNumber() internal view returns (uint256) {
        if (mockedBlockNumber != 0) return mockedBlockNumber;
        return super.getBlockNumber();
    }

    /**
    * @dev Internal function to get the mocked timestamp if it was set, or current `block.timestamp`
    */
    function getTimestamp() internal view returns (uint256) {
        if (mockedTimestamp != 0) return mockedTimestamp;
        return super.getTimestamp();
    }
}
