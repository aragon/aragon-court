pragma solidity ^0.5.8;

import "@aragon/os/contracts/lib/token/ERC20.sol";


interface IAccounting {
    function assign(ERC20 _token, address _to, uint256 _amount) external;
    function withdraw(ERC20 _token, address _to, uint256 _amount) external;
}
