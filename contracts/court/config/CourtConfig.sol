pragma solidity ^0.5.8;

import "../../lib/os/ERC20.sol";
import "../../lib/os/SafeMath64.sol";

import "./IConfig.sol";
import "./CourtConfigData.sol";
import "../../lib/PctHelpers.sol";


contract CourtConfig is IConfig, CourtConfigData {
    using SafeMath64 for uint64;
    using PctHelpers for uint256;

    string private constant ERROR_TOO_OLD_TERM = "CONF_TOO_OLD_TERM";
    string private constant ERROR_RULING_OPTIONS_LESS_THAN_MIN = "CONF_RULING_OPTIONS_LESS_THAN_MIN";
    string private constant ERROR_RULING_OPTIONS_MORE_THAN_MAX = "CONF_RULING_OPTIONS_MORE_THAN_MAX";
    string private constant ERROR_INVALID_PENALTY_PCT = "CONF_INVALID_PENALTY_PCT";
    string private constant ERROR_INVALID_FINAL_ROUND_REDUCTION_PCT = "CONF_INVALID_FINAL_ROUND_RED_PCT";
    string private constant ERROR_INVALID_MAX_APPEAL_ROUNDS = "CONF_INVALID_MAX_APPEAL_ROUNDS";
    string private constant ERROR_LARGE_ROUND_PHASE_DURATION = "CONF_LARGE_ROUND_PHASE_DURATION";
    string private constant ERROR_BAD_INITIAL_JURORS_NUMBER = "CONF_BAD_INITIAL_JURORS_NUMBER";
    string private constant ERROR_BAD_APPEAL_STEP_FACTOR = "CONF_BAD_APPEAL_STEP_FACTOR";
    string private constant ERROR_ZERO_COLLATERAL_FACTOR = "CONF_ZERO_COLLATERAL_FACTOR";
    string private constant ERROR_ZERO_MIN_ACTIVE_BALANCE = "CONF_ZERO_MIN_ACTIVE_BALANCE";
    string private constant ERROR_MIN_MAX_TOTAL_SUPPLY_ZERO = "CONF_MIN_MAX_TOTAL_SUPPLY_ZERO";
    string private constant ERROR_INVALID_MAX_MAX_TOTAL_SUPPLY_PCT = "CONF_INVALID_MAX_MAX_TOTAL_SUPPLY_PCT";
    string private constant ERROR_MIN_MORE_THAN_MAX_ACTIVE_PCT = "CONF_MIN_MORE_THAN_MAX_ACTIVE_PCT";

    // Max number of terms that each of the different adjudication states can last (if lasted 1h, this would be a year)
    uint64 internal constant MAX_ADJ_STATE_DURATION = 8670;

    // Cap the max number of regular appeal rounds
    uint256 internal constant MAX_REGULAR_APPEAL_ROUNDS_LIMIT = 10;

    // Future term ID in which a config change has been scheduled
    uint64 private configChangeTermId;

    // List of all the configs used in the Court
    Config[] private configs;

    // List of configs indexed by id
    mapping (uint64 => uint256) private configIdByTerm;

    // Holders opt-in config for automatic withdrawals
    mapping (address => bool) private withdrawalsAllowed;

    event NewConfig(uint64 fromTermId, uint64 courtConfigId);
    event AutomaticWithdrawalsAllowedChanged(address indexed holder, bool allowed);

    /**
    * @dev Constructor function
    * @param _feeToken Address of the token contract that is used to pay for fees
    * @param _fees Array containing:
    *        0. jurorFee Amount of fee tokens that is paid per juror per dispute
    *        1. draftFee Amount of fee tokens per juror to cover the drafting cost
    *        2. settleFee Amount of fee tokens per juror to cover round settlement cost
    * @param _maxRulingOptions Max number of selectable outcomes for each dispute
    * @param _roundParams Array containing durations of phases of a dispute and other params for rounds:
    *        0. evidenceTerms Max submitting evidence period duration in terms
    *        1. commitTerms Commit period duration in terms
    *        2. revealTerms Reveal period duration in terms
    *        3. appealTerms Appeal period duration in terms
    *        4. appealConfirmationTerms Appeal confirmation period duration in terms
    *        5. firstRoundJurorsNumber Number of jurors to be drafted for the first round of disputes
    *        6. appealStepFactor Increasing factor for the number of jurors of each round of a dispute
    *        7. maxRegularAppealRounds Number of regular appeal rounds before the final round is triggered
    *        8. finalRoundLockTerms Number of terms that a coherent juror in a final round is disallowed to withdraw (to prevent 51% attacks)
    * @param _pcts Array containing:
    *        0. penaltyPct Permyriad of min active tokens balance to be locked for each drafted juror (‱ - 1/10,000)
    *        1. finalRoundReduction Permyriad of fee reduction for the last appeal round (‱ - 1/10,000)
    * @param _appealCollateralParams Array containing params for appeal collateral:
    *        0. appealCollateralFactor Multiple of dispute fees required to appeal a preliminary ruling
    *        1. appealConfirmCollateralFactor Multiple of dispute fees required to confirm appeal
    * @param _jurorsParams Array containing params for juror registry:
    *        0. minActiveBalance Minimum amount of juror tokens that can be activated
    *        1. minMaxPctTotalSupply The min max percent of the total supply a juror can activate, applied for total supply active stake
    *        2. maxMaxPctTotalSupply The max max percent of the total supply a juror can activate, applied for 0 active stake
    */
    constructor(
        ERC20 _feeToken,
        uint256[3] memory _fees,
        uint8 _maxRulingOptions,
        uint64[9] memory _roundParams,
        uint16[2] memory _pcts,
        uint256[2] memory _appealCollateralParams,
        uint256[3] memory _jurorsParams
    )
        public
    {
        // Leave config at index 0 empty for non-scheduled config changes
        configs.length = 1;
        _setConfig(
            0,
            0,
            _feeToken,
            _fees,
            _maxRulingOptions,
            _roundParams,
            _pcts,
            _appealCollateralParams,
            _jurorsParams
        );
    }

    /**
    * @notice Set the automatic withdrawals config for the sender to `_allowed`
    * @param _allowed Whether or not the automatic withdrawals are allowed by the sender
    */
    function setAutomaticWithdrawals(bool _allowed) external {
        withdrawalsAllowed[msg.sender] = _allowed;
        emit AutomaticWithdrawalsAllowedChanged(msg.sender, _allowed);
    }

    /**
    * @dev Tell the full Court configuration parameters at a certain term
    * @param _termId Identification number of the term querying the Court config of
    * @return token Address of the token used to pay for fees
    * @return fees Array containing:
    *         0. jurorFee Amount of fee tokens that is paid per juror per dispute
    *         1. draftFee Amount of fee tokens per juror to cover the drafting cost
    *         2. settleFee Amount of fee tokens per juror to cover round settlement cost
    * @return maxRulingOptions Max number of selectable outcomes for each dispute
    * @return roundParams Array containing durations of phases of a dispute and other params for rounds:
    *         0. evidenceTerms Max submitting evidence period duration in terms
    *         1. commitTerms Commit period duration in terms
    *         2. revealTerms Reveal period duration in terms
    *         3. appealTerms Appeal period duration in terms
    *         4. appealConfirmationTerms Appeal confirmation period duration in terms
    *         5. firstRoundJurorsNumber Number of jurors to be drafted for the first round of disputes
    *         6. appealStepFactor Increasing factor for the number of jurors of each round of a dispute
    *         7. maxRegularAppealRounds Number of regular appeal rounds before the final round is triggered
    *         8. finalRoundLockTerms Number of terms that a coherent juror in a final round is disallowed to withdraw (to prevent 51% attacks)
    * @return pcts Array containing:
    *         0. penaltyPct Permyriad of min active tokens balance to be locked for each drafted juror (‱ - 1/10,000)
    *         1. finalRoundReduction Permyriad of fee reduction for the last appeal round (‱ - 1/10,000)
    * @return appealCollateralParams Array containing params for appeal collateral:
    *         0. appealCollateralFactor Multiple of dispute fees required to appeal a preliminary ruling
    *         1. appealConfirmCollateralFactor Multiple of dispute fees required to confirm appeal
    * @return jurorsParams Array containing params for juror registry:
    *         0. minActiveBalance Minimum amount of juror tokens that can be activated
    *         1. minMaxPctTotalSupply The min max percent of the total supply a juror can activate, applied for total supply active stake
    *         2. maxMaxPctTotalSupply The max max percent of the total supply a juror can activate, applied for 0 active stake
    */
    function getConfig(uint64 _termId) external view
        returns (
            ERC20 feeToken,
            uint256[3] memory fees,
            uint8 maxRulingOptions,
            uint64[9] memory roundParams,
            uint16[2] memory pcts,
            uint256[2] memory appealCollateralParams,
            uint256[3] memory jurorsParams
        );

    /**
    * @dev Tell the draft config at a certain term
    * @param _termId Identification number of the term querying the draft config of
    * @return feeToken Address of the token used to pay for fees
    * @return draftFee Amount of fee tokens per juror to cover the drafting cost
    * @return penaltyPct Permyriad of min active tokens balance to be locked for each drafted juror (‱ - 1/10,000)
    */
    function getDraftConfig(uint64 _termId) external view returns (ERC20 feeToken, uint256 draftFee, uint16 penaltyPct);

    /**
    * @dev Tell the min active balance config at a certain term
    * @param _termId Term querying the min active balance config of
    * @return Minimum amount of tokens jurors have to activate to participate in the Court
    */
    function getMinActiveBalance(uint64 _termId) external view returns (uint256);

    /**
    * @dev Tell whether a certain holder accepts automatic withdrawals of tokens or not
    * @param _holder Address of the token holder querying if withdrawals are allowed for
    * @return True if the given holder accepts automatic withdrawals of their tokens, false otherwise
    */
    function areWithdrawalsAllowedFor(address _holder) external view returns (bool) {
        return withdrawalsAllowed[_holder];
    }

    /**
    * @dev Tell the term identification number of the next scheduled config change
    * @return Term identification number of the next scheduled config change
    */
    function getConfigChangeTermId() external view returns (uint64) {
        return configChangeTermId;
    }

    /**
    * @dev Internal to make sure to set a config for the new term, it will copy the previous term config if none
    * @param _termId Identification number of the new current term that has been transitioned
    */
    function _ensureTermConfig(uint64 _termId) internal {
        // If the term being transitioned had no config change scheduled, keep the previous one
        uint256 currentConfigId = configIdByTerm[_termId];
        if (currentConfigId == 0) {
            uint256 previousConfigId = configIdByTerm[_termId.sub(1)];
            configIdByTerm[_termId] = previousConfigId;
        }
    }

    /**
    * @dev Assumes that sender it's allowed (either it's from governor or it's on init)
    * @param _termId Identification number of the current Court term
    * @param _fromTermId Identification number of the term in which the config will be effective at
    * @param _feeToken Address of the token contract that is used to pay for fees.
    * @param _fees Array containing:
    *        0. jurorFee Amount of fee tokens that is paid per juror per dispute
    *        1. draftFee Amount of fee tokens per juror to cover the drafting cost
    *        2. settleFee Amount of fee tokens per juror to cover round settlement cost
    * @param _maxRulingOptions Max number of selectable outcomes for each dispute
    * @param _roundParams Array containing durations of phases of a dispute and other params for rounds:
    *        0. evidenceTerms Max submitting evidence period duration in terms
    *        1. commitTerms Commit period duration in terms
    *        2. revealTerms Reveal period duration in terms
    *        3. appealTerms Appeal period duration in terms
    *        4. appealConfirmationTerms Appeal confirmation period duration in terms
    *        5. firstRoundJurorsNumber Number of jurors to be drafted for the first round of disputes
    *        6. appealStepFactor Increasing factor for the number of jurors of each round of a dispute
    *        7. maxRegularAppealRounds Number of regular appeal rounds before the final round is triggered
    *        8. finalRoundLockTerms Number of terms that a coherent juror in a final round is disallowed to withdraw (to prevent 51% attacks)
    * @param _pcts Array containing:
    *        0. penaltyPct Permyriad of min active tokens balance to be locked for each drafted juror (‱ - 1/10,000)
    *        1. finalRoundReduction Permyriad of fee reduction for the last appeal round (‱ - 1/10,000)
    * @param _appealCollateralParams Array containing params for appeal collateral:
    *        0. appealCollateralFactor Multiple of dispute fees required to appeal a preliminary ruling
    *        1. appealConfirmCollateralFactor Multiple of dispute fees required to confirm appeal
    * @param _jurorsParams Array containing params for juror registry:
    *        0. minActiveBalance Minimum amount of juror tokens that can be activated
    *        1. minMaxPctTotalSupply The min max percent of the total supply a juror can activate, applied for total supply active stake
    *        2. maxMaxPctTotalSupply The max max percent of the total supply a juror can activate, applied for 0 active stake
    */
    function _setConfig(
        uint64 _termId,
        uint64 _fromTermId,
        ERC20 _feeToken,
        uint256[3] memory _fees,
        uint8 _maxRulingOptions,
        uint64[9] memory _roundParams,
        uint16[2] memory _pcts,
        uint256[2] memory _appealCollateralParams,
        uint256[3] memory _jurorsParams
    )
        internal
    {
        // If the current term is not zero, changes must be scheduled at least after the current period.
        // No need to ensure delays for on-going disputes since these already use their creation term for that.
        require(_termId == 0 || _fromTermId > _termId, ERROR_TOO_OLD_TERM);

        require(_maxRulingOptions >= 2, ERROR_RULING_OPTIONS_LESS_THAN_MIN);
        // Ruling options 0, 1 and 2 are reserved for special cases.
        require(_maxRulingOptions <= uint8(-1) - 3, ERROR_RULING_OPTIONS_MORE_THAN_MAX);

        // Make sure appeal collateral factors are greater than zero
        require(_appealCollateralParams[0] > 0 && _appealCollateralParams[1] > 0, ERROR_ZERO_COLLATERAL_FACTOR);

        // Make sure the given penalty and final round reduction pcts are not greater than 100%
        require(PctHelpers.isValid(_pcts[0]), ERROR_INVALID_PENALTY_PCT);
        require(PctHelpers.isValid(_pcts[1]), ERROR_INVALID_FINAL_ROUND_REDUCTION_PCT);

        // Disputes must request at least one juror to be drafted initially
        require(_roundParams[5] > 0, ERROR_BAD_INITIAL_JURORS_NUMBER);

        // Prevent that further rounds have zero jurors
        require(_roundParams[6] > 0, ERROR_BAD_APPEAL_STEP_FACTOR);

        // Make sure the max number of appeals allowed does not reach the limit
        uint256 _maxRegularAppealRounds = _roundParams[7];
        bool isMaxAppealRoundsValid = _maxRegularAppealRounds > 0 && _maxRegularAppealRounds <= MAX_REGULAR_APPEAL_ROUNDS_LIMIT;
        require(isMaxAppealRoundsValid, ERROR_INVALID_MAX_APPEAL_ROUNDS);

        // Make sure each adjudication round phase duration is valid
        for (uint i = 0; i < 5; i++) {
            require(_roundParams[i] > 0 && _roundParams[i] < MAX_ADJ_STATE_DURATION, ERROR_LARGE_ROUND_PHASE_DURATION);
        }

        // Make sure min active balance is not zero
        require(_jurorsParams[0] > 0, ERROR_ZERO_MIN_ACTIVE_BALANCE);
        // Make sure min max pct of total supply active balance is not zero
        require(_jurorsParams[1] > 0, ERROR_MIN_MAX_TOTAL_SUPPLY_ZERO);
        // Make sure the max max pct of total supply active balance is less than 100%
        require(PctHelpers.isValidHighPrecision(_jurorsParams[2]), ERROR_INVALID_MAX_MAX_TOTAL_SUPPLY_PCT);
        // Make sure min max pct of total supply active balance is less than the max max pct of total supply active balance
        require(_jurorsParams[1] < _jurorsParams[2], ERROR_MIN_MORE_THAN_MAX_ACTIVE_PCT);

        // If there was a config change already scheduled, reset it (in that case we will overwrite last array item).
        // Otherwise, schedule a new config.
        if (configChangeTermId > _termId) {
            configIdByTerm[configChangeTermId] = 0;
        } else {
            configs.length++;
        }

        uint64 courtConfigId = uint64(configs.length - 1);
        Config storage config = configs[courtConfigId];

        config.fees = FeesConfig({
            token: _feeToken,
            jurorFee: _fees[0],
            draftFee: _fees[1],
            settleFee: _fees[2],
            finalRoundReduction: _pcts[1]
        });

        config.disputes = DisputesConfig({
            maxRulingOptions: _maxRulingOptions,
            evidenceTerms: _roundParams[0],
            commitTerms: _roundParams[1],
            revealTerms: _roundParams[2],
            appealTerms: _roundParams[3],
            appealConfirmTerms: _roundParams[4],
            penaltyPct: _pcts[0],
            firstRoundJurorsNumber: _roundParams[5],
            appealStepFactor: _roundParams[6],
            maxRegularAppealRounds: _maxRegularAppealRounds,
            finalRoundLockTerms: _roundParams[8],
            appealCollateralFactor: _appealCollateralParams[0],
            appealConfirmCollateralFactor: _appealCollateralParams[1]
        });

        config.jurors = JurorsConfig({
            minActiveBalance: _jurorsParams[0],
            minMaxPctTotalSupply: _jurorsParams[1],
            maxMaxPctTotalSupply: _jurorsParams[2]
        });

        configIdByTerm[_fromTermId] = courtConfigId;
        configChangeTermId = _fromTermId;

        emit NewConfig(_fromTermId, courtConfigId);
    }

    /**
    * @dev Internal function to get the Court config for a given term
    * @param _termId Identification number of the term querying the Court config of
    * @param _lastEnsuredTermId Identification number of the last ensured term of the Court
    * @return token Address of the token used to pay for fees
    * @return fees Array containing:
    *         0. jurorFee Amount of fee tokens that is paid per juror per dispute
    *         1. draftFee Amount of fee tokens per juror to cover the drafting cost
    *         2. settleFee Amount of fee tokens per juror to cover round settlement cost
    * @return maxRulingOptions Max number of selectable outcomes for each dispute
    * @return roundParams Array containing durations of phases of a dispute and other params for rounds:
    *         0. evidenceTerms Max submitting evidence period duration in terms
    *         1. commitTerms Commit period duration in terms
    *         2. revealTerms Reveal period duration in terms
    *         3. appealTerms Appeal period duration in terms
    *         4. appealConfirmationTerms Appeal confirmation period duration in terms
    *         5. firstRoundJurorsNumber Number of jurors to be drafted for the first round of disputes
    *         6. appealStepFactor Increasing factor for the number of jurors of each round of a dispute
    *         7. maxRegularAppealRounds Number of regular appeal rounds before the final round is triggered
    *         8. finalRoundLockTerms Number of terms that a coherent juror in a final round is disallowed to withdraw (to prevent 51% attacks)
    * @return pcts Array containing:
    *         0. penaltyPct Permyriad of min active tokens balance to be locked for each drafted juror (‱ - 1/10,000)
    *         1. finalRoundReduction Permyriad of fee reduction for the last appeal round (‱ - 1/10,000)
    * @return appealCollateralParams Array containing params for appeal collateral:
    *         0. appealCollateralFactor Multiple of dispute fees required to appeal a preliminary ruling
    *         1. appealConfirmCollateralFactor Multiple of dispute fees required to confirm appeal
    * @return jurorsParams Array containing params for juror registry:
    *         0. minActiveBalance Minimum amount of juror tokens that can be activated
    *         1. minMaxPctTotalSupply The min max percent of the total supply a juror can activate, applied for total supply active stake
    *         2. maxMaxPctTotalSupply The max max percent of the total supply a juror can activate, applied for 0 active stake
    */
    function _getConfigAt(uint64 _termId, uint64 _lastEnsuredTermId) internal view
        returns (
            ERC20 feeToken,
            uint256[3] memory fees,
            uint8 maxRulingOptions,
            uint64[9] memory roundParams,
            uint16[2] memory pcts,
            uint256[2] memory appealCollateralParams,
            uint256[3] memory jurorsParams
        )
    {
        Config storage config = _getConfigFor(_termId, _lastEnsuredTermId);

        FeesConfig storage feesConfig = config.fees;
        feeToken = feesConfig.token;
        fees = [feesConfig.jurorFee, feesConfig.draftFee, feesConfig.settleFee];

        DisputesConfig storage disputesConfig = config.disputes;
        maxRulingOptions = disputesConfig.maxRulingOptions;
        roundParams = [
            disputesConfig.evidenceTerms,
            disputesConfig.commitTerms,
            disputesConfig.revealTerms,
            disputesConfig.appealTerms,
            disputesConfig.appealConfirmTerms,
            disputesConfig.firstRoundJurorsNumber,
            disputesConfig.appealStepFactor,
            uint64(disputesConfig.maxRegularAppealRounds),
            disputesConfig.finalRoundLockTerms
        ];
        pcts = [disputesConfig.penaltyPct, feesConfig.finalRoundReduction];
        appealCollateralParams = [disputesConfig.appealCollateralFactor, disputesConfig.appealConfirmCollateralFactor];

        JurorsConfig storage jurorsConfig = config.jurors;
        jurorsParams = [
            jurorsConfig.minActiveBalance,
            jurorsConfig.minMaxPctTotalSupply,
            jurorsConfig.maxMaxPctTotalSupply
        ];
    }

    /**
    * @dev Tell the draft config at a certain term
    * @param _termId Identification number of the term querying the draft config of
    * @param _lastEnsuredTermId Identification number of the last ensured term of the Court
    * @return feeToken Address of the token used to pay for fees
    * @return draftFee Amount of fee tokens per juror to cover the drafting cost
    * @return penaltyPct Permyriad of min active tokens balance to be locked for each drafted juror (‱ - 1/10,000)
    */
    function _getDraftConfig(uint64 _termId,  uint64 _lastEnsuredTermId) internal view
        returns (ERC20 feeToken, uint256 draftFee, uint16 penaltyPct)
    {
        Config storage config = _getConfigFor(_termId, _lastEnsuredTermId);
        return (config.fees.token, config.fees.draftFee, config.disputes.penaltyPct);
    }

    /**
    * @dev Internal function to get the min active balance config for a given term
    * @param _termId Identification number of the term querying the min active balance config of
    * @param _lastEnsuredTermId Identification number of the last ensured term of the Court
    * @return Minimum amount of juror tokens that can be activated at the given term
    */
    function _getMinActiveBalance(uint64 _termId, uint64 _lastEnsuredTermId) internal view returns (uint256) {
        Config storage config = _getConfigFor(_termId, _lastEnsuredTermId);
        return config.jurors.minActiveBalance;
    }

    /**
    * @dev Internal function to get the Court config for a given term
    * @param _termId Identification number of the term querying the min active balance config of
    * @param _lastEnsuredTermId Identification number of the last ensured term of the Court
    * @return Court config for the given term
    */
    function _getConfigFor(uint64 _termId, uint64 _lastEnsuredTermId) internal view returns (Config storage) {
        uint256 id = _getConfigIdFor(_termId, _lastEnsuredTermId);
        return configs[id];
    }

    /**
    * @dev Internal function to get the Court config ID for a given term
    * @param _termId Identification number of the term querying the Court config of
    * @param _lastEnsuredTermId Identification number of the last ensured term of the Court
    * @return Identification number of the config for the given terms
    */
    function _getConfigIdFor(uint64 _termId, uint64 _lastEnsuredTermId) internal view returns (uint256) {
        // If the given term is lower or equal to the last ensured Court term, it is safe to use a past Court config
        if (_termId <= _lastEnsuredTermId) {
            return configIdByTerm[_termId];
        }

        // If the given term is in the future but there is a config change scheduled before it, use the incoming config
        uint64 scheduledChangeTermId = configChangeTermId;
        if (scheduledChangeTermId <= _termId) {
            return configIdByTerm[scheduledChangeTermId];
        }

        // If no changes are scheduled, use the Court config of the last ensured term
        return configIdByTerm[_lastEnsuredTermId];
    }
}
