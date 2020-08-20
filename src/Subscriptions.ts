import { Address, BigInt, Bytes } from '@graphprotocol/graph-ts'
import { createFeeMovement } from './Treasury'
import { JurorSubscriptionFee, SubscriptionModule, SubscriptionPeriod, AppFee, SubscriptionTokenBalance } from '../types/schema'
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
  let token = loadOrCreateToken(event.params.feeToken, event.address)
  token.totalDonated = token.totalDonated.plus(event.params.feeAmount)
  token.totalCollected = token.totalCollected.plus(event.params.feeAmount)
  token.save()

  updateCurrentSubscriptionPeriod(event.address, event.block.timestamp)
}

export function handleAppFeePaid(event: AppFeePaid): void {
  let subscriptions = Subscriptions.bind(event.address)
  let feeToken = subscriptions.currentFeeToken()
  let token = loadOrCreateToken(feeToken, event.address)
  let appFee = loadOrCreateAppFee(event.params.appId)
  token.totalAppFees = token.totalAppFees.plus(appFee.amount)
  token.totalCollected = token.totalCollected.plus(appFee.amount)
  token.save()

  updateCurrentSubscriptionPeriod(event.address, event.block.timestamp)
}

export function handleFeeTokenChanged(event: FeeTokenChanged): void {
  let subscriptions = SubscriptionModule.load(event.address.toHex())
  subscriptions.feeToken = event.params.currentFeeToken
  subscriptions.save()
}

export function handleGovernorSharePctChanged(event: GovernorSharePctChanged): void {
  let subscriptions = SubscriptionModule.load(event.address.toHex())
  subscriptions.governorSharePct = BigInt.fromI32(event.params.currentGovernorSharePct)
  subscriptions.save()
}

export function handleAppFeeSet(event: AppFeeSet): void {
  let appFee = loadOrCreateAppFee(event.params.appId)
  appFee.isSet = true
  appFee.amount = event.params.amount
  appFee.instance = event.address.toHex()
  appFee.save()
}

export function handleAppFeeUnset(event: AppFeeUnset): void {
  let appFee = loadOrCreateAppFee(event.params.appId)
  appFee.isSet = false
  appFee.amount = BigInt.fromI32(0)
  appFee.save()
}

export function updateCurrentSubscriptionPeriod(module: Address, timestamp: BigInt): void {
  let subscriptions = Subscriptions.bind(module)
  let periodId = subscriptions.getCurrentPeriodId()

  let subscriptionsModule = SubscriptionModule.load(module.toHex())
  subscriptionsModule.currentPeriod = periodId
  subscriptionsModule.save()

  let period = loadOrCreateSubscriptionPeriod(periodId, timestamp)
  let currentPeriod = subscriptions.getPeriod(periodId)
  period.instance = module.toHex()
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

function loadOrCreateToken(tokenAddress: Address, subscriptions: Address): SubscriptionTokenBalance | null {
  let id = buildSubscriptionTokenId(subscriptions, tokenAddress)
  let token = SubscriptionTokenBalance.load(id)

  if (token === null) {
    token = new SubscriptionTokenBalance(id)
    token.totalAppFees = BigInt.fromI32(0)
    token.totalDonated = BigInt.fromI32(0)
    token.totalSubscriptionFees = BigInt.fromI32(0)
    token.totalCollected = BigInt.fromI32(0)
    token.totalGovernorShares = BigInt.fromI32(0)
    token.instance = subscriptions.toHex()
    token.token = tokenAddress.toHex()
  }

  return token
}

function createJurorSubscriptionFee(juror: Address, periodId: BigInt, jurorShare: BigInt): void {
  let feeId = buildJurorSubscriptionFeeId(juror, periodId)
  let fee = new JurorSubscriptionFee(feeId)
  fee.juror = juror.toHex()
  fee.period = periodId.toString()
  fee.amount = jurorShare
  fee.save()
}

function loadOrCreateAppFee(appId: Bytes): AppFee | null {
  let id = appId.toString()
  let appFee = AppFee.load(id)

  if (appFee === null) {
    appFee = new AppFee(id)
  }

  return appFee
}

function buildJurorSubscriptionFeeId(juror: Address, periodId: BigInt): string {
  return juror.toHex().concat(periodId.toString())
}

function buildSubscriptionTokenId(subscriptions: Address, token: Address): string {
  return subscriptions.toHex().concat(token.toHex())
}
