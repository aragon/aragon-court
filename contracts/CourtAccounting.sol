pragma solidity ^0.4.24;

import "@aragon/os/contracts/common/IsContract.sol";
import "@aragon/os/contracts/lib/token/ERC20.sol";
import "@aragon/os/contracts/common/SafeERC20.sol";
import "@aragon/os/contracts/lib/math/SafeMath.sol";
import { ApproveAndCallFallBack } from "@aragon/apps-shared-minime/contracts/MiniMeToken.sol";

import "./standards/sumtree/ISumTree.sol";
import "./standards/erc900/ERC900.sol";
import "./standards/erc900/IStaking.sol";


contract CourtAccounting {
    using SafeERC20 for ERC20;
    using SafeMath for uint256;

    string internal constant ERROR_SENDER_NOT_OWNER = "ACCOUNTING_SENDER_NOT_OWNER";
    string internal constant ERROR_DEPOSIT_FAILED = "ACCOUNTING_DEPOSIT_FAILED";
    string internal constant ERROR_DEPOSIT_AMOUNT_ZERO = "ACCOUNTING_DEPOSIT_AMOUNT_ZERO";
    string internal constant ERROR_WITHDRAW_FAILED = "ACCOUNTING_WITHDRAW_FAILED";
    string internal constant ERROR_WITHDRAW_AMOUNT_ZERO = "ACCOUNTING_WITHDRAW_AMOUNT_ZERO";
    string internal constant ERROR_WITHDRAW_INVALID_AMOUNT = "ACCOUNTING_WITHDRAW_INVALID_AMOUNT";

    address public owner;
    mapping (address => mapping (address => uint256)) internal balances;

    event Deposit(address indexed token, address indexed from, address indexed to, uint256 amount);
    event Withdraw(address indexed token, address indexed from, address indexed to, uint256 amount);
    event BalanceChange(address indexed token, address indexed holder, uint256 amount, bool positive);

    modifier onlyOwner {
        require(msg.sender == owner, ERROR_SENDER_NOT_OWNER);
        _;
    }

    function assign(ERC20 _token, address _to, uint256 _amount) external onlyOwner {
        _assign(_token, _to, _amount);
    }

    function remove(ERC20 _token, address _from, uint256 _amount) external onlyOwner {
        _remove(_token, _from, _amount);
    }

    function burn(ERC20 _token, uint256 _amount) external onlyOwner {
        _assign(_token, BURN_ACCOUNT, _amount);
    }

    function withdraw(ERC20 _token, address _to, uint256 _amount) external {
        _remove(_token, msg.sender, _amount);
        emit Withdraw(address(_token), msg.sender, _to, _amount);

        require(_token.safeTransfer(_to, _amount), ERROR_WITHDRAW_FAILED);
    }

    function deposit(ERC20 _token, address _to, uint256 _amount) external {
        _assign(_token, _to, _amount);
        emit Deposit(address(_token), msg.sender, _to, _amount);

        require(_token.safeTransferFrom(msg.sender, address(this), _amount), ERROR_DEPOSIT_FAILED);
    }

    function balanceOf(ERC20 _token, address _holder) external view returns (uint256) {
        return balances[_token][_holder];
    }

    function _assign(ERC20 _token, address _to, uint256 _amount) internal {
        require(_amount > 0, ERROR_DEPOSIT_AMOUNT_ZERO);

        balances[_token][_to] = balance.add(_amount);
        emit BalanceChange(address(_token), _to, _amount, true);
    }

    function _remove(ERC20 _token, address _from, uint256 _amount) internal {
        uint256 balance = balanceOf(_token, _from);
        require(_amount > 0, ERROR_WITHDRAW_AMOUNT_ZERO);
        require(balance >= _amount, ERROR_WITHDRAW_INVALID_AMOUNT);

        balances[_token][_from] = balance.sub(_amount);
        emit BalanceChange(address(_token), _from, _amount, false);
    }
}
