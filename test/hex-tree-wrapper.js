const { assertRevert } = require('@aragon/os/test/helpers/assertThrow')
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
      await this.sumTree.insert(0, 1, { from: account0 })
    })

    it('fails inserting if not owner', async () => {
      await assertRevert(this.sumTree.insert(0, 1, { from: account1 }), 'SUMTREE_NOT_OWNER')
    })

    context('Multisortition', () => {
      const TOTAL_JURORS = 20
      beforeEach(async () => {
        const VALUE = 10

        for (let i = 0; i < TOTAL_JURORS; i++) {
          await this.sumTree.insert(0, VALUE, { from: account0 })
        }
      })

      it('Repeating sortition gives different values on different iterations', async () => {
        const ATTEMPTS = 4
        const termRandomness = 'randomness'
        const disputeId = 0
        const time = 1
        const past = false
        const filledSeats = 1
        const jurorsRequested = 3

        let prevKeys
        let allTheSame = true
        for (let i = 0; i < ATTEMPTS; i++) {
          const [ keys, values ] = await this.sumTree.multiSortition(termRandomness, disputeId, time, past, filledSeats, jurorsRequested, TOTAL_JURORS, i)
          //console.log(keys.map(v => v.toNumber()));
          if (i > 0) {
            for (let j = 0; j < keys.length; j++) {
              if (keys[j].toNumber() != prevKeys[j].toNumber()) {
                allTheSame = false
                break
              }
            }
          }
          if (!allTheSame) {
            break
          }

          prevKeys = keys
        }

        assert.isFalse(allTheSame)
      })
    })
  })
})
