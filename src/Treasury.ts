import { buildId } from '../helpers/id'
import { FeeMovement } from '../types/schema'
import { FeesClaimed } from '../types/templates/Subscriptions/Subscriptions'
import { Assign, Withdraw } from '../types/templates/Treasury/Treasury'

let ASSIGN = 'Assign'
let WITHDRAW = 'Withdraw'
let SUBSCRIPTIONS = 'Subscriptions'

export function handleAssign(event: Assign): void {
  let id = buildId(event)
  let movement = new FeeMovement(id)
  movement.type = ASSIGN
  movement.juror = event.params.to.toHex()
  movement.amount = event.params.amount
  movement.createdAt = event.block.timestamp
  movement.save()
}

export function handleWithdraw(event: Withdraw): void {
  let id = buildId(event)
  let movement = new FeeMovement(id)
  movement.type = WITHDRAW
  movement.juror = event.params.to.toHex()
  movement.amount = event.params.amount
  movement.createdAt = event.block.timestamp
  movement.save()
}

export function handleSubscriptionPaid(event: FeesClaimed): void {
  let id = buildId(event)
  let movement = new FeeMovement(id)
  movement.type = SUBSCRIPTIONS
  movement.juror = event.params.juror.toHex()
  movement.amount = event.params.jurorShare
  movement.createdAt = event.block.timestamp
  movement.save()
}
