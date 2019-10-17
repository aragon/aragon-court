pragma solidity ^0.5.8;

import "@aragon/os/contracts/lib/token/ERC20.sol";
import "@aragon/os/contracts/lib/math/SafeMath.sol";
import "@aragon/os/contracts/common/SafeERC20.sol";

import "./IAccounting.sol";
import "../controller/Controlled.sol";
import "../controller/Controller.sol";
import "../controller/ControlledRecoverable.sol";


contract CourtAccounting is ControlledRecoverable, IAccounting {
    using SafeERC20 for ERC20;
    using SafeMath for uint256;

    string private constant ERROR_DEPOSIT_AMOUNT_ZERO = "ACCOUNTING_DEPOSIT_AMOUNT_ZERO";
    string private constant ERROR_WITHDRAW_FAILED = "ACCOUNTING_WITHDRAW_FAILED";
    string private constant ERROR_WITHDRAW_AMOUNT_ZERO = "ACCOUNTING_WITHDRAW_AMOUNT_ZERO";
    string private constant ERROR_WITHDRAW_INVALID_AMOUNT = "ACCOUNTING_WITHDRAW_INVALID_AMOUNT";

    // List of balances indexed by token and holder address
    mapping (address => mapping (address => uint256)) internal balances;

    event Assign(ERC20 indexed token, address indexed from, address indexed to, uint256 amount);
    event Withdraw(ERC20 indexed token, address indexed from, address indexed to, uint256 amount);

    /**
    * @dev Constructor function
    * @param _controller Address of the controller
    */
    constructor(Controller _controller) ControlledRecoverable(_controller) public {
        // solium-disable-previous-line no-empty-blocks
        // No need to explicitly call `Controlled` constructor since `ControlledRecoverable` is already doing it
    }

    /**
    * @notice Assign `@tokenAmount(_token, _amount)` to `_to`
    * @param _token ERC20 token to be assigned
    * @param _to Address of the recipient that will be assigned the tokens to
    * @param _amount Amount of tokens to be assigned to the recipient
    */
    function assign(ERC20 _token, address _to, uint256 _amount) external onlyCourt {
        require(_amount > 0, ERROR_DEPOSIT_AMOUNT_ZERO);

        address tokenAddress = address(_token);
        balances[tokenAddress][_to] = balances[tokenAddress][_to].add(_amount);
        emit Assign(_token, msg.sender, _to, _amount);
    }

    /**
    * @notice Withdraw `@tokenAmount(_token, _amount)` from sender to `_to`
    * @param _token ERC20 token to be withdrawn
    * @param _to Address of the recipient that will receive the tokens
    * @param _amount Amount of tokens to be withdrawn from the sender
    */
    function withdraw(ERC20 _token, address _to, uint256 _amount) external {
        uint256 balance = balanceOf(_token, msg.sender);
        require(_amount > 0, ERROR_WITHDRAW_AMOUNT_ZERO);
        require(balance >= _amount, ERROR_WITHDRAW_INVALID_AMOUNT);

        address tokenAddress = address(_token);
        balances[tokenAddress][msg.sender] = balance.sub(_amount);
        emit Withdraw(_token, msg.sender, _to, _amount);

        require(_token.safeTransfer(_to, _amount), ERROR_WITHDRAW_FAILED);
    }

    /**
    * @dev Tell the token balance of a certain holder
    * @param _token ERC20 token balance being queried
    * @param _holder Address of the holder querying the balance of
    * @return Amount of tokens the holder owns
    */
    function balanceOf(ERC20 _token, address _holder) public view returns (uint256) {
        return balances[address(_token)][_holder];
    }
}
