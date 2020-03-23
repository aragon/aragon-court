import { buildId } from '../helpers/id'
import { Juror, ANJMovement, JurorsRegistryModule } from '../types/schema'
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
  createANJMovementForEvent(event.params.user, STAKE, event.params.amount, event)

  let jurorsRegistry = JurorsRegistryModule.load(event.address.toHex())
  jurorsRegistry.totalStaked = jurorsRegistry.totalStaked.plus(event.params.amount)
  jurorsRegistry.save()
}

export function handleUnstaked(event: Unstaked): void {
  updateJuror(event.params.user, event)
  createANJMovementForEvent(event.params.user, UNSTAKE, event.params.amount, event)

  let jurorsRegistry = JurorsRegistryModule.load(event.address.toHex())
  jurorsRegistry.totalStaked = jurorsRegistry.totalStaked.minus(event.params.amount)
  jurorsRegistry.save()
}

export function handleJurorActivated(event: JurorActivated): void {
  updateJuror(event.params.juror, event)
  createANJMovementForTerm(event.params.juror, ACTIVATION, event.params.amount, event.params.fromTermId, event)

  let jurorsRegistry = JurorsRegistryModule.load(event.address.toHex())
  jurorsRegistry.totalActive = jurorsRegistry.totalActive.plus(event.params.amount)
  jurorsRegistry.save()
}

export function handleJurorDeactivationRequested(event: JurorDeactivationRequested): void {
  updateJuror(event.params.juror, event)
  createANJMovementForTerm(event.params.juror, DEACTIVATION, event.params.amount, event.params.availableTermId, event)
}

export function handleJurorDeactivationUpdated(event: JurorDeactivationUpdated): void {
  updateJuror(event.params.juror, event)
  createANJMovementForTerm(event.params.juror, DEACTIVATION, event.params.amount, event.params.availableTermId, event)
}

export function handleJurorDeactivationProcessed(event: JurorDeactivationProcessed): void {
  updateJuror(event.params.juror, event)

  let jurorsRegistry = JurorsRegistryModule.load(event.address.toHex())
  jurorsRegistry.totalActive = jurorsRegistry.totalActive.minus(event.params.amount)
  jurorsRegistry.save()
}

export function handleJurorBalanceLocked(event: JurorBalanceLocked): void {
  updateJuror(event.params.juror, event)
  createANJMovementForEvent(event.params.juror, LOCK, event.params.amount, event)
}

export function handleJurorBalanceUnlocked(event: JurorBalanceUnlocked): void {
  updateJuror(event.params.juror, event)
  createANJMovementForEvent(event.params.juror, UNLOCK, event.params.amount, event)
}

export function handleJurorTokensAssigned(event: JurorTokensAssigned): void {
  updateJuror(event.params.juror, event)
  createANJMovementForEvent(event.params.juror, REWARD, event.params.amount, event)
}

export function handleJurorTokensCollected(event: JurorTokensCollected): void {
  updateJuror(event.params.juror, event)
  createANJMovementForTerm(event.params.juror, SLASH, event.params.amount, event.params.effectiveTermId, event)
}

export function handleJurorSlashed(event: JurorSlashed): void {
  updateJuror(event.params.juror, event)
  createANJMovementForTerm(event.params.juror, SLASH, event.params.amount, event.params.effectiveTermId, event)
}

function loadOrCreateJuror(jurorAddress: Address, event: EthereumEvent): Juror | null {
  let id = jurorAddress.toHex()
  let juror = Juror.load(id)

  if (juror === null) {
    juror = new Juror(id)
    juror.createdAt = event.block.timestamp
  }

  // Get the tree id
  let registry = JurorsRegistry.bind(event.address)
  // Note that id here is the address, while in JurorRegistry contract means the id in the tree
  let response = registry.getJurorId(jurorAddress)
  juror.treeId = response

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

function createANJMovementForEvent(juror: Address, type: string, amount: BigInt, event: EthereumEvent): void {
  let id = buildId(event)
  createANJMovement(id, juror, type, amount, event.block.timestamp)
}

function createANJMovementForTerm(juror: Address, type: string, amount: BigInt, termId: BigInt, event: EthereumEvent): void {
  let id = buildId(event)
  createANJMovement(id, juror, type, amount, event.block.timestamp, termId)
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
