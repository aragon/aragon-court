import { Address, BigInt } from '@graphprotocol/graph-ts'
import { Transfer as TransferEvent } from '../types/templates/ANJ/ANJ'
import { ANJBalance as Balance, ANJTransfer as Transfer } from '../types/schema'

export function handleTransfer(event: TransferEvent): void {
  let id = event.transaction.hash.toHex() + event.logIndex.toHex()
  let transfer = new Transfer(id)
  transfer.from = event.params._from
  transfer.to = event.params._to
  transfer.amount = event.params._amount
  transfer.save()

  let sender = loadOrCreateBalance(event.params._from)
  sender.amount = sender.amount.minus(event.params._amount)
  sender.save()

  let recipient = loadOrCreateBalance(event.params._to)
  recipient.amount = recipient.amount.plus(event.params._amount)
  recipient.save()
}

function loadOrCreateBalance(owner: Address): Balance | null {
  let id = owner.toHex()
  let balance = Balance.load(id)

  if (balance === null) {
    balance = new Balance(id)
    balance.owner = owner
    balance.amount = new BigInt(0)
  }

  return balance
}
