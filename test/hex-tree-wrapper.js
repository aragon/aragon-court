const assertRevert = require('./helpers/assert-revert')

const SumTree = artifacts.require('HexSumTreeWrapper')

contract('HexSumTreeWrapper', ([ account0, account1 ]) => {
  beforeEach(async () => {
    this.sumTree = await SumTree.new()
  })

  it('can set owner', async () => {
    assert.equal(await this.sumTree.owner.call(), account0, 'wrong owner before change')
    await this.sumTree.setOwner(account1)
    assert.equal(await this.sumTree.owner.call(), account1, 'wrong owner after change')
  })

  it('can insert as owner', async () => {
    const r = await this.sumTree.insert(0, 1, { from: account0 })
  })

  it('fails inserting if not owner', async () => {
    //await assertRevert(this.sumTree.insert(0, 1, { from: account1 }), 'SUMTREE_NOT_OWNER')
    await assertRevert(this.sumTree.insert(0, 1, { from: account1 }))
  })
})
