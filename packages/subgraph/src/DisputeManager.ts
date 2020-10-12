import { concat } from '../helpers/bytes'
import { buildId } from '../helpers/id'
import { createFeeMovement } from './Treasury'
import { tryDecodingAgreementMetadata } from '../helpers/disputable'
import { Arbitrable as ArbitrableTemplate } from '../types/templates'
import { crypto, Bytes, BigInt, Address, ethereum } from '@graphprotocol/graph-ts'
import { AdjudicationRound, Arbitrable, Dispute, Appeal, JurorDispute, JurorDraft } from '../types/schema'
import {
  DisputeManager,
  NewDispute,
  EvidencePeriodClosed,
  JurorDrafted,
  DisputeStateChanged,
  PenaltiesSettled,
  RewardSettled,
  AppealDepositSettled,
  RulingAppealed,
  RulingAppealConfirmed,
  RulingComputed
} from '../types/templates/DisputeManager/DisputeManager'

const JUROR_FEES = 'Juror'
const APPEAL_FEES = 'Appeal'

export function handleNewDispute(event: NewDispute): void {
  let manager = DisputeManager.bind(event.address)
  let dispute = new Dispute(event.params.disputeId.toString())
  let disputeResult = manager.getDispute(event.params.disputeId)
  dispute.subject = event.params.subject.toHexString()
  dispute.metadata = event.params.metadata.toString()
  dispute.rawMetadata = event.params.metadata
  dispute.possibleRulings = disputeResult.value1
  dispute.state = 'Evidence'
  dispute.settledPenalties = false
  dispute.finalRuling = disputeResult.value3
  dispute.lastRoundId = disputeResult.value4
  dispute.createTermId = disputeResult.value5
  dispute.createdAt = event.block.timestamp
  dispute.txHash = event.transaction.hash.toHexString()
  dispute.save()

  updateRound(event.params.disputeId, dispute.lastRoundId, event)
  tryDecodingAgreementMetadata(dispute)

  ArbitrableTemplate.create(event.params.subject)
  let arbitrable = new Arbitrable(event.params.subject.toHexString())
  arbitrable.save()
}

export function handleEvidencePeriodClosed(event: EvidencePeriodClosed): void {
  let dispute = Dispute.load(event.params.disputeId.toString())
  dispute.state = 'Drafting'
  dispute.save()

  updateRound(event.params.disputeId, dispute.lastRoundId, event)
}

export function handleJurorDrafted(event: JurorDrafted): void {
  let draft = createJurorDraft(event.address, event.params.disputeId, event.params.roundId, event.params.juror, event.block.timestamp)
  draft.save()

  createJurorDispute(event.params.disputeId, event.params.juror)

  updateRound(event.params.disputeId, event.params.roundId, event)
}

export function handleDisputeStateChanged(event: DisputeStateChanged): void {
  let dispute = Dispute.load(event.params.disputeId.toString())
  dispute.state = castDisputeState(event.params.state)
  dispute.save()

  updateRound(event.params.disputeId, dispute.lastRoundId, event)

  if (event.params.state === 1) { // Adjudicating
    let round = loadOrCreateRound(event.params.disputeId, dispute.lastRoundId, event)
    round.draftedTermId = round.draftTermId.plus(round.delayedTerms);
    round.save();
  }
}

export function handleRulingAppealed(event: RulingAppealed): void {
  updateRound(event.params.disputeId, event.params.roundId, event)
  updateAppeal(event.params.disputeId, event.params.roundId, event)
}

export function handleRulingAppealConfirmed(event: RulingAppealConfirmed): void {
  let manager = DisputeManager.bind(event.address)
  let dispute = new Dispute(event.params.disputeId.toString())
  let disputeResult = manager.getDispute(event.params.disputeId)
  dispute.state = castDisputeState(disputeResult.value2)
  dispute.lastRoundId = disputeResult.value4
  dispute.save()

  // RulingAppealConfirmed returns next roundId so in order to update the appeal we need the previous round
  updateAppeal(event.params.disputeId, event.params.roundId.minus(BigInt.fromI32(1)), event)
  updateRound(event.params.disputeId, dispute.lastRoundId, event)
}

export function handlePenaltiesSettled(event: PenaltiesSettled): void {
  updateRound(event.params.disputeId, event.params.roundId, event)

  let dispute = Dispute.load(event.params.disputeId.toString())

  // In cases where the penalties are settled before the ruling is executed
  if (dispute.finalRuling === 0) {
    let manager = DisputeManager.bind(event.address)
    let disputeResult = manager.getDispute(event.params.disputeId)
    dispute.finalRuling = disputeResult.value3
  }

  // update dispute settledPenalties if needed
  if (dispute.lastRoundId == event.params.roundId) {
    dispute.settledPenalties = true
  }

  // create movements for appeal fees if there were no coherent jurors
  createAppealFeesForJurorFees(event, event.params.disputeId)
  dispute.save()
}

