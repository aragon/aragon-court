import { Bytes, BigInt } from '@graphprotocol/graph-ts'
import { Arbitrable as ArbitrableContract } from '../types/DisputeManager/Arbitrable'
import { AdjudicationRound, Arbitrable, Dispute, Appeal, JurorRound } from '../types/schema'
import {
  DisputeManager,
  NewDispute,
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
  dispute.save()

  updateRound(manager, event.params.disputeId, dispute.lastRoundId)

  // TODO: fetch evidence from Arbitrable's emitted event
  let arbitrableContract = ArbitrableContract.bind(event.params.subject)
  let arbitrable = new Arbitrable(event.params.subject.toHex())
  arbitrable.evidence = new Array<Bytes>()
  arbitrable.save()
}

export function handleDisputeStateChanged(event: DisputeStateChanged): void {
  let dispute = new Dispute(event.params.disputeId.toString())
  dispute.state = castDisputeState(event.params.state)
  dispute.save()
}

export function handleRulingAppealed(event: RulingAppealed): void {
  let manager = DisputeManager.bind(event.address)
  updateAppeal(manager, event.params.disputeId, event.params.roundId)
}

export function handleRulingAppealConfirmed(event: RulingAppealConfirmed): void {
  let manager = DisputeManager.bind(event.address)
  updateAppeal(manager, event.params.disputeId, event.params.roundId)
}

export function handlePenaltiesSettled(event: PenaltiesSettled): void {
  let manager = DisputeManager.bind(event.address)
  updateRound(manager, event.params.disputeId, event.params.roundId)
}

export function handleRewardSettled(event: RewardSettled): void {
  // TODO: implement
}

export function handleAppealDepositSettled(event: AppealDepositSettled): void {
  let appeal = new Appeal(buildAppealId(event.params.disputeId, event.params.roundId))
  appeal.settled = true
  appeal.save()
}

export function handleRulingComputed(event: RulingComputed): void {
  let dispute = new Dispute(event.params.disputeId.toString())
  dispute.finalRuling = event.params.ruling
  dispute.save()
}

function updateRound(manager: DisputeManager, disputeId: BigInt, roundId: BigInt): void {
  let round = new AdjudicationRound(buildRoundId(disputeId, roundId))
  let result = manager.getRound(disputeId, roundId)
  round.number = roundId
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

  // This is always called before jurors are settled
  round.settledJurors = new BigInt(0)

  round.save()
}

function updateAppeal(manager: DisputeManager, disputeId: BigInt, roundId: BigInt): void {
  let appealId = buildAppealId(disputeId, roundId)
  let appeal = new Appeal(appealId)
  let result = manager.getAppeal(disputeId, roundId)
  appeal.round = buildRoundId(disputeId, roundId)
  appeal.maker = result.value0
  appeal.appealedRuling = result.value1
  appeal.taker = result.value2
  appeal.opposedRuling = result.value3
  appeal.save()
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

function buildRoundId(disputeId: BigInt, roundId: BigInt): string {
  let id = BigInt.fromI32(2).pow(128).times(disputeId).plus(roundId)
  return id.toString()
}

function buildAppealId(disputeId: BigInt, roundId: BigInt): string {
  // There can be only one appeal per dispute round, seems safe doing the same math
  return buildRoundId(disputeId, roundId)
}
