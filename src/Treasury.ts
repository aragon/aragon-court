import { concat } from '../helpers/bytes'
import { buildId } from '../helpers/id'
import { FeeMovement, TreasuryBalance } from '../types/schema'
import { FeesClaimed, Subscriptions } from '../types/templates/Subscriptions/Subscriptions'
import { Assign, Withdraw, Treasury } from '../types/templates/Treasury/Treasury'
import { crypto, BigInt, Address, EthereumEvent } from '@graphprotocol/graph-ts'

let WITHDRAW = 'Withdraw'
let SUBSCRIPTIONS = 'Subscriptions'

export function handleAssign(event: Assign): void {
  updateTreasuryBalance(event.params.to, event.params.token, event)
}

export function handleWithdraw(event: Withdraw): void {
  createFeeMovement(WITHDRAW, event.params.from, event.params.amount, event)
  updateTreasuryBalance(event.params.to, event.params.token, event)
}

export function handleSubscriptionPaid(event: FeesClaimed): void {
  createFeeMovement(SUBSCRIPTIONS, event.params.juror, event.params.jurorShare, event)
}

export function createFeeMovement(type: string, owner: Address, amount: BigInt, event: EthereumEvent, id: string | null = null): void {
  let feeId = id === null ? buildId(event) : id
  let movement = new FeeMovement(feeId)
  movement.type = type
  movement.owner = owner.toHex()
  movement.amount = amount
  movement.createdAt = event.block.timestamp
  movement.save()
}

function updateTreasuryBalance(owner: Address, token: Address, event: EthereumEvent): void {
  let treasuryBalance = loadOrCreateTreasuryBalance(owner, token)
  let treasury = Treasury.bind(event.address)
  treasuryBalance.amount = treasury.balanceOf(token, owner)
  treasuryBalance.save()
}

function loadOrCreateTreasuryBalance(owner: Address, token: Address): TreasuryBalance | null {
  let id = buildTreasuryBalanceId(token, owner)
  let treasuryBalance = TreasuryBalance.load(id)

  if (treasuryBalance === null) {
    treasuryBalance = new TreasuryBalance(id)
    treasuryBalance.token = token.toHex()
    treasuryBalance.owner = owner.toHex()
  }

  return treasuryBalance
}

function buildTreasuryBalanceId(owner: Address, token: Address): string {
  return crypto.keccak256(concat(owner, token)).toHex()
}
