import { AragonCourt } from '../types/AragonCourt/AragonCourt'
import { ERC20 as ERC20Contract } from '../types/AragonCourt/ERC20'
import { BigInt, Address, EthereumEvent } from '@graphprotocol/graph-ts'
import { ERC20, CourtModule, CourtConfig } from '../types/schema'
import { JurorsRegistry as JurorsRegistryContract } from '../types/templates/JurorsRegistry/JurorsRegistry'
import { ANJ, DisputeManager, JurorsRegistry, Treasury, Voting, Subscriptions } from '../types/templates'
import { Heartbeat, ModuleSet, FundsGovernorChanged, ConfigGovernorChanged, ModulesGovernorChanged } from '../types/AragonCourt/AragonCourt'

let DISPUTE_MANAGER_TYPE = 'DisputeManager'
let JURORS_REGISTRY_TYPE = 'JurorsRegistry'
let VOTING_TYPE = 'Voting'
let TREASURY_TYPE = 'Treasury'
let SUBSCRIPTIONS_TYPE = 'Subscriptions'

let DISPUTE_MANAGER_ID = '0x14a6c70f0f6d449c014c7bbc9e68e31e79e8474fb03b7194df83109a2d888ae6'
let JURORS_REGISTRY_ID = '0x3b21d36b36308c830e6c4053fb40a3b6d79dde78947fbf6b0accd30720ab5370'
let VOTING_ID = '0x7cbb12e82a6d63ff16fe43977f43e3e2b247ecd4e62c0e340da8800a48c67346'
let TREASURY_ID = '0x06aa03964db1f7257357ef09714a5f0ca3633723df419e97015e0c7a3e83edb7'
let SUBSCRIPTIONS_ID = '0x2bfa3327fe52344390da94c32a346eeb1b65a8b583e4335a419b9471e88c1365'

export function handleHeartbeat(event: Heartbeat): void {
  let config = loadOrCreateConfig(event.address, event)
  config.currentTerm = event.params.currentTermId

  let court = AragonCourt.bind(event.address)
  config.fundsGovernor = court.getFundsGovernor()
  config.configGovernor = court.getConfigGovernor()
  config.modulesGovernor = court.getModulesGovernor()
  config.save()
}

export function handleFundsGovernorChanged(event: FundsGovernorChanged): void {
  let config = loadOrCreateConfig(event.address, event)
  config.fundsGovernor = event.params.currentGovernor
  config.save()
}

export function handleConfigGovernorChanged(event: ConfigGovernorChanged): void {
  let config = loadOrCreateConfig(event.address, event)
  config.configGovernor = event.params.currentGovernor
  config.save()
}

export function handleModulesGovernorChanged(event: ModulesGovernorChanged): void {
  let config = loadOrCreateConfig(event.address, event)
  config.modulesGovernor = event.params.currentGovernor
  config.save()
}

export function handleModuleSet(event: ModuleSet): void {
  let module = new CourtModule(event.params.id.toHex())
  module.court = event.address.toHex()
  module.address = event.params.addr

  let id = event.params.id.toHexString()
  if (id == JURORS_REGISTRY_ID) {
    JurorsRegistry.create(event.params.addr)
    module.type = JURORS_REGISTRY_TYPE

    let jurorsRegistry = JurorsRegistryContract.bind(event.params.addr)
    let anjAddress = jurorsRegistry.token()
    ANJ.create(anjAddress)

    let anjContract = ERC20Contract.bind(anjAddress)
    let anj = new ERC20(anjAddress.toHex())
    anj.name = anjContract.name()
    anj.symbol = anjContract.symbol()
    anj.decimals = anjContract.decimals()
    anj.save()

    let config = CourtConfig.load(event.address.toHex())
    config.anjToken = anjAddress.toHex()
    config.save()
  }
  else if (id == DISPUTE_MANAGER_ID) {
    DisputeManager.create(event.params.addr)
    module.type = DISPUTE_MANAGER_TYPE
  }
  else if (id == VOTING_ID) {
    Voting.create(event.params.addr)
    module.type = VOTING_TYPE
  }
  else if (id == TREASURY_ID) {
    Treasury.create(event.params.addr)
    module.type = TREASURY_TYPE
  }
  else if (id == SUBSCRIPTIONS_ID) {
    Subscriptions.create(event.params.addr)
    module.type = SUBSCRIPTIONS_TYPE
  }
  else {
    module.type = 'Unknown'
  }

  module.save()
}

function loadOrCreateConfig(courtAddress: Address, event: EthereumEvent): CourtConfig | null {
  let id = courtAddress.toHex()
  let config = CourtConfig.load(id)
  let court = AragonCourt.bind(event.address)

  if (config === null) {
    config = new CourtConfig(id)
    config.currentTerm = BigInt.fromI32(0)
    config.termDuration = court.getTermDuration()
  }

  let result = court.getConfig(config.currentTerm as BigInt)

  let feeTokenAddress = result.value0
  let feeTokenContract = ERC20Contract.bind(feeTokenAddress)
  let feeToken = new ERC20(feeTokenAddress.toHex())
  feeToken.name = feeTokenContract.name()
  feeToken.symbol = feeTokenContract.symbol()
  feeToken.decimals = feeTokenContract.decimals()
  feeToken.save()

  config.feeToken = feeTokenAddress.toHex()
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

  return config
}
