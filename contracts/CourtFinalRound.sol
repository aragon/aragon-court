pragma solidity ^0.4.24;

import "./standards/erc900/IStaking.sol";
import "./standards/voting/ICRVoting.sol";

import "@aragon/os/contracts/lib/token/ERC20.sol";
import "@aragon/os/contracts/common/SafeERC20.sol";
import "@aragon/os/contracts/lib/math/SafeMath.sol";


contract CourtFinalRound {
    using SafeMath for uint256;
    using SafeERC20 for ERC20;

    uint256 internal constant FINAL_ROUND_WEIGHT_PRECISION = 1000; // to improve roundings
    uint256 internal constant PCT_BASE = 10000; // ‱

    string internal constant ERROR_NOT_OWNER = "CFR_NOT_OWNER";
    string internal constant ERROR_OWNER_ALREADY_SET = "CRV_OWNER_ALREADY_SET";
    string internal constant ERROR_OVERFLOW = "CFR_OVERFLOW";
    string internal constant ERROR_INVALID_ADJUDICATION_STATE = "CFR_BAD_ADJ_STATE";
    string internal constant ERROR_ROUND_ALREADY_SETTLED = "CFR_ROUND_ALREADY_SETTLED";
    string internal constant ERROR_DEPOSIT_FAILED = "CFR_DEPOSIT_FAILED";
    string internal constant ERROR_INVALID_JUROR = "CFR_BAD_JUROR";
    string internal constant ERROR_ROUND_NOT_SETTLED = "CFR_ROUND_NOT_SETTLED";
    string internal constant ERROR_JUROR_ALREADY_REWARDED = "CFR_JUROR_ALRDY_REWARDED";
    string internal constant ERROR_JUROR_NOT_COHERENT = "CFR_JUROR_INCOHERENT";

    enum AdjudicationState {
        Invalid,
        Commit,
        Reveal,
        Ended
    }

    struct JurorState {
        uint64 weight;
        bool rewarded;
    }

    struct FinalRound {
        mapping (address => JurorState) jurorSlotStates;
        uint256 disputeId;
        uint64 draftTermId;
        uint64 commitTerms;
        uint64 revealTerms;
        uint64 jurorNumber;
        uint16 penaltyPct;
        address triggeredBy;
        bool settledPenalties;
        ERC20 feeToken;
        uint8 winningRuling;
        uint256 coherentJurors;
        uint256 jurorFees;
        // contains all potential penalties from jurors that voted, as they are collected when jurors commit vote
        uint256 collectedTokens;
    }

    ICRVoting internal voting;
    IStaking internal staking;
    address owner;
    uint16 finalRoundReduction; // ‱ of reduction applied for final appeal round (1/10,000)
    uint256 roundId; // Court's roundId for final rounds is always the last one
    mapping (uint256 => FinalRound) finalRounds; // from disputeIds

    event RewardSettled(uint256 indexed disputeId, uint256 indexed roundId, address juror);

    modifier onlyOwner {
        require(msg.sender == address(owner), ERROR_NOT_OWNER);
        _;
    }

    function init(
        address _owner,
        ICRVoting _voting,
        IStaking _staking,
        uint16 _finalRoundReduction,
        uint256 _maxRegularAppealRounds
    )
        external
    {
        require(address(owner) == address(0), ERROR_OWNER_ALREADY_SET);
        owner = _owner;
        voting = _voting;
        staking = _staking;
        _setFinalRoundReduction(_finalRoundReduction);
        _setRoundId(_maxRegularAppealRounds);
    }

    function createRound(
        uint256 _disputeId,
        uint64 _draftTermId,
        address _triggeredby,
        uint64 _termId,
        ERC20 _feeToken,
        uint256 _heartbeatFee,
        uint256 _jurorFee,
        uint16 _penaltyPct,
        uint64 _commitTerms,
        uint64 _revealTerms
    )
        external
        onlyOwner
        returns (uint64 appealJurorNumber)
    {
        FinalRound storage round = finalRounds[_disputeId];

        uint256 jurorFees;
        (appealJurorNumber, jurorFees) = _getAppealDetails(_termId, _jurorFee);
        round.draftTermId = _draftTermId;
        round.jurorNumber = appealJurorNumber;
        round.feeToken = _feeToken;
        round.jurorFees = jurorFees;
        round.penaltyPct = _penaltyPct;
        round.triggeredBy = _triggeredby;
        round.commitTerms = _commitTerms;
        round.revealTerms = _revealTerms;

        uint256 feeAmount = _heartbeatFee + jurorFees;
        if (feeAmount > 0) {
            require(_feeToken.safeTransferFrom(msg.sender, address(staking), feeAmount), ERROR_DEPOSIT_FAILED);
        }
    }

    function getAppealDetails(
        uint64 _termId,
        uint256 _jurorFee
    )
        external
        view
        returns (uint64 appealJurorNumber, uint256 jurorFees)
    {
        return _getAppealDetails(_termId, _jurorFee);
    }

    function settleFinalRoundSlashing(uint256 _disputeId, uint64 _termId) external returns (uint256 collectedTokens) {
        FinalRound storage round = finalRounds[_disputeId];

        require(!round.settledPenalties, ERROR_ROUND_ALREADY_SETTLED);
        require(
            _adjudicationStateAtTerm(round, _termId) == AdjudicationState.Ended,
            ERROR_INVALID_ADJUDICATION_STATE
        );

        // this was accounted for on juror's vote commit
        collectedTokens = round.collectedTokens;

        uint256 voteId = _getVoteId(_disputeId, roundId);
        // TODO: pass as a parameter
        uint8 winningRuling = voting.getWinningRuling(voteId);
        uint256 coherentJurors = voting.getRulingVotes(voteId, winningRuling);
        // No juror was coherent in the round
        if (coherentJurors == 0) {
            // refund fees and burn ANJ
            staking.assignTokens(round.feeToken, round.triggeredBy, round.jurorFees);
            staking.burnJurorTokens(collectedTokens);
        }
        round.winningRuling = winningRuling;
        round.coherentJurors = coherentJurors;
        round.settledPenalties = true;
    }

    /**
     * @notice Claim reward for final round of dispute #`_disputeId` for juror `_juror`
     */
    function settleReward(uint256 _disputeId, address _juror) external {
        FinalRound storage round = finalRounds[_disputeId];
        JurorState storage jurorState = round.jurorSlotStates[_juror];

        require(round.settledPenalties, ERROR_ROUND_NOT_SETTLED);
        require(jurorState.weight > 0, ERROR_INVALID_JUROR);
        require(!jurorState.rewarded, ERROR_JUROR_ALREADY_REWARDED);

        jurorState.rewarded = true;

        uint256 voteId = _getVoteId(_disputeId, roundId);
        uint256 coherentJurors = round.coherentJurors;
        uint8 jurorRuling = voting.getCastVote(voteId, _juror);

        require(jurorRuling == round.winningRuling, ERROR_JUROR_NOT_COHERENT);

        uint256 collectedTokens = round.collectedTokens;

        if (collectedTokens > 0) {
            staking.assignJurorTokens(_juror, jurorState.weight * collectedTokens / coherentJurors);
        }

        uint256 jurorFee = round.jurorFees * jurorState.weight / coherentJurors;
        staking.assignTokens(round.feeToken, _juror, jurorFee);

        emit RewardSettled(_disputeId, roundId, _juror);
    }

    function canCommitFinalRound(
        uint256 _disputeId,
        address _voter,
        uint64 _termId
    )
        external
        returns (uint256 weight)
    {
        FinalRound storage round = finalRounds[_disputeId];

        require(
            _adjudicationStateAtTerm(round, _termId) == AdjudicationState.Commit,
            ERROR_INVALID_ADJUDICATION_STATE
        );

        uint256 weightedPenalty;
        (weight, weightedPenalty) = staking.canCommitFinalRound(_voter, round.draftTermId, _termId, FINAL_ROUND_WEIGHT_PRECISION, round.penaltyPct);

        if (weight > 0) {
            // update round state
            round.collectedTokens += weightedPenalty;
            // This shouldn't overflow. This will always be less than `jurorNumber`, which currenty is uint64 too
            round.jurorSlotStates[_voter].weight = uint64(weight);
        }
    }

    function canRevealFinalRound(
        uint256 _disputeId,
        address _voter,
        uint64 _termId
    )
        external
        view
        returns (uint256 weight)
    {
        FinalRound storage round = finalRounds[_disputeId];

        require(
            _adjudicationStateAtTerm(round, _termId) == AdjudicationState.Reveal,
            ERROR_INVALID_ADJUDICATION_STATE
        );

        return round.jurorSlotStates[_voter].weight;
    }

    function _adjudicationStateAtTerm(
        FinalRound storage _round,
        uint64 _termId
    )
        internal
        view
        returns (AdjudicationState)
    {
        // we use the config for the original draft term and only use the delay for the timing of the rounds
        uint64 draftTermId = _round.draftTermId;

        uint64 revealStart = draftTermId + _round.commitTerms;
        uint64 revealEnd = revealStart + _round.revealTerms;

        if (_termId < draftTermId) {
            return AdjudicationState.Invalid;
        } else if (_termId < revealStart) {
            return AdjudicationState.Commit;
        } else if (_termId < revealEnd) {
            return AdjudicationState.Reveal;
        } else {
            return AdjudicationState.Ended;
        }
    }

    function _setFinalRoundReduction(uint16 _finalRoundReduction) internal {
        require(_finalRoundReduction <= PCT_BASE, ERROR_OVERFLOW);
        finalRoundReduction = _finalRoundReduction;
    }

    function _setRoundId(uint256 _maxRegularAppealRounds) internal {
        roundId = _maxRegularAppealRounds;
    }

    // TODO: gives different results depending on when it's called!! (as it depends on current `termId`)
    function _getAppealDetails(
        uint64 _termId,
        uint256 _jurorFee
    )
        internal
        view
        returns (uint64 appealJurorNumber, uint256 jurorFees)
    {
        // appealJurorNumber
        // the max amount of tokens the tree can hold for this to fit in an uint64 is:
        // 2^64 * jurorMinStake / FINAL_ROUND_WEIGHT_PRECISION
        // (decimals get cancelled in the division). So it seems enough.
        appealJurorNumber = uint64(staking.getFinalRoundJurorNumber(_termId, FINAL_ROUND_WEIGHT_PRECISION));

        // feeAmouunt
        // number of jurors is the number of times the minimum stake is hold in the tree, multiplied by a precision factor for division roundings
        // besides, apply final round discount
        jurorFees = _pct4(appealJurorNumber * _jurorFee / FINAL_ROUND_WEIGHT_PRECISION, finalRoundReduction);
    }

    function _getVoteId(uint256 _disputeId, uint256 _roundId) internal pure returns (uint256) {
        return (_disputeId << 128) + _roundId;
    }

    /*
    function _decodeVoteId(uint256 _voteId) internal pure returns (uint256 disputeId, uint256 voteRoundId) {
        disputeId = _voteId >> 128;
        voteRoundId = _voteId & 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF;
    }
    */

    function _pct4(uint256 _number, uint16 _pct) internal pure returns (uint256) {
        return _number * uint256(_pct) / PCT_BASE;
    }
}
