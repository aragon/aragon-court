import { Address, BigInt } from '@graphprotocol/graph-ts'
import { createFeeMovement } from './Treasury'
import { JurorSubscriptionFee, Subscriber, SubscriptionModule, SubscriptionPeriod } from '../types/schema'
import {
  Subscriptions,
  FeesPaid,
  FeesClaimed,
  FeeAmountChanged,
  FeeTokenChanged,
  GovernorSharePctChanged,
  LatePaymentPenaltyPctChanged,
  PrePaymentPeriodsChanged,
  ResumePenaltiesChanged,
} from '../types/templates/Subscriptions/Subscriptions'

let SUBSCRIPTIONS = 'Subscriptions'

export function handleJurorFeesClaimed(event: FeesClaimed): void {
  createFeeMovement(SUBSCRIPTIONS, event.params.juror, event.params.jurorShare, event)

  updateSubscriptionPeriodCheckpoint(event)

  let feeId = buildJurorSubscriptionFeeId(event.params.juror, event.params.periodId)
  let fee = new JurorSubscriptionFee(feeId)
  fee.juror = event.params.juror.toHex()
  fee.period = event.params.periodId.toString()
  fee.amount = event.params.jurorShare
  fee.save()
}

export function handleFeesPaid(event: FeesPaid): void {
  let subscriptions = Subscriptions.bind(event.address)
  let subscriberData = subscriptions.getSubscriber(event.params.subscriber)

  let subscriber = loadOrCreateSubscriber(event)
  subscriber.paused = subscriberData.value1
  subscriber.subscribed = subscriberData.value0
  subscriber.previousDelayedPeriods = subscriberData.value3
  subscriber.lastPaymentPeriodId = event.params.newLastPeriodId
  subscriber.save()

  updateCurrentSubscriptionPeriod(event.address)
}

export function handleFeeTokenChanged(event: FeeTokenChanged): void {
  let subscriptions = SubscriptionModule.load(event.address.toHex())
  subscriptions.feeToken = event.params.currentFeeToken
  subscriptions.save()
}

export function handleFeeAmountChanged(event: FeeAmountChanged): void {
  let subscriptions = SubscriptionModule.load(event.address.toHex())
  subscriptions.feeAmount = event.params.currentFeeAmount
  subscriptions.save()
}

export function handlePrePaymentPeriodsChanged(event: PrePaymentPeriodsChanged): void {
  let subscriptions = SubscriptionModule.load(event.address.toHex())
  subscriptions.prePaymentPeriods = event.params.currentPrePaymentPeriods
  subscriptions.save()
}

export function handleGovernorSharePctChanged(event: GovernorSharePctChanged): void {
  let subscriptions = SubscriptionModule.load(event.address.toHex())
  subscriptions.governorSharePct = BigInt.fromI32(event.params.currentGovernorSharePct)
  subscriptions.save()
}

export function handleLatePaymentPenaltyPctChanged(event: LatePaymentPenaltyPctChanged): void {
  let subscriptions = SubscriptionModule.load(event.address.toHex())
  subscriptions.latePaymentPenaltyPct = BigInt.fromI32(event.params.currentLatePaymentPenaltyPct)
  subscriptions.save()
}

export function handleResumePenaltiesChanged(event: ResumePenaltiesChanged): void {
  let subscriptions = SubscriptionModule.load(event.address.toHex())
  subscriptions.resumePrePaidPeriods = event.params.currentResumePrePaidPeriods
  subscriptions.save()
}

export function updateCurrentSubscriptionPeriod(module: Address): void {
  let subscriptions = Subscriptions.bind(module)
  let periodId = subscriptions.getCurrentPeriodId()

  let subscriptionsModule = SubscriptionModule.load(module.toHex())
  subscriptionsModule.currentPeriod = periodId
  subscriptionsModule.save()

  let period = loadOrCreateSubscriptionPeriod(periodId)
  period.instance = module.toHex()
  period.feeToken = subscriptions.currentFeeToken()
  period.feeAmount = subscriptions.currentFeeAmount()
  period.collectedFees = subscriptions.getCurrentPeriod().value4
  period.save()
}

function updateSubscriptionPeriodCheckpoint(event: FeesClaimed): void {
  let subscriptions = Subscriptions.bind(event.address)
  let periodData = subscriptions.getPeriodBalanceDetails(event.params.periodId)

  let period = loadOrCreateSubscriptionPeriod(event.params.periodId)
  period.balanceCheckpoint = periodData.value0
  period.totalActiveBalance = periodData.value1
  period.save()
}

function loadOrCreateSubscriptionPeriod(periodId: BigInt): SubscriptionPeriod | null {
  let id = periodId.toString()
  let period = SubscriptionPeriod.load(id)

  if (period === null) {
    period = new SubscriptionPeriod(id)
    period.balanceCheckpoint = BigInt.fromI32(0)
    period.totalActiveBalance = BigInt.fromI32(0)
  }

  return period
}

function loadOrCreateSubscriber(event: FeesPaid): Subscriber | null {
  let id = event.params.subscriber.toHex()
  let subscriber = Subscriber.load(id)

  if (subscriber === null) {
    subscriber = new Subscriber(id)
    subscriber.instance = event.address.toHex()
  }

  return subscriber
}

function buildJurorSubscriptionFeeId(juror: Address, periodId: BigInt): string {
  return juror.toHex().concat(periodId.toString())
}
