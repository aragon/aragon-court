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
  JurorTokensAssigned,
  JurorTokensCollected,
  JurorSlashed,
  JurorsRegistry
} from '../types/templates/JurorsRegistry/JurorsRegistry'

let STAKE = 'Stake'
let UNSTAKE = 'Unstake'
let ACTIVATION = 'Activation'
let DEACTIVATION = 'Deactivation'
let LOCK = 'Lock'
let UNLOCK = 'Unlock'
let REWARD = 'Reward'
let SLASH = 'Slash'

export function handleStaked(event: Staked): void {
  updateJuror(event.params.user, event)
  createANJMovementForEvent(event.params.user, STAKE, event.params.amount, event.block.timestamp, event)
}

export function handleUnstaked(event: Unstaked): void {
  updateJuror(event.params.user, event)
  createANJMovementForEvent(event.params.user, UNSTAKE, event.params.amount, event.block.timestamp, event)
}

export function handleJurorActivated(event: JurorActivated): void {
  updateJuror(event.params.juror, event)
  createANJMovementForTerm(event.params.juror, ACTIVATION, event.params.amount, event.block.timestamp, event.params.fromTermId)
}

export function handleJurorDeactivationRequested(event: JurorDeactivationRequested): void {
  updateJuror(event.params.juror, event)
  createANJMovementForTerm(event.params.juror, DEACTIVATION, event.params.amount, event.block.timestamp, event.params.availableTermId)
}

export function handleJurorDeactivationUpdated(event: JurorDeactivationUpdated): void {
  updateJuror(event.params.juror, event)
  createANJMovementForTerm(event.params.juror, DEACTIVATION, event.params.amount, event.block.timestamp, event.params.availableTermId)
}

export function handleJurorDeactivationProcessed(event: JurorDeactivationProcessed): void {
  updateJuror(event.params.juror, event)
}

export function handleJurorBalanceLocked(event: JurorBalanceLocked): void {
  updateJuror(event.params.juror, event)
  createANJMovementForEvent(event.params.juror, LOCK, event.params.amount, event.block.timestamp, event)
}

export function handleJurorBalanceUnlocked(event: JurorBalanceUnlocked): void {
  updateJuror(event.params.juror, event)
  createANJMovementForEvent(event.params.juror, UNLOCK, event.params.amount, event.block.timestamp, event)
}

export function handleJurorTokensAssigned(event: JurorTokensAssigned): void {
  updateJuror(event.params.juror, event)
  createANJMovementForEvent(event.params.juror, REWARD, event.params.amount, event.block.timestamp, event)
}

export function handleJurorTokensCollected(event: JurorTokensCollected): void {
  updateJuror(event.params.juror, event)
  createANJMovementForTerm(event.params.juror, SLASH, event.params.amount, event.block.timestamp, event.params.effectiveTermId)
}

export function handleJurorSlashed(event: JurorSlashed): void {
  updateJuror(event.params.juror, event)
  createANJMovementForTerm(event.params.juror, SLASH, event.params.amount, event.block.timestamp, event.params.effectiveTermId)
}

function loadOrCreateJuror(jurorAddress: Address, event: EthereumEvent): Juror | null {
  let id = jurorAddress.toHex()
  let juror = Juror.load(id)

  if (juror === null) {
    juror = new Juror(id)
    juror.createdAt = event.block.timestamp
  }

  return juror
}

function updateJuror(jurorAddress: Address, event: EthereumEvent): void {
  let juror = loadOrCreateJuror(jurorAddress, event)
  let registry = JurorsRegistry.bind(event.address)
  let balances = registry.balanceOf(jurorAddress)
  juror.withdrawalsLockTermId = registry.getWithdrawalsLockTermId(jurorAddress)
  juror.activeBalance = balances.value0
  juror.availableBalance = balances.value1
  juror.lockedBalance = balances.value2
  juror.deactivationBalance = balances.value3
  juror.save()
}

function createANJMovementForEvent(juror: Address, type: string, amount: BigInt, createdAt: BigInt, event: EthereumEvent): void {
  let eventId = event.transaction.hash.toHex() + event.logIndex.toString()
  let id = buildANJMovementId(juror, type, eventId)
  createANJMovement(id, juror, type, amount, createdAt)
}

function createANJMovementForTerm(juror: Address, type: string, amount: BigInt, createdAt: BigInt, termId: BigInt): void {
  let id = buildANJMovementId(juror, type, termId.toString())
  createANJMovement(id, juror, type, amount, createdAt, termId)
}

function createANJMovement(id: string, juror: Address, type: string, amount: BigInt, createdAt: BigInt, termId: BigInt | null = null): void {
  let movement = new ANJMovement(id)
  movement.juror = juror.toHex()
  movement.amount = amount
  movement.type = type
  movement.effectiveTermId = termId
  movement.createdAt = createdAt
  movement.save()
}

function buildANJMovementId(juror: Address, type: string, id: string): string {
  return juror.toHex() + '-' + type + '-' + id
}
