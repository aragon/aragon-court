pragma solidity ^0.4.24;

import "@aragon/os/contracts/lib/token/ERC20.sol";
import "@aragon/os/contracts/common/SafeERC20.sol";
import "@aragon/os/contracts/lib/math/SafeMath.sol";

import "./standards/accounting/IAccounting.sol";


contract CourtAccounting is IAccounting {
    using SafeERC20 for ERC20;
    using SafeMath for uint256;

    string internal constant ERROR_SENDER_NOT_OWNER = "ACCOUNTING_SENDER_NOT_OWNER";
    string internal constant ERROR_ALREADY_INITIALIZED = "ACCOUNTING_ALREADY_INITIALIZED";
    string internal constant ERROR_DEPOSIT_AMOUNT_ZERO = "ACCOUNTING_DEPOSIT_AMOUNT_ZERO";
    string internal constant ERROR_WITHDRAW_FAILED = "ACCOUNTING_WITHDRAW_FAILED";
    string internal constant ERROR_WITHDRAW_AMOUNT_ZERO = "ACCOUNTING_WITHDRAW_AMOUNT_ZERO";
    string internal constant ERROR_WITHDRAW_INVALID_AMOUNT = "ACCOUNTING_WITHDRAW_INVALID_AMOUNT";

    address public owner;
    mapping (address => mapping (address => uint256)) internal balances;

    event Deposit(address indexed token, address indexed from, address indexed to, uint256 amount);
    event Withdraw(address indexed token, address indexed from, address indexed to, uint256 amount);

    modifier onlyOwner {
        require(msg.sender == owner, ERROR_SENDER_NOT_OWNER);
        _;
    }

    function init(address _owner) external {
        require(owner == address(0), ERROR_ALREADY_INITIALIZED);
        owner = _owner;
    }

    function deposit(ERC20 _token, address _to, uint256 _amount) external onlyOwner {
        // TODO: uncomment, we are testing with 0 fees for now
        // require(_amount > 0, ERROR_DEPOSIT_AMOUNT_ZERO);

        balances[_token][_to] = balances[_token][_to].add(_amount);
        emit Deposit(address(_token), msg.sender, _to, _amount);
    }

    function withdraw(ERC20 _token, address _to, uint256 _amount) external {
        uint256 balance = balanceOf(_token, msg.sender);
        require(_amount > 0, ERROR_WITHDRAW_AMOUNT_ZERO);
        require(balance >= _amount, ERROR_WITHDRAW_INVALID_AMOUNT);

        balances[_token][msg.sender] = balance.sub(_amount);
        emit Withdraw(address(_token), msg.sender, _to, _amount);

        require(_token.safeTransfer(_to, _amount), ERROR_WITHDRAW_FAILED);
    }

    function balanceOf(ERC20 _token, address _holder) public view returns (uint256) {
        return balances[_token][_holder];
    }
}
