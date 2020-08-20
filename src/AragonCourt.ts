import { AragonCourt } from '../types/AragonCourt/AragonCourt'
import { BLACKLISTED_MODULES } from '../helpers/blacklisted-modules'
import { ERC20 as ERC20Contract } from '../types/AragonCourt/ERC20'
import { BigInt, Address, ethereum } from '@graphprotocol/graph-ts'
import { updateCurrentSubscriptionPeriod } from './Subscriptions'
import { Subscriptions as SubscriptionsContract } from '../types/templates/Subscriptions/Subscriptions'
import { JurorsRegistry as JurorsRegistryContract } from '../types/templates/JurorsRegistry/JurorsRegistry'
import { ERC20, CourtModule, CourtConfig, CourtTerm, SubscriptionModule, JurorsRegistryModule } from '../types/schema'
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

  let previousTerm = loadOrCreateTerm(event.params.previousTermId, event)
  let previousTermResult = court.getTerm(event.params.previousTermId)
  previousTerm.court = event.address.toHex()
  previousTerm.startTime = previousTermResult.value0
  previousTerm.randomnessBN = previousTermResult.value1
  previousTerm.randomness = previousTermResult.value2
  previousTerm.save()

  let currentTerm = loadOrCreateTerm(event.params.currentTermId, event)
  let currentTermResult = court.getTerm(event.params.currentTermId)
  currentTerm.court = event.address.toHex()
  currentTerm.startTime = currentTermResult.value0
  currentTerm.randomnessBN = currentTermResult.value1
  currentTerm.randomness = currentTermResult.value2
  currentTerm.save()

  let subscriptions = court.getSubscriptions()
  if (!isModuleBlacklisted(subscriptions)) {
    updateCurrentSubscriptionPeriod(subscriptions, event.block.timestamp)
  }
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
  let newModuleAddress: Address = event.params.addr

  // avoid blacklisted modules
  if (isModuleBlacklisted(newModuleAddress)) {
    return
  }

  // avoid duplicated modules
  let config = CourtConfig.load(event.address.toHex())
  if (isModuleAlreadySet(config.moduleAddresses, newModuleAddress)) {
    return
  }

  let module = new CourtModule(event.params.id.toHex())
  module.court = event.address.toHex()
  module.address = newModuleAddress

  let id = event.params.id.toHexString()
  if (id == JURORS_REGISTRY_ID) {
    JurorsRegistry.create(newModuleAddress)
    module.type = JURORS_REGISTRY_TYPE

    let jurorsRegistry = JurorsRegistryContract.bind(newModuleAddress)
    let anjAddress = jurorsRegistry.token()
    ANJ.create(anjAddress)

    let anjContract = ERC20Contract.bind(anjAddress)
    let anj = new ERC20(anjAddress.toHex())
    anj.name = anjContract.name()
    anj.symbol = anjContract.symbol()
    anj.decimals = anjContract.decimals()
    anj.save()

    config.anjToken = anjAddress.toHex()
    config.save()

    let registryModule = new JurorsRegistryModule(newModuleAddress.toHex())
    registryModule.court = event.address.toHex()
    registryModule.totalStaked = BigInt.fromI32(0)
    registryModule.totalActive = BigInt.fromI32(0)
    registryModule.totalDeactivation = BigInt.fromI32(0)
    registryModule.save()
  }
  else if (id == DISPUTE_MANAGER_ID) {
    DisputeManager.create(newModuleAddress)
    module.type = DISPUTE_MANAGER_TYPE
  }
  else if (id == VOTING_ID) {
    Voting.create(newModuleAddress)
    module.type = VOTING_TYPE
  }
  else if (id == TREASURY_ID) {
    Treasury.create(newModuleAddress)
    module.type = TREASURY_TYPE
  }
  else if (id == SUBSCRIPTIONS_ID) {
    Subscriptions.create(newModuleAddress)
    module.type = SUBSCRIPTIONS_TYPE

    let subscriptionModule = new SubscriptionModule(newModuleAddress.toHex())
    let subscriptions = SubscriptionsContract.bind(newModuleAddress)
    subscriptionModule.court = event.address.toHex()
    subscriptionModule.currentPeriod = BigInt.fromI32(0)
    subscriptionModule.governorSharePct = BigInt.fromI32(subscriptions.governorSharePct())
    subscriptionModule.feeToken = subscriptions.currentFeeToken()
    subscriptionModule.periodDuration = subscriptions.periodDuration()
    subscriptionModule.save()
  }
  else {
    module.type = 'Unknown'
  }

  let moduleAddresses = config.moduleAddresses
  moduleAddresses.push(newModuleAddress.toHex())
  config.moduleAddresses = moduleAddresses
  config.save()

  module.save()
}

function isModuleBlacklisted(module: Address): boolean {
  return BLACKLISTED_MODULES.includes(module.toHex())
}

function isModuleAlreadySet(modules: string[], newModule: Address): boolean {
  return modules.includes(newModule.toHex())
}

function loadOrCreateConfig(courtAddress: Address, event: ethereum.Event): CourtConfig | null {
  let id = courtAddress.toHex()
  let config = CourtConfig.load(id)
  let court = AragonCourt.bind(event.address)

  if (config === null) {
    config = new CourtConfig(id)
    config.currentTerm = BigInt.fromI32(0)
    config.termDuration = court.getTermDuration()
    config.moduleAddresses = []
  }

  let currentTermId = court.getCurrentTermId()
  let result = court.getConfig(currentTermId)

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

function loadOrCreateTerm(id: BigInt, event: ethereum.Event): CourtTerm | null {
  let term = CourtTerm.load(id.toString())

  if (term === null) {
    term = new CourtTerm(id.toString())
    term.createdAt = event.block.timestamp
  }

  return term
}
