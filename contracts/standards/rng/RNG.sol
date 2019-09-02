pragma solidity ^0.5.8;


/**
* @title Random Number Generator Standard
* @author Clément Lesaege - <clement@lesaege.com>
*/
contract RNG{

    /**
    * @dev Contribute to the reward of a random number
    * @param _block Block the random number is linked to
    */
    function contribute(uint256 _block) public payable;

    /**
    * @dev Request a random number
    * @param _block Block linked to the request
    */
    function requestRN(uint256 _block) public payable {
        contribute(_block);
    }

    /**
    * @dev Get the random number
    * @param _block Block the random number is linked to
    * @return RN Random Number. If the number is not ready or has not been required 0 instead.
    */
    function getRN(uint _block) public returns (uint256);

    /**
    * @dev Get a uncorrelated random number. Act like getRN but give a different number for each sender.
    *      This is to prevent users from getting correlated numbers.
    * @param _block Block the random number is linked to
    * @return RN Random Number. If the number is not ready or has not been required 0 instead.
    */
    function getUncorrelatedRN(uint _block) public returns (uint256) {
        uint256 baseRN = getRN(_block);
        return baseRN == uint256(0)
            ? uint256(0)
            : uint256(keccak256(abi.encodePacked(msg.sender, baseRN)));
    }

}