export function handleRewardSettled(event: RewardSettled): void {
  updateRound(event.params.disputeId, event.params.roundId, event)

  let roundId = buildRoundId(event.params.disputeId, event.params.roundId)
  let draft = JurorDraft.load(buildDraftId(roundId, event.params.juror))
  draft.rewarded = true
  draft.rewardedAt = event.block.timestamp
  draft.save()

  createFeeMovement(JUROR_FEES, event.params.juror, event.params.fees, event)
}

export function handleAppealDepositSettled(event: AppealDepositSettled): void {
  let appealId = buildAppealId(event.params.disputeId, event.params.roundId)
  let appeal = Appeal.load(appealId.toString())
  appeal.settled = true
  appeal.settledAt = event.block.timestamp
  appeal.save()

  createAppealFeesForDeposits(event.params.disputeId, event.params.roundId, appealId, event)
}

export function handleRulingComputed(event: RulingComputed): void {
  let dispute = Dispute.load(event.params.disputeId.toString())
  dispute.state = 'Ruled'
  dispute.finalRuling = event.params.ruling
  dispute.ruledAt = event.block.timestamp
  dispute.save()
}

function updateRound(disputeId: BigInt, roundNumber: BigInt, event: ethereum.Event): void {
  let round = loadOrCreateRound(disputeId, roundNumber, event)
  let manager = DisputeManager.bind(event.address)
  let result = manager.getRound(disputeId, roundNumber)
  round.number = roundNumber
  round.dispute = disputeId.toString()
  round.draftTermId = result.value0
  round.delayedTerms = result.value1
  round.jurorsNumber = result.value2
  round.selectedJurors = result.value3
  round.jurorFees = result.value4
  round.settledPenalties = result.value5
  round.collectedTokens = result.value6
  round.coherentJurors = result.value7
  round.state = castAdjudicationState(result.value8)
  round.stateInt = result.value8
  round.save()
}

function loadOrCreateRound(disputeId: BigInt, roundNumber: BigInt, event: ethereum.Event): AdjudicationRound | null {
  let id = buildRoundId(disputeId, roundNumber).toString()
  let round = AdjudicationRound.load(id)

  if (round === null) {
    round = new AdjudicationRound(id)
    round.vote = id
    round.createdAt = event.block.timestamp
  }

  return round
}

function createJurorDispute(disputeId: BigInt, juror: Address): JurorDispute | null {
  let id = buildJurorDisputeId(disputeId, juror).toString()
  let jurorDispute = JurorDispute.load(id)

  if (jurorDispute === null) {
    jurorDispute = new JurorDispute(id)
    jurorDispute.dispute = disputeId.toString()
    jurorDispute.juror = juror.toHexString()
    jurorDispute.save()
  }

  return jurorDispute
}

function updateAppeal(disputeId: BigInt, roundNumber: BigInt, event: ethereum.Event): void {
  let appeal = loadOrCreateAppeal(disputeId, roundNumber, event)
  let manager = DisputeManager.bind(event.address)
  let result = manager.getAppeal(disputeId, roundNumber)
  let nextRound = manager.getNextRoundDetails(disputeId, roundNumber)

  appeal.round = buildRoundId(disputeId, roundNumber).toString()
  appeal.maker = result.value0
  appeal.appealedRuling = result.value1
  appeal.taker = result.value2
  appeal.opposedRuling = result.value3
  appeal.settled = false
  appeal.appealDeposit = nextRound.value6
  appeal.confirmAppealDeposit = nextRound.value7
  if (appeal.opposedRuling.gt(BigInt.fromI32(0))) {
    appeal.confirmedAt = event.block.timestamp
  }

  appeal.save()
}

function createAppealFeesForDeposits(disputeId: BigInt, roundNumber: BigInt, appealId: BigInt, event: ethereum.Event): void {
  let appeal = Appeal.load(appealId.toString())
  let manager = DisputeManager.bind(event.address)
  let nextRound = manager.getNextRoundDetails(disputeId, roundNumber)
  let totalFees = nextRound.value4

  let maker = Address.fromString(appeal.maker.toHexString())
  let taker = Address.fromString(appeal.taker.toHexString())
  let totalDeposit = appeal.appealDeposit.plus(appeal.confirmAppealDeposit)

  let dispute = Dispute.load(disputeId.toString())
  let finalRuling = BigInt.fromI32(dispute.finalRuling)

  if (appeal.appealedRuling == finalRuling) {
    createFeeMovement(APPEAL_FEES, maker, totalDeposit.minus(totalFees), event)
  } else if (appeal.opposedRuling == finalRuling) {
    createFeeMovement(APPEAL_FEES, taker, totalDeposit.minus(totalFees), event)
  } else {
    let feesRefund = totalFees.div(BigInt.fromI32(2))
    let id = buildId(event)
    createFeeMovement(APPEAL_FEES, maker, appeal.appealDeposit.minus(feesRefund), event, id.concat('-maker'))
    createFeeMovement(APPEAL_FEES, taker, appeal.confirmAppealDeposit.minus(feesRefund), event, id.concat('-taker'))
  }
}

