import { buildId } from '../helpers/id'
import { Address, BigInt, Bytes } from '@graphprotocol/graph-ts'
import { createFeeMovement } from './Treasury'
import { JurorSubscriptionFee, SubscriptionModule, SubscriptionPeriod, AppFee, SubscriptionFeeMovement } from '../types/schema'
import {
  Subscriptions,
  FeesClaimed as FeesClaimedWithToken,
  FeesClaimed1 as FeesClaimedWithoutToken,
  FeesDonated,
  FeeTokenChanged,
  GovernorSharePctChanged,
  AppFeeSet,
  AppFeeUnset,
  AppFeePaid,
} from '../types/templates/Subscriptions/Subscriptions'

let SUBSCRIPTIONS = 'Subscriptions'

export function handleJurorFeesClaimedWithoutToken(event: FeesClaimedWithoutToken): void {
  // This handler function works for the FeesClaimed event supported till Aragon Court v1.1.3
  // Please read the note below about the second FeesClaimed handler function
  createFeeMovement(SUBSCRIPTIONS, event.params.juror, event.params.jurorShare, event)
  createJurorSubscriptionFee(event.params.juror, event.params.periodId, event.params.jurorShare)
}

export function handleJurorFeesClaimedWithToken(event: FeesClaimedWithToken): void {
  // This handler function works for the new FeesClaimed event introduced in Aragon Court v1.2.0
  // We need to have a different handler to support the new event signature, this event differs from the
  // previous one by adding the arbitrator address to the logged info
  createFeeMovement(SUBSCRIPTIONS, event.params.juror, event.params.jurorShare, event)
  createJurorSubscriptionFee(event.params.juror, event.params.periodId, event.params.jurorShare)
}

export function handleFeesDonated(event: FeesDonated): void {
  updateCurrentSubscriptionPeriod(event.address, event.block.timestamp)

  let subscriptions = Subscriptions.bind(event.address)
  let currentPeriod = subscriptions.getPeriod(event.params.periodId)

  const id = buildId(event)
  const movement = new SubscriptionFeeMovement(id)
  movement.type = 'Donation'
  movement.token = currentPeriod.value0
  movement.period = event.params.periodId.toString()
  movement.payer = event.params.payer
  movement.amount = event.params.feeAmount
  movement.createdAt = event.block.timestamp
  movement.save()
}

export function handleAppFeePaid(event: AppFeePaid): void {
  updateCurrentSubscriptionPeriod(event.address, event.block.timestamp)

  let subscriptions = Subscriptions.bind(event.address)
  let periodId = subscriptions.getCurrentPeriodId()
  let currentPeriod = subscriptions.getPeriod(periodId)
  const appFee = loadOrCreateAppFee(event.params.appId)

  const id = buildId(event)
  const movement = new SubscriptionFeeMovement(id)
  movement.type = 'AppFee'
  movement.token = currentPeriod.value0
  movement.period = periodId.toString()
  movement.payer = event.params.by
  movement.amount = appFee.amount
  movement.appId = event.params.appId
  movement.data = event.params.data
  movement.createdAt = event.block.timestamp
  movement.save()
}

export function handleFeeTokenChanged(event: FeeTokenChanged): void {
  let subscriptions = SubscriptionModule.load(event.address.toHexString())
  subscriptions.feeToken = event.params.currentFeeToken
  subscriptions.save()
}

export function handleGovernorSharePctChanged(event: GovernorSharePctChanged): void {
  let subscriptions = SubscriptionModule.load(event.address.toHexString())
  subscriptions.governorSharePct = BigInt.fromI32(event.params.currentGovernorSharePct)
  subscriptions.save()
}

export function handleAppFeeSet(event: AppFeeSet): void {
  let appFee = loadOrCreateAppFee(event.params.appId)
  appFee.amount = event.params.amount
  appFee.instance = event.address.toHexString()
  appFee.save()
}

export function handleAppFeeUnset(event: AppFeeUnset): void {
  let appFee = loadOrCreateAppFee(event.params.appId)
  appFee.amount = BigInt.fromI32(0)
  appFee.save()
}

export function updateCurrentSubscriptionPeriod(module: Address, timestamp: BigInt): void {
  let subscriptions = Subscriptions.bind(module)
  let periodId = subscriptions.getCurrentPeriodId()

  let subscriptionsModule = loadOrCreateModule(module)
  subscriptionsModule.currentPeriod = periodId
  subscriptionsModule.save()

  let period = loadOrCreateSubscriptionPeriod(periodId, timestamp)
  let currentPeriod = subscriptions.getPeriod(periodId)
  period.instance = module.toHexString()
  period.feeToken = currentPeriod.value0
  period.balanceCheckpoint = currentPeriod.value1
  period.totalActiveBalance = currentPeriod.value2
  period.collectedFees = currentPeriod.value3
  period.accumulatedGovernorFees = currentPeriod.value4
  period.save()
}

function loadOrCreateSubscriptionPeriod(periodId: BigInt, timestamp: BigInt): SubscriptionPeriod | null {
  let id = periodId.toString()
  let period = SubscriptionPeriod.load(id)

  if (period === null) {
    period = new SubscriptionPeriod(id)
    period.createdAt = timestamp
  }

  return period
}

function createJurorSubscriptionFee(juror: Address, periodId: BigInt, jurorShare: BigInt): void {
  let feeId = buildJurorSubscriptionFeeId(juror, periodId)
  let fee = new JurorSubscriptionFee(feeId)
  fee.juror = juror.toHexString()
  fee.period = periodId.toString()
  fee.amount = jurorShare
  fee.save()
}

function loadOrCreateAppFee(appId: Bytes): AppFee | null {
  let id = appId.toHexString()
  let appFee = AppFee.load(id)

  if (appFee === null) {
    appFee = new AppFee(id)
  }

  return appFee
}

function loadOrCreateModule(address: Address): SubscriptionModule {
  let subscriptionModule = SubscriptionModule.load(address.toHexString())

  if (subscriptionModule === null) {
    subscriptionModule = new SubscriptionModule(address.toHexString())
    let subscriptions = Subscriptions.bind(address)
    subscriptionModule.court = subscriptions.getController().toHexString()
    subscriptionModule.currentPeriod = BigInt.fromI32(0)
    subscriptionModule.governorSharePct = BigInt.fromI32(subscriptions.governorSharePct())
    subscriptionModule.feeToken = subscriptions.currentFeeToken()
    subscriptionModule.periodDuration = subscriptions.periodDuration()
  }

  return subscriptionModule!
}

function buildJurorSubscriptionFeeId(juror: Address, periodId: BigInt): string {
  return juror.toHexString().concat(periodId.toString())
}
