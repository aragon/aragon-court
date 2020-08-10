import { JurorDraft, Vote } from '../types/schema'
import { buildDraftId, decodeDisputeRoundId, createJurorDraft } from './DisputeManager'
import { VoteCommitted, VoteLeaked, VoteRevealed } from '../types/templates/Voting/Voting'
import { Address, BigInt, ethereum } from '@graphprotocol/graph-ts'
import { Voting } from '../types/templates/Voting/Voting'
import { Controller } from '../types/templates/JurorsRegistry/Controller'

export function handleVoteCommitted(event: VoteCommitted): void {
  let disputeRoundId = event.params.voteId
  let draftId = buildDraftId(disputeRoundId, event.params.voter)
  let draft = loadOrCreateJurorDraft(draftId, disputeRoundId, event.params.voter, event)
  draft.commitment = event.params.commitment
  draft.commitmentDate = event.block.timestamp
  draft.save()

  updateVote(event.params.voteId, event)
}

export function handleVoteLeaked(event: VoteLeaked): void {
  let roundId = event.params.voteId
  let draftId = buildDraftId(roundId, event.params.voter)
  let draft = JurorDraft.load(draftId)
  draft.outcome = event.params.outcome
  draft.leaker = event.params.leaker
  draft.save()

  updateVote(event.params.voteId, event)
}

export function handleVoteRevealed(event: VoteRevealed): void {
  let roundId = event.params.voteId
  let draftId = buildDraftId(roundId, event.params.voter)
  let draft = JurorDraft.load(draftId)
  draft.outcome = event.params.outcome
  draft.revealDate = event.block.timestamp
  draft.save()

  updateVote(event.params.voteId, event)
}

function updateVote(voteId: BigInt, event: ethereum.Event): void {
  let vote = loadOrCreateVote(voteId, event)
  let voting = Voting.bind(event.address)
  let winningOutcome = voting.getWinningOutcome(voteId)
  vote.winningOutcome = castOutcome(winningOutcome)
  vote.save()
}

function loadOrCreateVote(voteId: BigInt, event: ethereum.Event): Vote | null {
  let vote = Vote.load(voteId.toString())

  if (vote === null) {
    vote = new Vote(voteId.toString())
    vote.createdAt = event.block.timestamp
  }

  return vote
}

function loadOrCreateJurorDraft(draftId: string, disputeRoundId: BigInt, jurorAddress: Address, event: ethereum.Event): JurorDraft | null {
  let draft = JurorDraft.load(draftId)

  if (draft === null) {
    let voting = Voting.bind(event.address)
    let controllerAddress = voting.getController()
    let controller = Controller.bind(controllerAddress)
    let disputeManagerAddress = controller.getDisputeManager()
    let disputeRoundIdArray = decodeDisputeRoundId(disputeRoundId)
    draft = createJurorDraft(disputeManagerAddress, disputeRoundIdArray[0], disputeRoundIdArray[1], jurorAddress, event.block.timestamp)
  }

  return draft
}

function castOutcome(outcome: i32): string {
  switch (outcome) {
    case 0: return 'Missing'
    case 1: return 'Leaked'
    case 2: return 'Refused'
    case 3: return 'Against'
    case 4: return 'InFavor'
    default: return 'Unknown'
  }
}
