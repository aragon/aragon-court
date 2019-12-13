import { EthereumEvent } from '@graphprotocol/graph-ts'

export function buildId(event: EthereumEvent): string {
  return event.transaction.hash.toHex() + event.logIndex.toString()
}
