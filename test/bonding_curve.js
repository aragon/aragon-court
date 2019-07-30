const { hash } = require('eth-ens-namehash')
const { assertRevert } = require('@aragon/os/test/helpers/assertThrow')
const { getEventAt, getEventArgument, getNewProxyAddress } = require('@aragon/test-helpers/events')
const blockNumber = require('@aragon/test-helpers/blockNumber')(web3)

const TokenFactory = artifacts.require('TokenFactory')
const CourtMock = artifacts.require('CourtMock')
const CourtStakingMock = artifacts.require('CourtStakingMock')
const CRVoting = artifacts.require('CRVoting')
const SumTree = artifacts.require('HexSumTreeWrapper')
const Subscriptions = artifacts.require('SubscriptionsMock')

const MiniMeToken = artifacts.require('@aragon/apps-shared-minime/contracts/MiniMeToken')

const ACL = artifacts.require('@aragon/os/contracts/acl/ACL')
const Kernel = artifacts.require('@aragon/os/contracts/kernel/Kernel')
const DAOFactory = artifacts.require('@aragon/os/contracts/factory/DAOFactory')
const EVMScriptRegistryFactory = artifacts.require('@aragon/os/contracts/factory/EVMScriptRegistryFactory')
const Vault = artifacts.require('Vault')
const TokenManager = artifacts.require('TokenManager')
const BancorFormula = artifacts.require('@ablack/fundraising-bancor-formula/BancorFormula')
const Controller = artifacts.require('SimpleMarketMakerController')
const BancorMarketMaker = artifacts.require('@ablack/fundraising-market-maker-bancor/BancorMarketMaker')

const assertEqualBN = async (actual, expected, message) =>
      assert.isTrue(actual.eq(expected), message)

const ANY_ADDR = '0x' + 'ff'.repeat(20)
const ZERO_ADDRESS = '0x' + '00'.repeat(20)
const DECIMALS = new web3.utils.BN('1' + '0'.repeat(18))
const NO_DATA = '0x'
const ERROR_THRESHOLD = 1e-9

