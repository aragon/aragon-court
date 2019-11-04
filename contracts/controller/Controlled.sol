pragma solidity ^0.5.8;

import "@aragon/os/contracts/common/IsContract.sol";

import "./Controller.sol";
import "./clock/IClock.sol";
import "./config/CourtConfigData.sol";
import "../voting/ICRVoting.sol";
import "../treasury/ITreasury.sol";
import "../registry/IJurorsRegistry.sol";
import "../subscriptions/ISubscriptions.sol";


contract Controlled is IsContract, CourtConfigData {
    string private constant ERROR_CONTROLLER_NOT_CONTRACT = "CTD_CONTROLLER_NOT_CONTRACT";
    string private constant ERROR_SENDER_NOT_COURT_MODULE = "CTD_SENDER_NOT_COURT_MODULE";
    string private constant ERROR_SENDER_NOT_CONFIG_GOVERNOR = "CTD_SENDER_NOT_CONFIG_GOVERNOR";

    // Address of the controller
    Controller internal controller;

    /**
    * @dev Ensure the msg.sender is the court module
    */
    modifier onlyCourt() {
        require(msg.sender == _court(), ERROR_SENDER_NOT_COURT_MODULE);
        _;
    }

    /**
    * @dev Ensure the msg.sender is the controller's config governor
    */
    modifier onlyConfigGovernor {
        require(msg.sender == _configGovernor(), ERROR_SENDER_NOT_CONFIG_GOVERNOR);
        _;
    }

    /**
    * @dev Constructor function
    * @param _controller Address of the controller
    */
    constructor(Controller _controller) public {
        require(isContract(address(_controller)), ERROR_CONTROLLER_NOT_CONTRACT);
        controller = _controller;
    }

    /**
    * @dev Tell the address of the controller
    * @return Address of the controller
    */
    function getController() external view returns (Controller) {
        return controller;
    }

    /**
    * @dev Internal function to ensure the Court term is up-to-date, it will try to update it if not
    * @return Identification number of the current Court term
    */
    function _ensureCurrentTerm() internal returns (uint64) {
        return _clock().ensureCurrentTerm();
    }

    /**
    * @dev Internal function to fetch the last ensured term ID of the Court
    * @return Identification number of the last ensured term
    */
    function _getLastEnsuredTermId() internal view returns (uint64) {
        return _clock().getLastEnsuredTermId();
    }

    /**
    * @dev Internal function to tell the current term identification number
    * @return Identification number of the current term
    */
    function _getCurrentTermId() internal view returns (uint64) {
        return _clock().getCurrentTermId();
    }

    /**
    * @dev Internal function to fetch the controller's config governor
    * @return Address of the controller's governor
    */
    function _configGovernor() internal view returns (address) {
        return controller.getConfigGovernor();
    }

    /**
    * @dev Internal function to fetch the address of the Treasury module implementation from the controller
    * @return Address of the Treasury module implementation
    */
    function _treasury() internal view returns (ITreasury) {
        return ITreasury(controller.getTreasury());
    }

    /**
    * @dev Internal function to fetch the address of the Voting module implementation from the controller
    * @return Address of the Voting module implementation
    */
    function _voting() internal view returns (ICRVoting) {
        return ICRVoting(controller.getVoting());
    }

    /**
    * @dev Internal function to fetch the address of the Voting module owner from the controller
    * @return Address of the Voting module owner
    */
    function _votingOwner() internal view returns (ICRVotingOwner) {
        return ICRVotingOwner(_court());
    }

    /**
    * @dev Internal function to fetch the address of the JurorRegistry module implementation from the controller
    * @return Address of the JurorRegistry module implementation
    */
    function _jurorsRegistry() internal view returns (IJurorsRegistry) {
        return IJurorsRegistry(controller.getJurorsRegistry());
    }

    /**
    * @dev Internal function to fetch the address of the Subscriptions module implementation from the controller
    * @return Address of the Subscriptions module implementation
    */
    function _subscriptions() internal view returns (ISubscriptions) {
        return ISubscriptions(controller.getSubscriptions());
    }

    /**
    * @dev Internal function to fetch the address of the Clock module from the controller
    * @return Address of the Clock module
    */
    function _clock() internal view returns (IClock) {
        return IClock(controller);
    }

    /**
    * @dev Internal function to fetch the address of the Config module from the controller
    * @return Address of the Config module
    */
    function _config() internal view returns (IConfig) {
        return IConfig(controller);
    }

    /**
    * @dev Internal function to fetch the address of the Court module from the controller
    * @return Address of the Court module
    */
    function _court() internal view returns (address) {
        return controller.getCourt();
    }

    /**
    * @dev Internal function to get the Court config for a certain term
    * @param _termId Term querying the Court config of
    * @return Court config for the given term
    */
    function _getConfigAt(uint64 _termId) internal view returns (Config memory) {
        (ERC20 _feeToken,
        uint256[3] memory _fees,
        uint64[4] memory _roundStateDurations,
        uint16[2] memory _pcts,
        uint64[4] memory _roundParams,
        uint256[2] memory _appealCollateralParams,
        uint256 _minActiveBalance) = _config().getConfig(_termId);

        Config memory config;

        config.fees = FeesConfig({
            token: _feeToken,
            jurorFee: _fees[0],
            draftFee: _fees[1],
            settleFee: _fees[2],
            finalRoundReduction: _pcts[1]
        });

        config.disputes = DisputesConfig({
            commitTerms: _roundStateDurations[0],
            revealTerms: _roundStateDurations[1],
            appealTerms: _roundStateDurations[2],
            appealConfirmTerms: _roundStateDurations[3],
            penaltyPct: _pcts[0],
            firstRoundJurorsNumber: _roundParams[0],
            appealStepFactor: _roundParams[1],
            maxRegularAppealRounds: _roundParams[2],
            finalRoundLockTerms: _roundParams[3],
            appealCollateralFactor: _appealCollateralParams[0],
            appealConfirmCollateralFactor: _appealCollateralParams[1]
        });

        config.minActiveBalance = _minActiveBalance;

        return config;
    }

    /**
    * @dev Internal function to get the min active balance config for a given term
    * @param _termId Identification number of the term querying the min active balance config of
    * @return Minimum amount of juror tokens that can be activated
    */
    function _getMinActiveBalance(uint64 _termId) internal view returns (uint256) {
        return _config().getMinActiveBalance(_termId);
    }
}
