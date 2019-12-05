import { BigInt } from '@graphprotocol/graph-ts'
import { AragonCourt } from '../types/AragonCourt/AragonCourt'
import { CourtModule, CourtConfig } from '../types/schema'
import { Heartbeat, ModuleSet, FundsGovernorChanged, ConfigGovernorChanged, ModulesGovernorChanged } from '../types/AragonCourt/AragonCourt'

export function handleHeartbeat(event: Heartbeat): void {
  let court = AragonCourt.bind(event.address)
  let config = new CourtConfig(event.address.toHex())

  config.currentTerm = event.params.currentTermId
  config.termDuration = court.getTermDuration()

  let result = court.getConfig(config.currentTerm as BigInt)
  config.feeToken = result.value0
  config.jurorFee = result.value1[0]
  config.draftFee = result.value1[1]
  config.settleFee = result.value1[2]
  config.evidenceTerms = result.value2[0]
  config.commitTerms = result.value2[1]
  config.revealTerms = result.value2[2]
  config.appealTerms = result.value2[3]
  config.appealConfirmationTerms = result.value2[4]
  config.penaltyPct = result.value3[0]
  config.finalRoundReduction = result.value3[1]
  config.firstRoundJurorsNumber = result.value4[0]
  config.appealStepFactor = result.value4[1]
  config.maxRegularAppealRounds = result.value4[2]
  config.finalRoundLockTerms = result.value4[3]
  config.appealCollateralFactor = result.value5[0]
  config.appealConfirmCollateralFactor = result.value5[1]
  config.minActiveBalance = result.value6

  config.fundsGovernor = court.getFundsGovernor()
  config.configGovernor = court.getConfigGovernor()
  config.modulesGovernor = court.getModulesGovernor()
  config.save()
}

export function handleFundsGovernorChanged(event: FundsGovernorChanged): void {
  let config = new CourtConfig(event.address.toHex())
  config.fundsGovernor = event.params.currentGovernor
  config.save()
}

export function handleConfigGovernorChanged(event: ConfigGovernorChanged): void {
  let config = new CourtConfig(event.address.toHex())
  config.configGovernor = event.params.currentGovernor
  config.save()
}

export function handleModulesGovernorChanged(event: ModulesGovernorChanged): void {
  let config = new CourtConfig(event.address.toHex())
  config.modulesGovernor = event.params.currentGovernor
  config.save()
}

export function handleModuleSet(event: ModuleSet): void {
  let module = new CourtModule(event.params.id.toHex())
  module.court = event.address.toHex()
  module.address = event.params.addr
  module.save()
}
