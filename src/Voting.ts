import { JurorDraft } from '../types/schema'
import { buildDraftId } from './DisputeManager'
import { VoteCommitted, VoteLeaked, VoteRevealed } from '../types/templates/Voting/Voting'

export function handleVoteCommitted(event: VoteCommitted): void {
  let roundId = event.params.voteId
  let draftId = buildDraftId(roundId, event.params.voter)
  let draft = JurorDraft.load(draftId)
  draft.commitment = event.params.commitment
  draft.save()
}

export function handleVoteLeaked(event: VoteLeaked): void {
  let roundId = event.params.voteId
  let draftId = buildDraftId(roundId, event.params.voter)
  let draft = JurorDraft.load(draftId)
  draft.outcome = event.params.outcome
  draft.leaker = event.params.leaker
  draft.save()
}

export function handleVoteRevealed(event: VoteRevealed): void {
  let roundId = event.params.voteId
  let draftId = buildDraftId(roundId, event.params.voter)
  let draft = JurorDraft.load(draftId)
  draft.outcome = event.params.outcome
  draft.save()
}
