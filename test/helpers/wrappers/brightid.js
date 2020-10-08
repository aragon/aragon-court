const ethers = require('ethers')
const { ONE_DAY, ONE_WEEK, ZERO_ADDRESS } = require('@aragon/contract-helpers-test')
const { newDao, newApp } = require("./dao")

module.exports = (web3, artifacts) => {

  // Use the private key of whatever the second account is in the local chain
  // In this case it is 0xc783df8a850f42e7f7e57013759c285caa701eb6 which is the third address in the buidlerevm node
  const VERIFICATIONS_PRIVATE_KEY = '0xc5e8f61d1ab959b397eecc0a37a6517b8e67a0e7cf1f4bce5591f3ed80199122'
  const BRIGHT_ID_CONTEXT = '0x3168697665000000000000000000000000000000000000000000000000000000' // stringToBytes32("1hive")
  const REGISTRATION_PERIOD = ONE_WEEK
  const VERIFICATION_TIMESTAMP_VARIANCE = ONE_DAY

  class BrightIdHelper {
    constructor(web3, artifacts) {
      this.web3 = web3
      this.artifacts = artifacts
    }

    getVerificationsSignature(contextIds, timestamp) {
      const hashedMessage = web3.utils.soliditySha3(
        BRIGHT_ID_CONTEXT,
        { type: 'address[]', value: contextIds },
        timestamp
      )
      const signingKey = new ethers.utils.SigningKey(VERIFICATIONS_PRIVATE_KEY)
      return signingKey.signDigest(hashedMessage)
    }

    async deploy() {
      const owner = await this._getAccount(0)
      const { dao } = await newDao(owner)
      const BrightIdRegister = this.artifacts.require('BrightIdRegisterMock')
      const brightIdRegisterBase = await BrightIdRegister.new()

      const brightIdRegisterProxyAddress = await newApp(dao, 'brightid-register', brightIdRegisterBase.address, owner)
      this.brightIdRegister = await BrightIdRegister.at(brightIdRegisterProxyAddress)
      await this.brightIdRegister.initialize(BRIGHT_ID_CONTEXT, owner, REGISTRATION_PERIOD, VERIFICATION_TIMESTAMP_VARIANCE)

      return this.brightIdRegister
    }

    async registerUser(userUniqueAddress) {
      await this.registerUserWithData(userUniqueAddress, ZERO_ADDRESS, '0x0')
    }

    async registerUsers(usersUniqueAddresses) {
      for (const userUniqueAddress of usersUniqueAddresses) {
        await this.registerUser(userUniqueAddress)
      }
    }

    async registerUserWithData(userUniqueAddress, contractAddress, data) {
      const addresses = [userUniqueAddress]
      const timestamp = await this.brightIdRegister.getTimestampPublic()
      const sig = this.getVerificationsSignature(addresses, timestamp)
      await this.brightIdRegister.register(BRIGHT_ID_CONTEXT, addresses, timestamp, sig.v, sig.r, sig.s, contractAddress, data, { from: userUniqueAddress })
    }

    async registerUserWithMultipleAddresses(userUniqueAddress, userSecondAddress) {
      const addresses = [userSecondAddress, userUniqueAddress] // Unique address used is the last in the array
      const timestamp = await this.brightIdRegister.getTimestampPublic()
      const sig = this.getVerificationsSignature(addresses, timestamp)
      await this.brightIdRegister.register(BRIGHT_ID_CONTEXT, addresses, timestamp, sig.v, sig.r, sig.s, ZERO_ADDRESS, '0x0', { from: userSecondAddress })
    }

    async registerUsersWithMultipleAddresses(usersAddresses) {
      for (const userAddresses of usersAddresses) {
        await this.registerUserWithMultipleAddresses(userAddresses[0], userAddresses[1])
      }
    }

    async expireVerifiedUsers() {
      await this.brightIdRegister.mockIncreaseTime(REGISTRATION_PERIOD)
    }

    async _getAccount(index) {
      const accounts = await this.web3.eth.getAccounts()
      return accounts[index]
    }
  }

  return {
    buildBrightIdHelper: () => new BrightIdHelper(web3, artifacts)
  }
}


