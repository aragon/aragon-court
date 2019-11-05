pragma solidity ^0.5.8;

import "../lib/os/ERC20.sol";
import "../lib/os/SafeMath.sol";
import "../lib/os/SafeERC20.sol";

import "./ITreasury.sol";
import "../controller/Controlled.sol";
import "../controller/Controller.sol";
import "../controller/ControlledRecoverable.sol";


contract CourtTreasury is ControlledRecoverable, ITreasury {
    using SafeERC20 for ERC20;
    using SafeMath for uint256;

    string private constant ERROR_DEPOSIT_AMOUNT_ZERO = "TREASURY_DEPOSIT_AMOUNT_ZERO";
    string private constant ERROR_WITHDRAW_FAILED = "TREASURY_WITHDRAW_FAILED";
    string private constant ERROR_WITHDRAW_AMOUNT_ZERO = "TREASURY_WITHDRAW_AMOUNT_ZERO";
    string private constant ERROR_WITHDRAW_INVALID_AMOUNT = "TREASURY_WITHDRAW_INVALID_AMOUNT";
    string private constant ERROR_WITHDRAWS_DISALLOWED = "TREASURY_WITHDRAWALS_DISALLOWED";

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
        _withdraw(_token, msg.sender, _to, _amount);
    }

    /**
    * @notice Withdraw all the tokens from `_to` to themself
    * @param _token ERC20 token to be withdrawn
    * @param _to Address of the recipient that will receive their tokens
    */
    function withdrawAll(ERC20 _token, address _to) external {
        IConfig config = _config();
        require(config.areWithdrawalsAllowedFor(_to), ERROR_WITHDRAWS_DISALLOWED);

        uint256 amount = _balanceOf(_token, _to);
        _withdraw(_token, _to, _to, amount);
    }

    /**
    * @dev Tell the token balance of a certain holder
    * @param _token ERC20 token balance being queried
    * @param _holder Address of the holder querying the balance of
    * @return Amount of tokens the holder owns
    */
    function balanceOf(ERC20 _token, address _holder) external view returns (uint256) {
        return _balanceOf(_token, _holder);
    }

    /**
    * @dev Internal function to withdraw tokens from an account
    * @param _token ERC20 token to be withdrawn
    * @param _from Address where the tokens will be removed from
    * @param _to Address of the recipient that will receive the corresponding tokens
    * @param _amount Amount of tokens to be withdrawn from the sender
    */
    function _withdraw(ERC20 _token, address _from, address _to, uint256 _amount) internal {
        require(_amount > 0, ERROR_WITHDRAW_AMOUNT_ZERO);
        uint256 balance = _balanceOf(_token, _from);
        require(balance >= _amount, ERROR_WITHDRAW_INVALID_AMOUNT);

        address tokenAddress = address(_token);
        // No need for SafeMath: checked above
        balances[tokenAddress][_from] = balance - _amount;
        emit Withdraw(_token, _from, _to, _amount);

        require(_token.safeTransfer(_to, _amount), ERROR_WITHDRAW_FAILED);
    }

    /**
    * @dev Internal function to tell the token balance of a certain holder
    * @param _token ERC20 token balance being queried
    * @param _holder Address of the holder querying the balance of
    * @return Amount of tokens the holder owns
    */
    function _balanceOf(ERC20 _token, address _holder) internal view returns (uint256) {
        return balances[address(_token)][_holder];
    }
}
