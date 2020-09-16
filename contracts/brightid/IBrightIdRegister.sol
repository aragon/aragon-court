pragma solidity ^0.5.8;

contract IBrightIdRegister {
    function isVerified(address _brightIdUser) external view returns (bool);
    function uniqueUserId(address _brightIdUser) external view returns (address);
}
