pragma solidity ^0.5.8;

import "@aragon/os/contracts/lib/token/ERC20.sol";


interface IConfig {

    /**
    * @dev Tell the full Court configuration parameters at a certain term
    * @param _termId Term querying the Court config of
    * @return token Address of the token used to pay for fees
    * @return fees Array containing:
    *         0. jurorFee Amount of fee tokens that is paid per juror per dispute
    *         1. draftFee Amount of fee tokens per juror to cover the drafting cost
    *         2. settleFee Amount of fee tokens per juror to cover round settlement cost
    * @return roundStateDurations Array containing the durations in terms of the different phases of a dispute:
    *         0. commitTerms Commit period duration in terms
    *         1. revealTerms Reveal period duration in terms
    *         2. appealTerms Appeal period duration in terms
    *         3. appealConfirmationTerms Appeal confirmation period duration in terms
    * @return pcts Array containing:
    *         0. penaltyPct Permyriad of min active tokens balance to be locked for each drafted juror (‱ - 1/10,000)
    *         1. finalRoundReduction Permyriad of fee reduction for the last appeal round (‱ - 1/10,000)
    * @return roundParams Array containing params for rounds:
    *         0. firstRoundJurorsNumber Number of jurors to be drafted for the first round of disputes
    *         1. appealStepFactor Increasing factor for the number of jurors of each round of a dispute
    *         2. maxRegularAppealRounds Number of regular appeal rounds before the final round is triggered
    * @return appealCollateralParams Array containing params for appeal collateral:
    *         0. appealCollateralFactor Multiple of juror fees required to appeal a preliminary ruling
    *         1. appealConfirmCollateralFactor Multiple of juror fees required to confirm appeal
    * @return minActiveBalance Minimum amount of tokens jurors have to activate to participate in the Court
    */
    function getConfig(uint64 _termId) external view
        returns (
            ERC20 feeToken,
            uint256[3] memory fees,
            uint64[4] memory roundStateDurations,
            uint16[2] memory pcts,
            uint64[4] memory roundParams,
            uint256[2] memory appealCollateralParams,
            uint256 minActiveBalance
        );

    /**
    * @dev Tell the min active balance config at a certain term
    * @param _termId Term querying the Court config of
    * @return Minimum amount of tokens jurors have to activate to participate in the Court
    */
    function getMinActiveBalance(uint64 _termId) external view returns (uint256);
}
