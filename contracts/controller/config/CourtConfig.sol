pragma solidity ^0.5.8;

import "@aragon/os/contracts/lib/token/ERC20.sol";

import "./IConfig.sol";
import "./CourtConfigData.sol";
import "../clock/CourtClock.sol";
import "../../lib/PctHelpers.sol";


contract CourtConfig is IConfig, CourtConfigData, CourtClock {
    using PctHelpers for uint256;

    string private constant ERROR_TOO_OLD_TERM = "CT_TOO_OLD_TERM";
    string private constant ERROR_INVALID_PENALTY_PCT = "CONF_INVALID_PENALTY_PCT";
    string private constant ERROR_INVALID_FINAL_ROUND_REDUCTION_PCT = "CONF_INVALID_FINAL_ROUND_RED_PCT";
    string private constant ERROR_INVALID_MAX_APPEAL_ROUNDS = "CONF_INVALID_MAX_APPEAL_ROUNDS";
    string private constant ERROR_LARGE_ROUND_PHASE_DURATION = "CONF_LARGE_ROUND_PHASE_DURATION";
    string private constant ERROR_BAD_INITIAL_JURORS_NUMBER = "CONF_BAD_INITIAL_JURORS_NUMBER";
    string private constant ERROR_BAD_APPEAL_STEP_FACTOR = "CONF_BAD_APPEAL_STEP_FACTOR";
    string private constant ERROR_ZERO_COLLATERAL_FACTOR = "CONF_ZERO_COLLATERAL_FACTOR";

    // Max number of terms that each of the different adjudication states can last (if lasted 1h, this would be a year)
    uint64 internal constant MAX_ADJ_STATE_DURATION = 8670;

    // Cap the max number of regular appeal rounds
    uint256 internal constant MAX_REGULAR_APPEAL_ROUNDS_LIMIT = 10;

    // Future term id in which a config change has been scheduled
    uint64 internal configChangeTermId;

    // List of all the configs used in the Court
    Config[] internal configs;

    // List of configs indexed by id
    mapping (uint64 => uint256) internal configIdByTerm;

    event NewConfig(uint64 fromTermId, uint64 courtConfigId);

    /**
    * @dev Constructor function
    * @param _feeToken Address of the token contract that is used to pay for fees
    * @param _fees Array containing:
    *        0. jurorFee The amount of _feeToken that is paid per juror per dispute
    *        1. draftFee The amount of _feeToken per juror to cover the drafting cost
    *        2. settleFee The amount of _feeToken per juror to cover round settlement cost
    * @param _roundStateDurations Array containing the durations in terms of the different phases of a dispute:
    *        0. commitTerms Commit period duration in terms
    *        1. revealTerms Reveal period duration in terms
    *        2. appealTerms Appeal period duration in terms
    *        3. appealConfirmationTerms Appeal confirmation period duration in terms
    * @param _pcts Array containing:
    *        0. penaltyPct ‱ of minJurorsActiveBalance that can be slashed (1/10,000)
    *        1. finalRoundReduction ‱ of fee reduction for the last appeal round (1/10,000)
    * @param _roundParams Array containing params for rounds:
    *        0. firstRoundJurorsNumber Number of jurors to be drafted for the first round of disputes
    *        1. appealStepFactor Increasing factor for the number of jurors of each round of a dispute
    *        2. maxRegularAppealRounds Number of regular appeal rounds before the final round is triggered
    * @param _appealCollateralParams Array containing params for appeal collateral:
    *        0. appealCollateralFactor Multiple of juror fees required to appeal a preliminary ruling
    *        1. appealConfirmCollateralFactor Multiple of juror fees required to confirm appeal
    */
    constructor(
        ERC20 _feeToken,
        uint256[3] memory _fees,
        uint64[4] memory _roundStateDurations,
        uint16[2] memory _pcts,
        uint64[3] memory _roundParams,
        uint256[2] memory _appealCollateralParams
    )
        public
    {
        // Leave config at index 0 empty for non-scheduled config changes
        configs.length = 1;
        _setConfig(0, 0, _feeToken, _fees, _roundStateDurations, _pcts, _roundParams, _appealCollateralParams);
    }

    /**
    * @dev Get Court configuration parameters
    * @return token Address of the token used to pay for fees
    * @return fees Array containing:
    *         0. jurorFee The amount of _feeToken that is paid per juror per dispute
    *         1. draftFee The amount of _feeToken per juror to cover the drafting cost
    *         2. settleFee The amount of _feeToken per juror to cover round settlement cost
    * @return roundStateDurations Array containing the durations in terms of the different phases of a dispute:
    *         0. commitTerms Commit period duration in terms
    *         1. revealTerms Reveal period duration in terms
    *         2. appealTerms Appeal period duration in terms
    *         3. appealConfirmationTerms Appeal confirmation period duration in terms
    * @return pcts Array containing:
    *         0. penaltyPct ‱ of minJurorsActiveBalance that can be slashed (1/10,000)
    *         1. finalRoundReduction ‱ of fee reduction for the last appeal round (1/10,000)
    * @return roundParams Array containing params for rounds:
    *         0. firstRoundJurorsNumber Number of jurors to be drafted for the first round of disputes
    *         1. appealStepFactor Increasing factor for the number of jurors of each round of a dispute
    *         2. maxRegularAppealRounds Number of regular appeal rounds before the final round is triggered
    * @return appealCollateralParams Array containing params for appeal collateral:
    *         0. appealCollateralFactor Multiple of juror fees required to appeal a preliminary ruling
    *         1. appealConfirmCollateralFactor Multiple of juror fees required to confirm appeal
    */
    function getConfig(uint64 _termId) external view
        returns (
            ERC20 feeToken,
            uint256[3] memory fees,
            uint64[4] memory roundStateDurations,
            uint16[2] memory pcts,
            uint64[3] memory roundParams,
            uint256[2] memory appealCollateralParams
        )
    {
        Config storage config = _getConfigAt(_termId);

        FeesConfig storage feesConfig = config.fees;
        feeToken = feesConfig.token;
        fees = [feesConfig.jurorFee, feesConfig.draftFee, feesConfig.settleFee];

        DisputesConfig storage disputesConfig = config.disputes;
        roundStateDurations = [
            disputesConfig.commitTerms,
            disputesConfig.revealTerms,
            disputesConfig.appealTerms,
            disputesConfig.appealConfirmTerms
        ];
        pcts = [disputesConfig.penaltyPct, feesConfig.finalRoundReduction];
        roundParams = [disputesConfig.firstRoundJurorsNumber, disputesConfig.appealStepFactor, uint64(disputesConfig.maxRegularAppealRounds)];
        appealCollateralParams = [disputesConfig.appealCollateralFactor, disputesConfig.appealConfirmCollateralFactor];
    }

    /**
    * @dev Internal function to update the configs associated to each term of a set of terms
    * @param _lastUpdatedTermId Identification number of the last term that was updated
    * @param _lastTermIdToUpdate Identification number of the last term to be updated
    */
    function _updateTermsConfig(uint64 _lastUpdatedTermId, uint64 _lastTermIdToUpdate) internal {
        uint256 previousConfigId = configIdByTerm[_lastUpdatedTermId];
        for (uint64 updatingTermId = _lastUpdatedTermId + 1; updatingTermId <= _lastTermIdToUpdate; updatingTermId++) {
            // If the term being processed had no config change scheduled, keep the previous one
            uint256 configId = configIdByTerm[updatingTermId];
            if (configId == 0) {
                configId = previousConfigId;
                configIdByTerm[updatingTermId] = configId;
            }
            previousConfigId = configId;
        }
    }

    /**
    * @dev Assumes that sender it's allowed (either it's from governor or it's on init)
    * @param _currentTermId Identification number of the current Court term
    * @param _fromTermId Identification number of the term in which the config will be effective at
    * @param _feeToken Address of the token contract that is used to pay for fees.
    * @param _fees Array containing:
    *        0. jurorFee The amount of _feeToken that is paid per juror per dispute
    *        1. draftFee The amount of _feeToken per juror to cover the drafting cost
    *        2. settleFee The amount of _feeToken per juror to cover round settlement cost
    * @param _roundStateDurations Array containing the durations in terms of the different phases of a dispute:
    *        0. commitTerms Commit period duration in terms
    *        1. revealTerms Reveal period duration in terms
    *        2. appealTerms Appeal period duration in terms
    *        3. appealConfirmationTerms Appeal confirmation period duration in terms
    * @param _pcts Array containing:
    *        0. penaltyPct ‱ of minJurorsActiveBalance that can be slashed (1/10,000)
    *        1. finalRoundReduction ‱ of fee reduction for the last appeal round (1/10,000)
    * @param _roundParams Array containing params for rounds:
    *        0. firstRoundJurorsNumber Number of jurors to be drafted for the first round of disputes
    *        1. appealStepFactor Increasing factor for the number of jurors of each round of a dispute
    *        2. maxRegularAppealRounds Number of regular appeal rounds before the final round is triggered
    * @param _appealCollateralParams Array containing params for appeal collateral:
    *        0. appealCollateralFactor Multiple of juror fees required to appeal a preliminary ruling
    *        1. appealConfirmCollateralFactor Multiple of juror fees required to confirm appeal
    */
    function _setConfig(
        uint64 _currentTermId,
        uint64 _fromTermId,
        ERC20 _feeToken,
        uint256[3] memory _fees,
        uint64[4] memory _roundStateDurations,
        uint16[2] memory _pcts,
        uint64[3] memory _roundParams,
        uint256[2] memory _appealCollateralParams
    )
        internal
    {
        // If the current term is not zero, changes must be scheduled at least 2 terms in the future.
        // This way we can ensure that disputes scheduled for the next term won't have their config changed.
        require(_currentTermId == 0 || _fromTermId > _currentTermId + 1, ERROR_TOO_OLD_TERM);

        // Make sure appeal collateral factors are greater than zero
        require(_appealCollateralParams[0] > 0 && _appealCollateralParams[1] > 0, ERROR_ZERO_COLLATERAL_FACTOR);

        // Make sure the given penalty and final round reduction pcts are not greater than 100%
        require(PctHelpers.isValid(_pcts[0]), ERROR_INVALID_PENALTY_PCT);
        require(PctHelpers.isValid(_pcts[1]), ERROR_INVALID_FINAL_ROUND_REDUCTION_PCT);

        // Disputes must request at least one juror to be drafted initially
        require(_roundParams[0] > 0, ERROR_BAD_INITIAL_JURORS_NUMBER);

        // Prevent that further rounds have zero jurors
        require(_roundParams[1] > 0, ERROR_BAD_APPEAL_STEP_FACTOR);

        // Make sure the max number of appeals allowed does not reach the limit
        uint256 _maxRegularAppealRounds = _roundParams[2];
        bool isMaxAppealRoundsValid = _maxRegularAppealRounds > 0 && _maxRegularAppealRounds <= MAX_REGULAR_APPEAL_ROUNDS_LIMIT;
        require(isMaxAppealRoundsValid, ERROR_INVALID_MAX_APPEAL_ROUNDS);

        // Make sure each adjudication round phase duration is valid
        for (uint i = 0; i < _roundStateDurations.length; i++) {
            require(_roundStateDurations[i] > 0 && _roundStateDurations[i] < MAX_ADJ_STATE_DURATION, ERROR_LARGE_ROUND_PHASE_DURATION);
        }

        // If there was a config change already scheduled, reset it (in that case we will overwrite last array item).
        // Otherwise, schedule a new config.
        if (configChangeTermId > _currentTermId) {
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
            commitTerms: _roundStateDurations[0],
            revealTerms: _roundStateDurations[1],
            appealTerms: _roundStateDurations[2],
            appealConfirmTerms: _roundStateDurations[3],
            penaltyPct: _pcts[0],
            firstRoundJurorsNumber: _roundParams[0],
            appealStepFactor: _roundParams[1],
            maxRegularAppealRounds: _maxRegularAppealRounds,
            appealCollateralFactor: _appealCollateralParams[0],
            appealConfirmCollateralFactor: _appealCollateralParams[1]
        });

        configIdByTerm[_fromTermId] = courtConfigId;
        configChangeTermId = _fromTermId;

        emit NewConfig(_fromTermId, courtConfigId);
    }

    /**
    * @dev Internal function to get the Court config for a given term
    * @param _termId Term querying the Court config of
    * @return Court config for the given term
    */
    function _getConfigAt(uint64 _termId) internal view returns (Config storage) {
        // If the given term is lower or equal to the last ensured Court term, it is safe to use a past Court config
        uint64 lastEnsuredTermId = termId;
        if (_termId <= lastEnsuredTermId) {
            return configs[configIdByTerm[_termId]];
        }

        // If the given term is in the future but there is a config change scheduled before it, use the incoming config
        uint64 scheduledChangeTermId = configChangeTermId;
        if (scheduledChangeTermId <= _termId) {
            return configs[configIdByTerm[scheduledChangeTermId]];
        }

        // If no changes are scheduled, use the Court config of the last ensured term
        return configs[configIdByTerm[lastEnsuredTermId]];
    }
}
