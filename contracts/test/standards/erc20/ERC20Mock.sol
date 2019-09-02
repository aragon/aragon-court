pragma solidity ^0.5.8;

import "@aragon/os/contracts/lib/math/SafeMath.sol";

import "../../../standards/minime/ApproveAndCall.sol";


contract ERC20Mock {
    using SafeMath for uint256;

    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply;

    bool private allowTransfer_;
    mapping (address => uint256) private balances;
    mapping (address => mapping (address => uint256)) private allowed;

    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Transfer(address indexed from, address indexed to, uint256 value);

    constructor(string _name, string _symbol, uint8 _decimals) public {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
        allowTransfer_ = true;
    }

    /**
    * @dev Mint a certain amount of tokens for an address
    * @param _to The address that will receive the tokens
    * @param _amount The amount of tokens to be minted
    */
    function generateTokens(address _to, uint _amount) public {
        totalSupply = totalSupply.add(_amount);
        balances[_to] = balances[_to].add(_amount);
        emit Transfer(address(0), _to, _amount);
    }

    /**
    * @dev Gets the balance of the specified address.
    * @param _owner The address to query the the balance of.
    * @return The amount owned by the passed address.
    */
    function balanceOf(address _owner) public view returns (uint256) {
        return balances[_owner];
    }

    /**
    * @dev Function to check the amount of tokens that an owner allowed to a spender.
    * @param _owner The address which owns the funds.
    * @param _spender The address which will spend the funds.
    * @return The amount of tokens still available for the spender.
    */
    function allowance(address _owner, address _spender) public view returns (uint256) {
        return allowed[_owner][_spender];
    }

    /**
    * @dev Set whether the token is transferable or not
    * @param _allowTransfer Should token be transferable
    */
    function setAllowTransfer(bool _allowTransfer) public {
        allowTransfer_ = _allowTransfer;
    }

    /**
    * @dev Transfer token for a specified address
    * @param _to The address to transfer to.
    * @param _amount The amount to be transferred.
    */
    function transfer(address _to, uint256 _amount) public returns (bool) {
        require(allowTransfer_);
        require(_amount <= balances[msg.sender]);
        require(_to != address(0));

        balances[msg.sender] = balances[msg.sender].sub(_amount);
        balances[_to] = balances[_to].add(_amount);
        emit Transfer(msg.sender, _to, _amount);
        return true;
    }

    /**
    * @dev Approve the passed address to spend the specified amount of tokens on behalf of msg.sender.
    * Beware that changing an allowance with this method brings the risk that someone may use both the old
    * and the new allowance by unfortunate transaction ordering. One possible solution to mitigate this
    * race condition is to first reduce the spender's allowance to 0 and set the desired value afterwards:
    * https://github.com/ethereum/EIPs/issues/20#issuecomment-263524729
    * @param _spender The address which will spend the funds.
    * @param _amount The amount of tokens to be spent.
    */
    function approve(address _spender, uint256 _amount) public returns (bool) {
        // Assume we want to protect for the race condition
        require(_amount == 0 || allowed[msg.sender][_spender] == 0);

        allowed[msg.sender][_spender] = _amount;
        emit Approval(msg.sender, _spender, _amount);
        return true;
    }

    /**
    * @dev `msg.sender` approves `_spender` to send `_amount` tokens on its behalf, and then a function is
    *       triggered in the contract that is being approved, `_spender`. This allows users to use their
    *       tokens to interact with contracts in one function call instead of two
    * @param _spender The address of the contract able to transfer the tokens
    * @param _amount The amount of tokens to be approved for transfer
    * @return True if the function call was successful
    */
    function approveAndCall(ApproveAndCallFallBack _spender, uint256 _amount, bytes memory _extraData) public returns (bool) {
        require(approve(address(_spender), _amount));
        _spender.receiveApproval(msg.sender, _amount, address(this), _extraData);
        return true;
    }

    /**
    * @dev Transfer tokens from one address to another
    * @param _from The address which you want to send tokens from
    * @param _to The address which you want to transfer to
    * @param _amount The amount of tokens to be transferred
    */
    function transferFrom(address _from, address _to, uint256 _amount) public returns (bool) {
        require(allowTransfer_);
        require(_amount <= balances[_from]);
        require(_amount <= allowed[_from][msg.sender]);
        require(_to != address(0));

        balances[_from] = balances[_from].sub(_amount);
        balances[_to] = balances[_to].add(_amount);
        allowed[_from][msg.sender] = allowed[_from][msg.sender].sub(_amount);
        emit Transfer(_from, _to, _amount);
        return true;
    }
}
