import { Evidence } from '../types/schema'
import { ethereum, Bytes, BigInt, Address } from '@graphprotocol/graph-ts'
import { EvidenceSubmitted as EvidenceSubmittedWithoutArbitrator, EvidenceSubmitted1 as EvidenceSubmittedWithArbitrator } from '../types/templates/Arbitrable/Arbitrable'

export function handleEvidenceSubmittedWithoutArbitrator(event: EvidenceSubmittedWithoutArbitrator): void {
  // This handler function works for the EvidenceSubmitted event supported till Aragon Court v1.1.2
  // Please read the note below about the second EvidenceSubmitted handler function
  handleEvidenceSubmitted(event, event.params.disputeId, event.params.evidence, event.params.submitter)
}

export function handleEvidenceSubmittedWithArbitrator(event: EvidenceSubmittedWithArbitrator): void {
  // This handler function works for the new EvidenceSubmitted event introduced in Aragon Court v1.1.3
  // We need to have a different handler to support the new event signature, this event differs from the
  // previous one by adding the arbitrator address to the logged info
  handleEvidenceSubmitted(event, event.params.disputeId, event.params.evidence, event.params.submitter)
}

function handleEvidenceSubmitted(event: ethereum.Event, disputeId: BigInt, data: Bytes, submitter: Address): void {
  let id = event.transaction.hash.toHexString() + event.logIndex.toHexString()
  let evidence = new Evidence(id)
  evidence.arbitrable = event.address.toHexString()
  evidence.dispute = disputeId.toString()
  evidence.data = data
  evidence.submitter = submitter
  evidence.createdAt = event.block.timestamp
  evidence.save()
}
