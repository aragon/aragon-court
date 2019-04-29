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

  const logSortitionHex = async (value, sortitionFunction) => {
    console.log(`Sortition ${value}:`, web3.toHex(await tree[sortitionFunction].call(value, 0)))
  }

  const logSortition = async (value, sortitionFunction) => {
    console.log(`Sortition ${value}:`, (await tree[sortitionFunction].call(value, 0)).toNumber())
  }

  const getCheckpointTime = async () => {
    //return Math.floor(r.receipt.blockNumber / 256)
    return (await tree.getCheckpointTime()).toNumber()
  }

  const multipleSetOnNode = async (node, sortitionFunction) => {
    let setBns = [{}]
    for (let i = 1; i <= 200; i++) {
      const value = 10 + i
      const checkpointTime = await getCheckpointTime()
      const r = await tree.set(node, value)
      if (setBns[setBns.length - 1].time == checkpointTime) {
        setBns[setBns.length - 1].value = value
      } else {
        setBns.push({ time: checkpointTime, value: value })
      }
      if (i % 2 == 0) {
        await tree.advanceTime(50) // blocks
      }
    }

    // check all past values
    for (let i = 1; i < setBns.length; i++) {
      const v = await tree.getPastItem.call(node, setBns[i].time)
      assertBN(v, setBns[i].value, `Value for node ${node} on checkpoint time ${setBns[i].time} should match`)
      const value1 = (node + 1) * 10 + i - 1
      const s1 = await tree[sortitionFunction].call(value1, setBns[i].time)
      //console.log(i, setBns[i], s1.toNumber())
      assertBN(s1, node, `Sortition for value ${value1} on checkpoint time ${setBns[i].time} should match`)
    }
  }

  for (const sortitionFunction of ['sortition', 'sortitionSingleUsingMulti']) {
    it(`inserts a lot of times into the first node using ${sortitionFunction}`, async () => {
      const NODE = 0
      await tree.insertNoLog(10)

      await multipleSetOnNode(NODE, sortitionFunction)

      await logTreeState()
      await logSortition(NODE, sortitionFunction)
      const finalCheckpointTime = await tree.getCheckpointTime()
      const finalBlockNumber = await tree.getBlockNumber64()
      console.log(`final block number ${finalBlockNumber}, term ${finalCheckpointTime}`)
    })

    it(`inserts a lot of times into a middle node using ${sortitionFunction}`, async () => {
      const NODE = 250
      for (let i = 0; i < 270; i++) {
        await tree.insertNoLog(10)
      }

      await multipleSetOnNode(NODE, sortitionFunction)

      await logTreeState()
      await logSortition(NODE * 10 + 5, sortitionFunction)
      const finalCheckpointTime = await tree.getCheckpointTime()
      const finalBlockNumber = await tree.getBlockNumber64()
      console.log(`final block number ${finalBlockNumber}, term ${finalCheckpointTime}`)
    })
  }
})
