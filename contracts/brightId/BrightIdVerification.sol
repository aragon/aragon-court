pragma solidity ^0.5.8;

import "../lib/os/SafeMath.sol";
import "./RegisterAndCall.sol";

contract BrightIdVerification {

    using SafeMath for uint256;

    string private constant ERROR_VERIFIED_FOR_PERIOD_ZERO = "VERIFIED_FOR_PERIOD_ZERO";
    string private constant ERROR_SENDER_NOT_IN_VERIFICATION = "SENDER_NOT_IN_VERIFICATION";
    string private constant ERROR_INCORRECT_VERIFICATION = "INCORRECT_VERIFICATION";
    string private constant ERROR_ADDRESS_VOIDED = "ADDRESS_VOIDED";

    uint256 public constant VERIFICATION_TIMESTAMP_VARIANCE = 1 days;

    struct BrightIdUser {
        uint256 verificationTime;
        bool addressVoid;
    }

    bytes32 public brightIdContext;
    address public brightIdVerifier;
    uint256 public verifiedForPeriod;

    mapping (address => BrightIdUser) brightIdUsers;

    event Register(address sender);

    /**
    * @param _brightIdContext BrightId context used for verifying users
    * @param _brightIdVerifier BrightId verifier address that signs BrightId verifications
    * @param _verifiedForPeriod Length of time after a verification before verification is required again
    */
    constructor(bytes32 _brightIdContext, address _brightIdVerifier, uint256 _verifiedForPeriod) public {
        require(_verifiedForPeriod > 0, ERROR_VERIFIED_FOR_PERIOD_ZERO);
        brightIdContext = _brightIdContext;
        brightIdVerifier = _brightIdVerifier;
        verifiedForPeriod = _verifiedForPeriod;
    }

    /**
    * @notice Register the sender as a unique individual with a BrightId verification
    * @param _brightIdContext The context used in the users verification
    * @param _addrs The history of addresses, or contextIds, used by this user to register with BrightID for the BrightId context
    * @param _timestamp The time the verification was created by a BrightId node
    * @param _v Part of the BrightId nodes signature verifying the users uniqueness
    * @param _r Part of the BrightId nodes signature verifying the users uniqueness
    * @param _s Part of the BrightId nodes signature verifying the users uniqueness
    * @param _registerAndCall Contract to call after verification, set to 0x0 to register without forwarding data
    * @param _functionCallData Function data to call on the contract address after verification
    */
    function register(
        bytes32 _brightIdContext,
        address[] memory _addrs,
        uint256 _timestamp,
        uint8 _v,
        bytes32 _r,
        bytes32 _s,
        RegisterAndCall _registerAndCall,
        bytes memory _functionCallData
    )
        public
    {
        BrightIdUser storage brightIdUser = brightIdUsers[msg.sender];
        require(msg.sender == _addrs[0], ERROR_SENDER_NOT_IN_VERIFICATION);
        require(_isVerifiedUnique(_brightIdContext, _addrs, _timestamp, _v, _r, _s), ERROR_INCORRECT_VERIFICATION);
        require(!brightIdUser.addressVoid, ERROR_ADDRESS_VOIDED);

        brightIdUser.verificationTime = now;

        _voidUserHistory(_addrs);

        if (address(_registerAndCall) != address(0)) {
            _registerAndCall.receiveVerification(msg.sender, _functionCallData);
        }

        emit Register(msg.sender);
    }

    function isVerified(address _brightIdUser) external returns (bool) {
        BrightIdUser storage brightIdUser = brightIdUsers[msg.sender];

        bool userVerifiedWithinPeriod = now < brightIdUser.verificationTime.add(verifiedForPeriod);
        bool userValid = !brightIdUser.addressVoid;

        return userVerifiedWithinPeriod && userValid;
    }

    function isOrWasVerified() external returns (bool) {
        
    }

    function _isVerifiedUnique(
        bytes32 _brightIdContext,
        address[] memory _addrs,
        uint256 _timestamp,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    )
        internal view returns (bool)
    {
        bytes32 signedMessage = keccak256(abi.encodePacked(_brightIdContext, _addrs, _timestamp));
        address verifierAddress = ecrecover(signedMessage, _v, _r, _s);

        bool correctVerifier = brightIdVerifier == verifierAddress;
        bool correctContext = brightIdContext == _brightIdContext;
        bool acceptableTimestamp = now < _timestamp.add(VERIFICATION_TIMESTAMP_VARIANCE);

        return correctVerifier && correctContext && acceptableTimestamp;
    }

    /**
    * Void all previously used addresses to prevent users from
    * registering multiple times using old BrightID verifications.
    */
    function _voidUserHistory(address[] memory _addrs) internal {
        if (_addrs.length <= 1) {
            return;
        }

        // Loop until we find a voided address, from which all subsequent addresses will already be voided
        uint256 index = 1;
        while (index < _addrs.length && !brightIdUsers[_addrs[index]].addressVoid) {
            brightIdUsers[_addrs[index]].addressVoid = true;
            index++;
        }
    }
}
