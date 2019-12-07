import { Arbitrable as ArbitrableContract } from '../types/DisputeManager/Arbitrable'
import { crypto, Bytes, BigInt, Address, ByteArray } from '@graphprotocol/graph-ts'
import { AdjudicationRound, Arbitrable, Dispute, Appeal, JurorDraft } from '../types/schema'
import {
  DisputeManager,
  NewDispute,
  JurorDrafted,
  DisputeStateChanged,
  PenaltiesSettled,
  RewardSettled,
  AppealDepositSettled,
  RulingAppealed,
  RulingAppealConfirmed,
  RulingComputed
} from '../types/DisputeManager/DisputeManager'

export function handleNewDispute(event: NewDispute): void {
  let manager = DisputeManager.bind(event.address)
  let dispute = new Dispute(event.params.disputeId.toString())
  let disputeResult = manager.getDispute(event.params.disputeId)
  dispute.subject = event.params.subject.toHex()
  dispute.metadata = event.params.metadata.toString()
  dispute.possibleRulings = disputeResult.value1
  dispute.state = castDisputeState(disputeResult.value2)
  dispute.finalRuling = disputeResult.value3
  dispute.lastRoundId = disputeResult.value4
  dispute.createTermId = disputeResult.value5
  dispute.createdAt = event.block.timestamp
  dispute.save()

  updateRound(manager, event.params.disputeId, dispute.lastRoundId, event.block.timestamp)

  // TODO: fetch evidence from Arbitrable's emitted event
  let arbitrableContract = ArbitrableContract.bind(event.params.subject)
  let arbitrable = new Arbitrable(event.params.subject.toHex())
  arbitrable.evidence = new Array<Bytes>()
  arbitrable.save()
}

export function handleJurorDrafted(event: JurorDrafted): void {
  let manager = DisputeManager.bind(event.address)
  let response = manager.getJuror(event.params.disputeId, event.params.roundId, event.params.juror)
  let roundId = buildRoundId(event.params.disputeId, event.params.roundId)
  let draftId = buildDraftId(roundId, event.params.juror)
  let draft = new JurorDraft(draftId)
  draft.round = roundId.toString()
  draft.weight = response.value0
  draft.rewarded = response.value1
  draft.locked = BigInt.fromI32(0) // will be updated in JurorLockedBalance event handler
  draft.save()

  updateRound(manager, event.params.disputeId, event.params.roundId)
}

export function handleDisputeStateChanged(event: DisputeStateChanged): void {
  let dispute = new Dispute(event.params.disputeId.toString())
  dispute.state = castDisputeState(event.params.state)
  dispute.save()

  let manager = DisputeManager.bind(event.address)
  updateRound(manager, event.params.disputeId, dispute.lastRoundId)
}

export function handleRulingAppealed(event: RulingAppealed): void {
  let manager = DisputeManager.bind(event.address)
  let dispute = new Dispute(event.params.disputeId.toString())
  updateRound(manager, event.params.disputeId, dispute.lastRoundId)
  updateAppeal(manager, event.params.disputeId, event.params.roundId)
}

export function handleRulingAppealConfirmed(event: RulingAppealConfirmed): void {
  let manager = DisputeManager.bind(event.address)
  let dispute = new Dispute(event.params.disputeId.toString())
  let disputeResult = manager.getDispute(event.params.disputeId)
  dispute.lastRoundId = disputeResult.value4
  dispute.save()

  updateRound(manager, event.params.disputeId, dispute.lastRoundId)
  updateAppeal(manager, event.params.disputeId, event.params.roundId)
}

export function handlePenaltiesSettled(event: PenaltiesSettled): void {
  let manager = DisputeManager.bind(event.address)
  updateRound(manager, event.params.disputeId, event.params.roundId)
}

export function handleRewardSettled(event: RewardSettled): void {
  let manager = DisputeManager.bind(event.address)
  updateRound(manager, event.params.disputeId, event.params.roundId)

  let roundId = buildRoundId(event.params.disputeId, event.params.roundId)
  let draft = new JurorDraft(buildDraftId(roundId, event.params.juror))
  draft.rewarded = true
  draft.save()
}

export function handleAppealDepositSettled(event: AppealDepositSettled): void {
  let appeal = new Appeal(buildAppealId(event.params.disputeId, event.params.roundId).toString())
  appeal.settled = true
  appeal.save()
}

export function handleRulingComputed(event: RulingComputed): void {
  let dispute = new Dispute(event.params.disputeId.toString())
  dispute.finalRuling = event.params.ruling
  dispute.save()
}

function updateRound(manager: DisputeManager, disputeId: BigInt, roundNumber: BigInt, createdAt: BigInt | null = null): void {
  let round = new AdjudicationRound(buildRoundId(disputeId, roundNumber).toString())
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
  round.createdAt = createdAt ? (createdAt as BigInt) : round.createdAt
  round.save()
}

function updateAppeal(manager: DisputeManager, disputeId: BigInt, roundNumber: BigInt): void {
  let appealId = buildAppealId(disputeId, roundNumber).toString()
  let appeal = new Appeal(appealId)
  let result = manager.getAppeal(disputeId, roundNumber)
  appeal.round = buildRoundId(disputeId, roundNumber).toString()
  appeal.maker = result.value0
  appeal.appealedRuling = result.value1
  appeal.taker = result.value2
  appeal.opposedRuling = result.value3
  appeal.save()
}

export function buildRoundId(disputeId: BigInt, roundNumber: BigInt): BigInt {
  return BigInt.fromI32(2).pow(128).times(disputeId).plus(roundNumber)
}

export function buildDraftId(roundId: BigInt, juror: Address): string {
  // @ts-ignore BigInt is actually a BytesArray under the hood
  return crypto.keccak256(concat(roundId as Bytes, juror)).toHex()
}

function buildAppealId(disputeId: BigInt, roundId: BigInt): BigInt {
  // There can be only one appeal per dispute round, seems safe doing the same math
  return buildRoundId(disputeId, roundId)
}

function castDisputeState(state: i32): string {
  switch (state) {
    case 0: return 'PreDraft'
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
    case 5: return 'ConfirmingAppeal'
    case 6: return 'Ended'
    default: return 'Unknown'
  }
}

function concat(a: ByteArray, b: ByteArray): ByteArray {
  let out = new Uint8Array(a.length + b.length)
  for (let i = 0; i < a.length; i++) {
    out[i] = a[i]
  }
  for (let j = 0; j < b.length; j++) {
    out[a.length + j] = b[j]
  }
  return out as ByteArray
}
