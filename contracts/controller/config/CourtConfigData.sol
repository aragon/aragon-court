pragma solidity ^0.5.8;

import "@aragon/os/contracts/lib/token/ERC20.sol";


contract CourtConfigData {
    struct Config {
        FeesConfig fees;
        DisputesConfig disputes;
    }

    struct FeesConfig {
        ERC20 token;                            // ERC20 token to be used for the fees of the Court
        uint16 finalRoundReduction;             // Per ten thousand of fees reduction applied for final appeal round (‱ - 1/10,000)
        uint256 jurorFee;                       // Amount of tokens paid to draft a juror to adjudicate a dispute
        uint256 draftFee;                       // Amount of tokens paid per round to cover the costs of drafting jurors
        uint256 settleFee;                      // Amount of tokens paid per round to cover the costs of slashing jurors
    }

    struct DisputesConfig {
        uint64 commitTerms;                     // Committing period duration in terms
        uint64 revealTerms;                     // Revealing period duration in terms
        uint64 appealTerms;                     // Appealing period duration in terms
        uint64 appealConfirmTerms;              // Confirmation appeal period duration in terms
        uint16 penaltyPct;                      // Per ten thousand that will be used to compute the tokens to be locked for drafted jurors
        uint64 firstRoundJurorsNumber;          // Number of jurors drafted on first round
        uint64 appealStepFactor;                // Factor in which the jurors number is increased on each appeal
        uint256 maxRegularAppealRounds;         // Before the final appeal
        uint256 appealCollateralFactor;         // Multiple of juror fees required to appeal a preliminary ruling
        uint256 appealConfirmCollateralFactor;  // Multiple of juror fees required to confirm appeal
    }
}
