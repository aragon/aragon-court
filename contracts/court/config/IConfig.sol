pragma solidity ^0.5.8;

import "../../lib/os/ERC20.sol";


interface IConfig {

    /**
    * @dev Tell the full Court configuration parameters at a certain term
    * @param _termId Identification number of the term querying the Court config of
    * @return token Address of the token used to pay for fees
    * @return fees Array containing:
    *         0. jurorFee Amount of fee tokens that is paid per juror per dispute
    *         1. draftFee Amount of fee tokens per juror to cover the drafting cost
    *         2. settleFee Amount of fee tokens per juror to cover round settlement cost
    * @return roundStateDurations Array containing the durations in terms of the different phases of a dispute:
    *         0. evidenceTerms Max submitting evidence period duration in terms
    *         1. commitTerms Commit period duration in terms
    *         2. revealTerms Reveal period duration in terms
    *         3. appealTerms Appeal period duration in terms
    *         4. appealConfirmationTerms Appeal confirmation period duration in terms
    * @return pcts Array containing:
    *         0. penaltyPct Permyriad of min active tokens balance to be locked for each drafted juror (‱ - 1/10,000)
    *         1. finalRoundReduction Permyriad of fee reduction for the last appeal round (‱ - 1/10,000)
    * @return roundParams Array containing params for rounds:
    *         0. firstRoundJurorsNumber Number of jurors to be drafted for the first round of disputes
    *         1. appealStepFactor Increasing factor for the number of jurors of each round of a dispute
    *         2. maxRegularAppealRounds Number of regular appeal rounds before the final round is triggered
    * @return appealCollateralParams Array containing params for appeal collateral:
    *         0. appealCollateralFactor Multiple of dispute fees required to appeal a preliminary ruling
    *         1. appealConfirmCollateralFactor Multiple of dispute fees required to confirm appeal
    * @return jurorsParams Array containing params for juror registry:
    *         0. minActiveBalance Minimum amount of juror tokens that can be activated
    *         1. minMaxPctTotalSupply The min max percent of the total supply a juror can activate, applied for jurorsMinPctApplied active jurors
    *         2. maxMaxPctTotalSupply The max max percent of the total supply a juror can activate, applied for 0 active jurors
    *         3. jurorsMinPctApplied The number of jurors for which the minMaxPctTotalSupply will be applied
    */
    function getConfig(uint64 _termId) external view
        returns (
            ERC20 feeToken,
            uint256[3] memory fees,
            uint64[5] memory roundStateDurations,
            uint16[2] memory pcts,
            uint64[4] memory roundParams,
            uint256[2] memory appealCollateralParams,
            uint256[4] memory jurorsParams
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
    * @return True if the given holder accepts automatic withdrawals of their tokens, false otherwise
    */
    function areWithdrawalsAllowedFor(address _holder) external view returns (bool);
}