contract('Bonding curve', ([ governor, juror1, juror2 ]) => {
  const VAULT_ID = hash('vault.aragonpm.eth')
  const CONTROLLER_ID = hash('controller.aragonpm.eth')
  const TOKEN_MANAGER_ID = hash('token-manager.aragonpm.eth')
  const BANCOR_MARKET_MAKER_ID = hash('bancor-market-maker.aragonpm.eth')

  const INITIAL_BALANCE = new web3.utils.BN(1e6).mul(DECIMALS)
  const jurors = [ juror1, juror2 ]


  const BLOCKS_IN_BATCH = new web3.utils.BN(10)
  const VIRTUAL_SUPPLY = new web3.utils.BN(1e3).mul(DECIMALS)
  const VIRTUAL_BALANCE = new web3.utils.BN(1e2).mul(DECIMALS)
  const RESERVE_RATIO = 100000

  const termDuration = 10
  const firstTermStart = 10
  const jurorMinStake = 10
  const startBlock = 1000
  const commitTerms = 1
  const revealTerms = 1
  const appealTerms = 1
  const penaltyPct = 100 // 100‱ = 1%
  const finalRoundReduction = 3300 // 100‱ = 1%

  let daoFact, vaultBase, controllerBase, tokenManagerBase, bancorMarketMakerBase
  let APP_MANAGER_ROLE, TRANSFER_ROLE, MINT_ROLE, BURN_ROLE
  let ADD_COLLATERAL_TOKEN_ROLE, UPDATE_COLLATERAL_TOKEN_ROLE, UPDATE_BENEFICIARY_ROLE, UPDATE_FEES_ROLE, CREATE_BUY_ORDER_ROLE, CREATE_SELL_ORDER_ROLE

  const setupRecoveryVault = async (dao) => {
    const recoveryVaultAppId = VAULT_ID
    const vaultReceipt = await dao.newAppInstance(recoveryVaultAppId, vaultBase.address, '0x', false, { from: governor })
    const recoveryVault = await Vault.at(getNewProxyAddress(vaultReceipt))
    await recoveryVault.initialize()
    await dao.setApp(await dao.APP_ADDR_NAMESPACE(), recoveryVaultAppId, recoveryVault.address)
    await dao.setRecoveryVaultAppId(recoveryVaultAppId, { from: governor })

    return recoveryVault
  }

  const progressToNextBatch = async () => {
    let currentBlock = new web3.utils.BN(await blockNumber())
    let currentBatch = await this.bancorMarketMaker.getCurrentBatchId()
    let blocksTilNextBatch = currentBatch.add(BLOCKS_IN_BATCH).sub(currentBlock)
    await increaseBlocks(blocksTilNextBatch)
  }
  const  increaseBlocks = (blocks) => {
    if (typeof blocks === 'object') {
      blocks = blocks.toNumber(10)
    }
    return new Promise((resolve, reject) => {
      increaseBlock().then(() => {
        blocks -= 1
        if (blocks === 0) {
          resolve()
        } else {
          increaseBlocks(blocks).then(resolve)
        }
      })
    })
  }

  const  increaseBlock = () => {
    return new Promise((resolve, reject) => {
      web3.currentProvider.send(
        {
          jsonrpc: '2.0',
          method: 'evm_mine',
          id: 12345,
        },
        (err, result) => {
          if (err) reject(err)
          resolve(result)
        }
      )
    })
  }

  const createAndClaimBuyOrder = async (address, collateralToken, amount, from) => {
    from = from || address
    // create buy order
    const receipt = await this.bancorMarketMaker.createBuyOrder(address, collateralToken, amount, { from })
    const event = receipt.logs.find(l => l.event === 'NewBuyOrder')
    const batchId = event.args.batchId.toNumber()
    // move to next batch
    await increaseBlocks(BLOCKS_IN_BATCH)
    // clear batch
    await this.bancorMarketMaker.clearBatches()
    // claim bonds
    await this.bancorMarketMaker.claimBuy(address, collateralToken, batchId)
    // return balance
    const balance = await this.anj.balanceOf(address)

    return balance
  }

  const toNumber = x => parseInt(x.toString(), 10)
  const realPurchase = (supply, connectorBalance, reverseReserveRatio, buyAmount) => {
    const s = toNumber(supply)
    const p = toNumber(buyAmount)
    const b = toNumber(connectorBalance)
    return s * ((1 + p / b)**(1/reverseReserveRatio) - 1)
  }

  before(async () => {
    this.bancorFormula = await BancorFormula.new()

    const kernelBase = await Kernel.new(true) // petrify immediately
    const aclBase = await ACL.new()
    const regFact = await EVMScriptRegistryFactory.new()
    daoFact = await DAOFactory.new(kernelBase.address, aclBase.address, regFact.address)

    // base contracts
    vaultBase = await Vault.new()
    controllerBase = await Controller.new()
    tokenManagerBase = await TokenManager.new()
    bancorMarketMakerBase = await BancorMarketMaker.new()
    // Setup constants
    APP_MANAGER_ROLE = await kernelBase.APP_MANAGER_ROLE()
    TRANSFER_ROLE = await vaultBase.TRANSFER_ROLE()
    MINT_ROLE = await tokenManagerBase.MINT_ROLE()
    BURN_ROLE = await tokenManagerBase.BURN_ROLE()
    ADD_COLLATERAL_TOKEN_ROLE = await bancorMarketMakerBase.ADD_COLLATERAL_TOKEN_ROLE()
    UPDATE_COLLATERAL_TOKEN_ROLE = await bancorMarketMakerBase.UPDATE_COLLATERAL_TOKEN_ROLE()
    UPDATE_BENEFICIARY_ROLE = await bancorMarketMakerBase.UPDATE_BENEFICIARY_ROLE()
    UPDATE_FEES_ROLE = await bancorMarketMakerBase.UPDATE_FEES_ROLE()
    CREATE_BUY_ORDER_ROLE = await bancorMarketMakerBase.CREATE_BUY_ORDER_ROLE()
    CREATE_SELL_ORDER_ROLE = await bancorMarketMakerBase.CREATE_SELL_ORDER_ROLE()
  })

  beforeEach(async () => {
    // deploy tokens ANT and ANJ
    this.ant = await MiniMeToken.new(ZERO_ADDRESS, ZERO_ADDRESS, 0, 'n', 0, 'n', true) // empty parameters minime
    this.anj = await MiniMeToken.new(ZERO_ADDRESS, ZERO_ADDRESS, 0, 'n', 0, 'n', true) // empty parameters minime

    // deloy DAO for BancorMarketMaker
    const r = await daoFact.newDAO(governor)
    const dao = await Kernel.at(getEventArgument(r, 'DeployDAO', 'dao'))
    const acl = await ACL.at(await dao.acl())

    await acl.createPermission(governor, dao.address, APP_MANAGER_ROLE, governor, { from: governor })

    const vault = await setupRecoveryVault(dao)

    // market maker controller
    const controllerReceipt = await dao.newAppInstance(CONTROLLER_ID, controllerBase.address, '0x', false)
    const controller = await Controller.at(getNewProxyAddress(controllerReceipt))
    // token manager
    const tokenManagerReceipt = await dao.newAppInstance(TOKEN_MANAGER_ID, tokenManagerBase.address, '0x', false, { from: governor })
    const tokenManager = await TokenManager.at(getNewProxyAddress(tokenManagerReceipt))
    await this.anj.changeController(tokenManager.address)
    await tokenManager.initialize(this.anj.address, true, 0)
    // market maker
    const bancorMarketMakerReceipt = await dao.newAppInstance(BANCOR_MARKET_MAKER_ID, bancorMarketMakerBase.address, '0x', false, { from: governor })
    this.bancorMarketMaker = await BancorMarketMaker.at(getNewProxyAddress(bancorMarketMakerReceipt))

    await this.bancorMarketMaker.initialize(
      controller.address,
      tokenManager.address,
      vault.address,
      governor,
      this.bancorFormula.address,
      BLOCKS_IN_BATCH,
      0,
      0)

    // permissions
    await acl.createPermission(governor, this.bancorMarketMaker.address, ADD_COLLATERAL_TOKEN_ROLE, governor, { from: governor })
    await acl.createPermission(this.bancorMarketMaker.address, vault.address, TRANSFER_ROLE, governor, { from: governor })
    await acl.createPermission(this.bancorMarketMaker.address, tokenManager.address, MINT_ROLE, governor, { from: governor })
    await acl.createPermission(this.bancorMarketMaker.address, tokenManager.address, BURN_ROLE, governor, { from: governor })

    await acl.createPermission(governor, this.bancorMarketMaker.address, UPDATE_COLLATERAL_TOKEN_ROLE, governor, { from: governor })
    await acl.createPermission(governor, this.bancorMarketMaker.address, UPDATE_BENEFICIARY_ROLE, governor, { from: governor })
    await acl.createPermission(governor, this.bancorMarketMaker.address, UPDATE_FEES_ROLE, governor, { from: governor })
    await acl.createPermission(ANY_ADDR, this.bancorMarketMaker.address, CREATE_BUY_ORDER_ROLE, governor, { from: governor })
    await acl.createPermission(ANY_ADDR, this.bancorMarketMaker.address, CREATE_SELL_ORDER_ROLE, governor, { from: governor })

    // end up initializing market maker
    await this.bancorMarketMaker.addCollateralToken(this.ant.address, VIRTUAL_SUPPLY, VIRTUAL_BALANCE, RESERVE_RATIO, { from: governor })
    // make sure tests start at the beginning of a new batch
    await progressToNextBatch()

    // deploy Court
    this.staking = await CourtStakingMock.new()
    this.voting = await CRVoting.new()
    this.sumTree = await SumTree.new()
    this.subscriptions = await Subscriptions.new()
    await this.subscriptions.setUpToDate(true)

    this.court = await CourtMock.new(
      termDuration,
      [ this.anj.address, ZERO_ADDRESS ], // no fees
      this.staking.address,
      this.voting.address,
      this.sumTree.address,
      this.subscriptions.address,
      [ 0, 0, 0, 0 ],
      governor,
      firstTermStart,
      jurorMinStake,
      [ commitTerms, appealTerms, revealTerms ],
      [ penaltyPct, finalRoundReduction ],
      [ 0, 0, 0, 0, 0 ]
    )

    // mint and approve
    for (let juror of jurors) {
      await this.ant.generateTokens(juror, INITIAL_BALANCE)
      await this.ant.approve(this.bancorMarketMaker.address, INITIAL_BALANCE, { from: juror })
      assertEqualBN(await this.ant.balanceOf(juror), INITIAL_BALANCE, `juror ${juror} balance`)
    }
  })

  it('juror can buy into bonding curve', async () => {
    const amount = new web3.utils.BN(20).mul(DECIMALS)
    const initialBalance = await this.anj.balanceOf(juror1)
    const finalBalance = await createAndClaimBuyOrder(juror1, this.ant.address, amount, juror1)
    const expectedBalance = realPurchase(VIRTUAL_SUPPLY, VIRTUAL_BALANCE, 1e6 / RESERVE_RATIO, amount)
    assert.isTrue(Math.abs(toNumber(finalBalance) - expectedBalance) / expectedBalance < ERROR_THRESHOLD, 'Final balances don\'t match')
  })

  it('can stake and activate after buying', async()=> {
    const amount = new web3.utils.BN(20).mul(DECIMALS)
    const finalBalance = await createAndClaimBuyOrder(juror1, this.ant.address, amount, juror1)
    await this.anj.approve(this.staking.address, finalBalance, { from: juror1 })
    await this.staking.stake(finalBalance, NO_DATA, { from: juror1 })
    await this.staking.activate({ from: juror1 })
  })

  it('can\'t stake without buying', async () => {
    await this.anj.approve(this.staking.address, jurorMinStake, { from: juror1 })
    await assertRevert(this.staking.stake(jurorMinStake, NO_DATA, { from: juror1 }))
  })
})
