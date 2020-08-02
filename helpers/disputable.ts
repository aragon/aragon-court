import { concat } from './bytes'
import { Agreement } from '../types/templates/DisputeManager/Agreement'
import { Disputable, Dispute } from '../types/schema'
import { crypto, Bytes, Address, BigInt } from '@graphprotocol/graph-ts'

// appId for 'agreement.open.aragonpm.eth'
const AGREEMENT_DISPUTE_HEADER = '34c62f3aec3073826f39c2c35e9a1297d9dbf3cc77472283106f09eee9cf47bf'
const AGREEMENT_DISPUTE_METADATA_LENGTH = 64 // "[APP_ID][CHALLENGE_ID]" = 32 + 32

export function tryDecodingAgreementMetadata(dispute: Dispute): void {
  let metadata = dispute.metadata
  if (metadata.length != AGREEMENT_DISPUTE_METADATA_LENGTH) return

  let header = metadata.subarray(0, AGREEMENT_DISPUTE_HEADER.length / 2) as Bytes
  if (header.toHexString().slice(2) != AGREEMENT_DISPUTE_HEADER) return

  let rawChallengeId = metadata.subarray(AGREEMENT_DISPUTE_HEADER.length / 2, metadata.length) as Bytes
  let challengeId = BigInt.fromSignedBytes(rawChallengeId.reverse() as Bytes)
  let agreement = Agreement.bind(Address.fromString(dispute.subject))
  let challengeData = agreement.try_getChallenge(challengeId)
  if (challengeData.reverted || challengeData.value.value1.toHexString() == '0x0000000000000000000000000000000000000000') return

  let actionId = challengeData.value.value0
  let actionData = agreement.try_getAction(actionId)
  if (actionData.reverted) return

  let settingData = agreement.try_getSetting(actionData.value.value3)
  if (settingData.reverted) return

  let organization = agreement.try_kernel()
  if (organization.reverted) return

  let disputable = new Disputable(buildAgreementActionId(agreement._address, challengeId))
  disputable.dispute = dispute.id
  disputable.title = settingData.value.value2
  disputable.agreement = settingData.value.value3.toString()
  disputable.actionId = actionId
  disputable.challengeId = challengeId
  disputable.address = actionData.value.value0
  disputable.disputableActionId = actionData.value.value1
  disputable.defendant = actionData.value.value4
  disputable.plaintiff = challengeData.value.value1
  disputable.organization = organization.value
  disputable.save()
}

function buildAgreementActionId(agreement: Address, actionId: BigInt): string {
  // @ts-ignore BigInt is actually a BytesArray under the hood
  return crypto.keccak256(concat(agreement, actionId as Bytes)).toHex()
}
