pragma solidity ^0.4.24;

import "@aragon/os/contracts/lib/token/ERC20.sol";


interface IAccounting {
    event Assign(address indexed token, address indexed from, address indexed to, uint256 amount);
    event Withdraw(address indexed token, address indexed from, address indexed to, uint256 amount);

    // TODO: remove init from the interface, all the initialization should be outside the court
    function init(address _owner) external;

    function assign(ERC20 _token, address _to, uint256 _amount) external;
    function withdraw(ERC20 _token, address _to, uint256 _amount) external;
}
