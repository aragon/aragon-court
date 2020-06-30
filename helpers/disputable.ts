import { concat } from './bytes'
import { Agreement } from '../types/templates/DisputeManager/Agreement'
import { Disputable, Dispute } from '../types/schema'
import { crypto, Bytes, Address, BigInt } from '@graphprotocol/graph-ts'

// appId for 'agreement.open.aragonpm.eth'
const AGREEMENT_DISPUTE_HEADER = '34c62f3aec3073826f39c2c35e9a1297d9dbf3cc77472283106f09eee9cf47bf3a'
const AGREEMENT_DISPUTE_METADATA_LENGTH = 65 // "[APP_ID]:[CHALLENGE_ID]" = 32 + 1 + 32

export function tryDecodingAgreementMetadata(dispute: Dispute): void {
  let metadata = dispute.metadata
  if (metadata.length != AGREEMENT_DISPUTE_METADATA_LENGTH) return

  let header = metadata.subarray(0, AGREEMENT_DISPUTE_HEADER.length / 2) as Bytes
  if (header.toHexString().slice(2) != AGREEMENT_DISPUTE_HEADER) return

  let rawChallengeId = metadata.subarray(AGREEMENT_DISPUTE_HEADER.length / 2, metadata.length) as Bytes
  let challengeId = BigInt.fromSignedBytes(rawChallengeId.reverse() as Bytes)
  let agreement = Agreement.bind(Address.fromString(dispute.subject))
  let challengeData = agreement.getChallenge(challengeId)

  if (challengeData.value1.toHexString() != '0x0000000000000000000000000000000000000000') {
    let actionId = challengeData.value0
    let actionData = agreement.getAction(actionId)
    let settingData = agreement.getSetting(actionData.value3)

    let disputable = new Disputable(buildAgreementActionId(agreement._address, challengeId))
    disputable.dispute = dispute.id
    disputable.title = settingData.value1
    disputable.agreement = settingData.value2.toString()
    disputable.actionId = challengeId
    disputable.address = actionData.value0
    disputable.disputableActionId = actionData.value1
    disputable.defendant = actionData.value4
    disputable.plaintiff = challengeData.value1
    disputable.organization = agreement.try_kernel().reverted ? null : agreement.try_kernel().value
    disputable.save()
  }
}

function buildAgreementActionId(agreement: Address, actionId: BigInt): string {
  // @ts-ignore BigInt is actually a BytesArray under the hood
  return crypto.keccak256(concat(agreement, actionId as Bytes)).toHex()
}
