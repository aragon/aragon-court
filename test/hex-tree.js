const { assertRevert } = require('@aragon/os/test/helpers/assertThrow')

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

  const logSortition = async (value, sortitionFunction) => {
    console.log(`Sortition ${value}:`, web3.toHex(await tree[sortitionFunction].call(value, 0)))
  }

  it('inserts', async () => {
    await tree.insert(10)

    assertBN(await tree.get(0, 0), 10, 'get node')
    assertBN(await tree.get(1, 0), 10, 'get sum')
  })

  it('inserts and modifies', async () => {
    await tree.insert(10)
    await tree.insert(5)
    assertBN(await tree.get(1, 0), 15, 'get sum')

    await tree.set(0, 5)

    assertBN(await tree.get(0, 0), 5, 'get node')
    assertBN(await tree.get(1, 0), 10, 'get sum')
  })

  it('inserts three', async () => {
    await tree.insert(10)
    await tree.insert(10)
    await tree.insert(10)

    assertBN(await tree.get(0, 1), 10, 'get node')
    assertBN(await tree.get(1, 0), 30, 'get sum')
  })

  it('fails setting non adjacent key', async () => {
    await tree.insert(5)
    await tree.insert(5)

    await assertRevert(tree.set(3, 5), 'SUM_TREE_NEW_KEY_NOT_ADJACENT')
  })

  it('fails inserting a number that makes sum overflow', async () => {
    await tree.insert(5)
    await tree.insert(5)

    const MAX_UINT256 = (new web3.BigNumber(2)).pow(256).minus(1)
    await assertRevert(tree.update(0, MAX_UINT256, true), 'SUM_TREE_UPDATE_OVERFLOW')
  })

  for (const sortitionFunction of ['sortition', 'sortitionSingleUsingMulti']) {
    it(`inserts two using ${sortitionFunction}`, async () => {
      await tree.insert(5)
      await tree.insert(5)

      for (let i = 0; i < 5; i++) {
        //await logSortition(i, sortitionFunction)
        assertBN(await tree[sortitionFunction].call(i, 0), 0, `Draw first, value ${i}`)
      }
      for (let i = 5; i < 10; i++) {
        //await logSortition(i, sortitionFunction)
        assertBN(await tree[sortitionFunction].call(i, 0), 1, `Draw second, value ${i}`)
      }
    })

    it(`sortition using ${sortitionFunction}`, async () => {
      for (let i = 0; i < 20; i++) {
        await tree.insert(10)
        const [depth, key] = await tree.getState()

        //if (i % 10 == 0 || i > 15)
        //console.log(`#${i + 1}: Sum ${await tree.totalSum()}. Depth ${depth}. Next key ${web3.toHex(key)}`)
      }

      assertBN(await tree[sortitionFunction].call(1, 0), 0)
      assertBN(await tree[sortitionFunction].call(11, 0), 1)
      assertBN(await tree[sortitionFunction].call(171, 0), 17)
    })

    it(`inserts into another node using ${sortitionFunction}`, async () => {
      for (let i = 0; i < 270; i++) {
        await tree.insert(10)
        const [depth, key] = await tree.getState()

        //if (i % 10 == 0)
        //console.log(`#${i + 1}: Sum ${await tree.totalSum()}. Depth ${depth}. Next key ${web3.toHex(key)}`)
      }

      assertBN(await tree.get(0, 16), 10, 'get node')
      assertBN(await tree.get(1, 0), 160, 'get sum 1.0')
      assertBN(await tree.get(1, 16), 160, 'get sum 1.1')
      assertBN(await tree.get(2, 0), 2560, 'get sum 2.0')

      assertBN(await tree[sortitionFunction].call(2605, 0), 260)
    })

    it(`tests sortition on all nodes using ${sortitionFunction}`, async () => {
      const NODES = 512//16 ** 3
      // insert
      for (let i = 0; i < NODES; i++) {
        await tree.insertNoLog(10)
      }

      // sortition
      for (let i = 0; i < NODES; i++) {
        //console.log(10 * i, (await tree[sortitionFunction].call(10 * i, 0)).toNumber(), i)
        assertBN(await tree[sortitionFunction].call(10 * i, 0), i)
      }
    })
  }
})
