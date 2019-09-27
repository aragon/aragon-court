pragma solidity ^0.5.8;

import "@aragon/os/contracts/lib/token/ERC20.sol";
import "@aragon/os/contracts/lib/math/SafeMath.sol";
import "@aragon/os/contracts/common/SafeERC20.sol";
import "@aragon/os/contracts/common/Initializable.sol";

import "./IAccounting.sol";


contract CourtAccounting is IAccounting, Initializable {
    using SafeERC20 for ERC20;
    using SafeMath for uint256;

    string private constant ERROR_SENDER_NOT_OWNER = "ACCOUNTING_SENDER_NOT_OWNER";
    string private constant ERROR_DEPOSIT_AMOUNT_ZERO = "ACCOUNTING_DEPOSIT_AMOUNT_ZERO";
    string private constant ERROR_WITHDRAW_FAILED = "ACCOUNTING_WITHDRAW_FAILED";
    string private constant ERROR_WITHDRAW_AMOUNT_ZERO = "ACCOUNTING_WITHDRAW_AMOUNT_ZERO";
    string private constant ERROR_WITHDRAW_INVALID_AMOUNT = "ACCOUNTING_WITHDRAW_INVALID_AMOUNT";

    address public owner;
    mapping (address => mapping (address => uint256)) internal balances;

    event Assign(address indexed token, address indexed from, address indexed to, uint256 amount);
    event Withdraw(address indexed token, address indexed from, address indexed to, uint256 amount);

    modifier onlyOwner {
        require(msg.sender == owner, ERROR_SENDER_NOT_OWNER);
        _;
    }

    function init(address _owner) external {
        // TODO: cannot check the given owner is a contract cause the Court set this up in the constructor, move to a factory
        // require(isContract(_owner), ERROR_OWNER_NOT_CONTRACT);

        initialized();
        owner = _owner;
    }

    function assign(ERC20 _token, address _to, uint256 _amount) external onlyOwner {
        require(_amount > 0, ERROR_DEPOSIT_AMOUNT_ZERO);

        address tokenAddress = address(_token);
        balances[tokenAddress][_to] = balances[tokenAddress][_to].add(_amount);
        emit Assign(tokenAddress, msg.sender, _to, _amount);
    }

    function withdraw(ERC20 _token, address _to, uint256 _amount) external {
        uint256 balance = balanceOf(_token, msg.sender);
        require(_amount > 0, ERROR_WITHDRAW_AMOUNT_ZERO);
        require(balance >= _amount, ERROR_WITHDRAW_INVALID_AMOUNT);

        address tokenAddress = address(_token);
        balances[tokenAddress][msg.sender] = balance.sub(_amount);
        emit Withdraw(tokenAddress, msg.sender, _to, _amount);

        require(_token.safeTransfer(_to, _amount), ERROR_WITHDRAW_FAILED);
    }

    function balanceOf(ERC20 _token, address _holder) public view returns (uint256) {
        return balances[address(_token)][_holder];
    }
}