function createAppealFeesForJurorFees(event: PenaltiesSettled, disputeId: BigInt): void {
  let dispute = Dispute.load(disputeId.toString())
  let roundId = buildRoundId(event.params.disputeId, event.params.roundId).toString()
  let round = AdjudicationRound.load(roundId)
  if (round.coherentJurors.isZero()) {
    if (event.params.roundId.isZero()) {
      createFeeMovement(JUROR_FEES, Address.fromString(dispute.subject), round.jurorFees, event)
    } else {
      let previousRoundId = event.params.roundId.minus(BigInt.fromI32(1))
      let appealId = buildAppealId(event.params.disputeId, previousRoundId).toString()
      let appeal = Appeal.load(appealId)
      let refundFees = round.jurorFees.div(BigInt.fromI32(2))
      let id = buildId(event)
      createFeeMovement(APPEAL_FEES, Address.fromString(appeal.maker.toHexString()), refundFees, event, id.concat('-maker'))
      createFeeMovement(APPEAL_FEES, Address.fromString(appeal.taker.toHexString()), refundFees, event, id.concat('-taker'))
    }
  }
}

function loadOrCreateAppeal(disputeId: BigInt, roundNumber: BigInt, event: ethereum.Event): Appeal | null {
  let id = buildAppealId(disputeId, roundNumber).toString()
  let appeal = Appeal.load(id)

  if (appeal === null) {
    appeal = new Appeal(id)
    appeal.createdAt = event.block.timestamp
  }

  return appeal
}

export function createJurorDraft(disputeManagerAddress: Address, disputeId: BigInt, roundId: BigInt, jurorAddress: Address, timestamp: BigInt): JurorDraft {
  let manager = DisputeManager.bind(disputeManagerAddress)
  let response = manager.getJuror(disputeId, roundId, jurorAddress)
  let disputeRoundId = buildRoundId(disputeId, roundId)
  let draftId = buildDraftId(disputeRoundId, jurorAddress)
  let draft = new JurorDraft(draftId)
  draft.round = disputeRoundId.toString()
  draft.juror = jurorAddress.toHexString()
  draft.locked = BigInt.fromI32(0) // will be updated in JurorLockedBalance event handler
  draft.weight = response.value0
  draft.rewarded = response.value1
  draft.createdAt = timestamp

  return draft
}

export function buildRoundId(disputeId: BigInt, roundNumber: BigInt): BigInt {
  return BigInt.fromI32(2).pow(128).times(disputeId).plus(roundNumber)
}

export function decodeDisputeRoundId(disputeRoundId: BigInt): BigInt[] {
  let UINT128 = BigInt.fromI32(2).pow(128)
  let disputeId = disputeRoundId.div(UINT128)
  let roundId = disputeRoundId.mod(UINT128)

  return [disputeId, roundId]
}

export function buildDraftId(roundId: BigInt, juror: Address): string {
  // @ts-ignore BigInt is actually a BytesArray under the hood
  return crypto.keccak256(concat(roundId as Bytes, juror)).toHexString()
}

export function buildJurorDisputeId(disputeId: BigInt, juror: Address): string {
  // @ts-ignore BigInt is actually a BytesArray under the hood
  return crypto.keccak256(concat(disputeId as Bytes, juror)).toHexString()
}

function buildAppealId(disputeId: BigInt, roundId: BigInt): BigInt {
  // There can be only one appeal per dispute round, seems safe doing the same math
  return buildRoundId(disputeId, roundId)
}

function castDisputeState(state: i32): string {
  switch (state) {
    case 0: return 'Drafting'
    case 1: return 'Adjudicating'
    case 2: return 'Ruled'
    default: return 'Unknown'
  }
}

function castAdjudicationState(state: i32): string {
  switch (state) {
    case 0: return 'Invalid'
    case 1: return 'Committing'
    case 2: return 'Revealing'
    case 3: return 'Appealing'
    case 4: return 'ConfirmingAppeal'
    case 5: return 'Ended'
    default: return 'Unknown'
  }
}
