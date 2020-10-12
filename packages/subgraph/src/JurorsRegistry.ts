import { buildId } from '../helpers/id'
import { Juror, ANJMovement, JurorsRegistryModule } from '../types/schema'
import { ethereum, Address, BigInt } from '@graphprotocol/graph-ts'
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
  increaseTotalStaked(event.address, event.params.amount)
}

export function handleUnstaked(event: Unstaked): void {
  updateJuror(event.params.user, event)
  createANJMovementForEvent(event.params.user, UNSTAKE, event.params.amount, event)
  decreaseTotalStaked(event.address, event.params.amount)
}

export function handleJurorActivated(event: JurorActivated): void {
  updateJuror(event.params.juror, event)
  createANJMovementForTerm(event.params.juror, ACTIVATION, event.params.amount, event.params.fromTermId, event)
  increaseTotalActive(event.address, event.params.amount)
}

export function handleJurorDeactivationRequested(event: JurorDeactivationRequested): void {
  updateJuror(event.params.juror, event)
  createANJMovementForTerm(event.params.juror, DEACTIVATION, event.params.amount, event.params.availableTermId, event)
  increaseTotalDeactivation(event.address, event.params.amount)
}

export function handleJurorDeactivationUpdated(event: JurorDeactivationUpdated): void {
  let juror = loadOrCreateJuror(event.params.juror, event)
  let previousDeactivationAmount = juror.deactivationBalance

  updateJuror(event.params.juror, event)
  createANJMovementForTerm(event.params.juror, DEACTIVATION, event.params.amount, event.params.availableTermId, event)

  let currentDeactivationAmount = event.params.amount
  if (currentDeactivationAmount.gt(previousDeactivationAmount)) {
    increaseTotalDeactivation(event.address, currentDeactivationAmount.minus(previousDeactivationAmount))
  } else {
    decreaseTotalDeactivation(event.address, previousDeactivationAmount.minus(currentDeactivationAmount))
  }
}

export function handleJurorDeactivationProcessed(event: JurorDeactivationProcessed): void {
  updateJuror(event.params.juror, event)
  decreaseTotalActive(event.address, event.params.amount)
  decreaseTotalDeactivation(event.address, event.params.amount)
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
  increaseTotalStaked(event.address, event.params.amount)
}

export function handleJurorTokensCollected(event: JurorTokensCollected): void {
  updateJuror(event.params.juror, event)
  createANJMovementForTerm(event.params.juror, SLASH, event.params.amount, event.params.effectiveTermId, event)
  decreaseTotalActive(event.address, event.params.amount)
}

export function handleJurorSlashed(event: JurorSlashed): void {
  updateJuror(event.params.juror, event)
  createANJMovementForTerm(event.params.juror, SLASH, event.params.amount, event.params.effectiveTermId, event)
  decreaseTotalActive(event.address, event.params.amount)
}

function loadOrCreateJuror(jurorAddress: Address, event: ethereum.Event): Juror | null {
  let id = jurorAddress.toHexString()
  let juror = Juror.load(id)

  if (juror === null) {
    juror = new Juror(id)
    juror.createdAt = event.block.timestamp
  }

  // The juror may have appeared in the system but may not have activated tokens yet, meaning he doesn't have a tree ID yet
  let registry = JurorsRegistry.bind(event.address)
  juror.treeId = registry.getJurorId(jurorAddress)

  return juror
}

function updateJuror(jurorAddress: Address, event: ethereum.Event): void {
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

function createANJMovementForEvent(juror: Address, type: string, amount: BigInt, event: ethereum.Event): void {
  let id = buildId(event)
  createANJMovement(id, juror, type, amount, event.block.timestamp)
}

function createANJMovementForTerm(juror: Address, type: string, amount: BigInt, termId: BigInt, event: ethereum.Event): void {
  let id = buildId(event)
  createANJMovement(id, juror, type, amount, event.block.timestamp, termId)
}

function createANJMovement(id: string, juror: Address, type: string, amount: BigInt, createdAt: BigInt, termId: BigInt | null = null): void {
  let movement = new ANJMovement(id)
  movement.juror = juror.toHexString()
  movement.amount = amount
  movement.type = type
  movement.effectiveTermId = termId
  movement.createdAt = createdAt
  movement.save()
}

function increaseTotalStaked(registryAddress: Address, amount: BigInt): void {
  let jurorsRegistry = JurorsRegistryModule.load(registryAddress.toHexString())
  jurorsRegistry.totalStaked = jurorsRegistry.totalStaked.plus(amount)
  jurorsRegistry.save()
}

function decreaseTotalStaked(registryAddress: Address, amount: BigInt): void {
  let jurorsRegistry = JurorsRegistryModule.load(registryAddress.toHexString())
  jurorsRegistry.totalStaked = jurorsRegistry.totalStaked.minus(amount)
  jurorsRegistry.save()
}

function increaseTotalActive(registryAddress: Address, amount: BigInt): void {
  let jurorsRegistry = JurorsRegistryModule.load(registryAddress.toHexString())
  jurorsRegistry.totalActive = jurorsRegistry.totalActive.plus(amount)
  jurorsRegistry.save()
}

function decreaseTotalActive(registryAddress: Address, amount: BigInt): void {
  let jurorsRegistry = JurorsRegistryModule.load(registryAddress.toHexString())
  jurorsRegistry.totalActive = jurorsRegistry.totalActive.minus(amount)
  jurorsRegistry.save()
}

function increaseTotalDeactivation(registryAddress: Address, amount: BigInt): void {
  let jurorsRegistry = JurorsRegistryModule.load(registryAddress.toHexString())
  jurorsRegistry.totalDeactivation = jurorsRegistry.totalDeactivation.plus(amount)
  jurorsRegistry.save()
}

function decreaseTotalDeactivation(registryAddress: Address, amount: BigInt): void {
  let jurorsRegistry = JurorsRegistryModule.load(registryAddress.toHexString())
  jurorsRegistry.totalDeactivation = jurorsRegistry.totalDeactivation.minus(amount)
  jurorsRegistry.save()
}
