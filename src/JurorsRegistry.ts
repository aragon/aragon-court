import { Juror, ANJMovement } from '../types/schema'
import { EthereumEvent, Address, BigInt } from '@graphprotocol/graph-ts'
import {
  Staked,
  Unstaked,
  JurorActivated,
  JurorDeactivationProcessed,
  JurorDeactivationRequested,
  JurorDeactivationUpdated,
  JurorBalanceLocked,
  JurorBalanceUnlocked,
  JurorRewarded,
  JurorSlashed,
  JurorsRegistry
} from '../types/JurorsRegistry/JurorsRegistry'

let STAKE = 'Stake'
let UNSTAKE = 'Unstake'
let ACTIVATION = 'Activation'
let DEACTIVATION = 'Deactivation'
let LOCK = 'Lock'
let UNLOCK = 'Unlock'
let REWARD = 'Reward'
let SLASH = 'Slash'

export function handleStaked(event: Staked): void {
  updateJuror(event, event.params.user)
  updateANJMovementForEvent(event.params.user, STAKE, event.params.amount, event.block.timestamp, event)
}

export function handleUnstaked(event: Unstaked): void {
  updateJuror(event, event.params.user)
  updateANJMovementForEvent(event.params.user, UNSTAKE, event.params.amount, event.block.timestamp, event)
}

export function handleJurorActivated(event: JurorActivated): void {
  updateJuror(event, event.params.juror)
  updateANJMovementForTerm(event.params.juror, ACTIVATION, event.params.amount, event.block.timestamp, event.params.fromTermId)
}

export function handleJurorDeactivationRequested(event: JurorDeactivationRequested): void {
  updateJuror(event, event.params.juror)
  updateANJMovementForTerm(event.params.juror, DEACTIVATION, event.params.amount, event.block.timestamp, event.params.availableTermId)
}

export function handleJurorDeactivationUpdated(event: JurorDeactivationUpdated): void {
  updateJuror(event, event.params.juror)
  updateANJMovementForTerm(event.params.juror, DEACTIVATION, event.params.amount, event.block.timestamp, event.params.availableTermId)
}

export function handleJurorDeactivationProcessed(event: JurorDeactivationProcessed): void {
  updateJuror(event, event.params.juror)
}

export function handleJurorBalanceLocked(event: JurorBalanceLocked): void {
  updateJuror(event, event.params.juror)
  updateANJMovementForEvent(event.params.juror, LOCK, event.params.amount, event.block.timestamp, event)
}

export function handleJurorBalanceUnlocked(event: JurorBalanceUnlocked): void {
  updateJuror(event, event.params.juror)
  updateANJMovementForEvent(event.params.juror, UNLOCK, event.params.amount, event.block.timestamp, event)
}

export function handleJurorRewarded(event: JurorRewarded): void {
  updateJuror(event, event.params.juror)
  updateANJMovementForEvent(event.params.juror, REWARD, event.params.amount, event.block.timestamp, event)
}

export function handleJurorSlashed(event: JurorSlashed): void {
  updateJuror(event, event.params.juror)
  updateANJMovementForTerm(event.params.juror, SLASH, event.params.amount, event.block.timestamp, event.params.effectiveTermId)
}

export function updateJuror(event: EthereumEvent, jurorAddress: Address): void {
  let registry = JurorsRegistry.bind(event.address)
  let juror = new Juror(jurorAddress.toHex())
  let balances = registry.balanceOf(jurorAddress)
  juror.createdAt = juror.createdAt || event.block.timestamp
  juror.withdrawalsLockTermId = registry.getWithdrawalsLockTermId(jurorAddress)
  juror.activeBalance = balances.value0
  juror.availableBalance = balances.value1
  juror.lockedBalance = balances.value2
  juror.deactivationBalance = balances.value3
  juror.save()
}

function updateANJMovementForEvent(juror: Address, type: string, amount: BigInt, createdAt: BigInt, event: EthereumEvent): void {
  let eventId = event.transaction.hash.toHex() + event.logIndex.toString()
  let id = buildANJMovementId(juror, type, eventId)
  updateANJMovement(id, juror, type, amount, createdAt)
}

function updateANJMovementForTerm(juror: Address, type: string, amount: BigInt, createdAt: BigInt, termId: BigInt): void {
  let id = buildANJMovementId(juror, type, termId.toString())
  updateANJMovement(id, juror, type, amount, createdAt, termId)
}

function updateANJMovement(id: string, juror: Address, type: string, amount: BigInt, createdAt: BigInt, termId: BigInt | null = null): void {
  let movement = new ANJMovement(id)
  movement.juror = juror.toHex()
  movement.amount = amount
  movement.type = type
  movement.effectiveTermId = termId
  movement.createdAt = createdAt
  movement.save()
}

function buildANJMovementId(juror: Address, type: string, id: string): string {
  return `${juror.toHex()}-${type.toLowerCase()}-${id}`
}
