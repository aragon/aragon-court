import { Arbitrable as ArbitrableTemplate } from '../types/templates'
import { crypto, Bytes, BigInt, Address, ByteArray, EthereumEvent } from '@graphprotocol/graph-ts'
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

export function handleNewDispute(event: NewDispute): void {
  let manager = DisputeManager.bind(event.address)
  let dispute = new Dispute(event.params.disputeId.toString())
  let disputeResult = manager.getDispute(event.params.disputeId)
  dispute.subject = event.params.subject.toHex()
  dispute.metadata = event.params.metadata.toString()
  dispute.possibleRulings = disputeResult.value1
  dispute.state = 'Evidence'
  dispute.finalRuling = disputeResult.value3
  dispute.lastRoundId = disputeResult.value4
  dispute.createTermId = disputeResult.value5
  dispute.createdAt = event.block.timestamp
  dispute.txHash = event.transaction.hash.toHex()
  dispute.save()

  updateRound(event.params.disputeId, dispute.lastRoundId, event)

  ArbitrableTemplate.create(event.params.subject)
  let arbitrable = new Arbitrable(event.params.subject.toHex())
  arbitrable.save()
}

export function handleEvidencePeriodClosed(event: EvidencePeriodClosed): void {
  let dispute = Dispute.load(event.params.disputeId.toString())
  dispute.state = 'Drafting'
  dispute.save()

  updateRound(event.params.disputeId, dispute.lastRoundId, event)
}

export function handleJurorDrafted(event: JurorDrafted): void {
  let manager = DisputeManager.bind(event.address)
  let response = manager.getJuror(event.params.disputeId, event.params.roundId, event.params.juror)
  let roundId = buildRoundId(event.params.disputeId, event.params.roundId)
  let draftId = buildDraftId(roundId, event.params.juror)
  let draft = new JurorDraft(draftId)
  draft.round = roundId.toString()
  draft.juror = event.params.juror.toHex()
  draft.locked = BigInt.fromI32(0) // will be updated in JurorLockedBalance event handler
  draft.weight = response.value0
  draft.rewarded = response.value1
  draft.createdAt = event.block.timestamp
  draft.save()

  createJurorDispute(event.params.disputeId, event.params.juror)

  updateRound(event.params.disputeId, event.params.roundId, event)
}

export function handleDisputeStateChanged(event: DisputeStateChanged): void {
  let dispute = Dispute.load(event.params.disputeId.toString())
  dispute.state = castDisputeState(event.params.state)
  dispute.save()

  updateRound(event.params.disputeId, dispute.lastRoundId, event)
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

  updateAppeal(event.params.disputeId, event.params.roundId, event)
  updateRound(event.params.disputeId, dispute.lastRoundId, event)
}

export function handlePenaltiesSettled(event: PenaltiesSettled): void {
  updateRound(event.params.disputeId, event.params.roundId, event)
}

export function handleRewardSettled(event: RewardSettled): void {
  updateRound(event.params.disputeId, event.params.roundId, event)

  let roundId = buildRoundId(event.params.disputeId, event.params.roundId)
  let draft = JurorDraft.load(buildDraftId(roundId, event.params.juror))
  draft.rewarded = true
  draft.save()
}

export function handleAppealDepositSettled(event: AppealDepositSettled): void {
  let appealId = buildAppealId(event.params.disputeId, event.params.roundId)
  let appeal = Appeal.load(appealId.toString())
  appeal.settled = true
  appeal.save()
}

export function handleRulingComputed(event: RulingComputed): void {
  let dispute = Dispute.load(event.params.disputeId.toString())
  dispute.state = 'Ruled'
  dispute.finalRuling = event.params.ruling
  dispute.save()
}

function updateRound(disputeId: BigInt, roundNumber: BigInt, event: EthereumEvent): void {
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

function loadOrCreateRound(disputeId: BigInt, roundNumber: BigInt, event: EthereumEvent): AdjudicationRound | null {
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

function updateAppeal(disputeId: BigInt, roundNumber: BigInt, event: EthereumEvent): void {
  let appeal = loadOrCreateAppeal(disputeId, roundNumber, event)
  let manager = DisputeManager.bind(event.address)
  let result = manager.getAppeal(disputeId, roundNumber)
  appeal.round = buildRoundId(disputeId, roundNumber).toString()
  appeal.maker = result.value0
  appeal.appealedRuling = result.value1
  appeal.taker = result.value2
  appeal.opposedRuling = result.value3
  appeal.settled = false
  appeal.save()
}

function loadOrCreateAppeal(disputeId: BigInt, roundNumber: BigInt, event: EthereumEvent): Appeal | null {
  let id = buildAppealId(disputeId, roundNumber).toString()
  let appeal = Appeal.load(id)

  if (appeal === null) {
    appeal = new Appeal(id)
    appeal.createdAt = event.block.timestamp
  }

  return appeal
}

export function buildRoundId(disputeId: BigInt, roundNumber: BigInt): BigInt {
  return BigInt.fromI32(2).pow(128).times(disputeId).plus(roundNumber)
}

export function buildDraftId(roundId: BigInt, juror: Address): string {
  // @ts-ignore BigInt is actually a BytesArray under the hood
  return crypto.keccak256(concat(roundId as Bytes, juror)).toHex()
}

export function buildJurorDisputeId(disputeId: BigInt, juror: Address): string {
  // @ts-ignore BigInt is actually a BytesArray under the hood
  return crypto.keccak256(concat(disputeId as Bytes, juror)).toHex()
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
