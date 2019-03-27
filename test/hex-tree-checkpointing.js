const assertRevert = require('./helpers/assert-revert')

const HexSumTreePublic = artifacts.require('HexSumTreePublic')

contract('Hex Sum Tree', (accounts) => {
  let tree

  beforeEach(async () => {
    tree = await HexSumTreePublic.new()
    await tree.init()
  })

  const assertBN = (bn, n, m) => {
    assert.equal(bn.toNumber(), n, m)
  }

  const logTreeState = async () => {
    //console.log((await tree.getState()).map(x => x.toNumber()))
    const state = await tree.getState()
    console.log(`Tree depth:    ${state[0]}`);
    console.log(`Tree next key: ${state[1]}`);
  }

  const logSortitionHex = async (value) => {
    console.log(`Sortition ${value}:`, web3.toHex(await tree.sortition(value)))
  }

  const logSortition = async (value) => {
    console.log(`Sortition ${value}:`, (await tree.sortition(value)).toNumber())
  }

  const multipleSetOnNode = async (node) => {
    let setBns = [0]
    for (let i = 1; i <= 200; i++) {
      const r = await tree.set(node, 10 + i)
      setBns.push(r.receipt.blockNumber)
    }

    // check all past values
    for (let i = 1; i <= 200; i++) {
      const v = await tree.getPastItem(node, setBns[i])
      //console.log(i, setBns[i], v.toNumber());
      assertBN(v, 10 + i, `Value for node ${node} on block number ${setBns[i]} should match`)
    }
  }

  it('inserts a lot of times into the first node', async () => {
    const NODE = 0
    await tree.insertNoLog(10)

    await multipleSetOnNode(NODE)

    await logTreeState()
    await logSortition(NODE)
  })

  it('inserts a lot of times into a middle node', async () => {
    const NODE = 250
    for (let i = 0; i < 270; i++) {
      await tree.insertNoLog(10)
    }

    await multipleSetOnNode(NODE)

    await logTreeState()
    await logSortition(NODE * 10 + 5)
  })
})
