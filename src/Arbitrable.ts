import { Arbitrable } from '../types/schema'
import { EvidenceSubmitted } from '../types/templates/Arbitrable/Arbitrable'

export function handleEvidenceSubmitted(event: EvidenceSubmitted): void {
  let arbitrable = Arbitrable.load(event.address.toHex())
  arbitrable.evidence.push(event.params.evidence)
  arbitrable.save()
}
