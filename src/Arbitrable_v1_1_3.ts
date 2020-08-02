import { Evidence } from '../types/schema'
import { EvidenceSubmitted } from '../types/templates/Arbitrable_v1_1_3/Arbitrable_v1_1_3'

export function handleEvidenceSubmitted(event: EvidenceSubmitted): void {
  let id = event.transaction.hash.toHex() + event.logIndex.toHex()
  let evidence = new Evidence(id)
  evidence.arbitrable = event.address.toHex()
  evidence.dispute = event.params.disputeId.toString()
  evidence.data = event.params.evidence
  evidence.submitter = event.params.submitter
  evidence.createdAt = event.block.timestamp
  evidence.save()
}
