const assertRevert = require('./helpers/assert-revert')
const { soliditySha3 } = require('web3-utils')

const SumTree = artifacts.require('HexSumTreeWrapper')

contract('HexSumTreeWrapper', ([ account0, account1 ]) => {
  const initPwd = soliditySha3('passw0rd')
  const preOwner = '0x' + soliditySha3(initPwd).slice(-40)

  beforeEach(async () => {
    this.sumTree = await SumTree.new(preOwner)
  })

  it('can set owner', async () => {
    assert.equal(await this.sumTree.getOwner.call(), preOwner, 'wrong owner before change')
    await this.sumTree.init(account1, initPwd)
    assert.equal(await this.sumTree.getOwner.call(), account1, 'wrong owner after change')
  })

  context('Initialized', () => {
    beforeEach(async () => {
      await this.sumTree.init(account0, initPwd)
    })

    it('can insert as owner', async () => {
      const r = await this.sumTree.insert(0, 1, { from: account0 })
    })

    it('fails inserting if not owner', async () => {
      //await assertRevert(this.sumTree.insert(0, 1, { from: account1 }), 'SUMTREE_NOT_OWNER')
      await assertRevert(this.sumTree.insert(0, 1, { from: account1 }))
    })
  })
})
