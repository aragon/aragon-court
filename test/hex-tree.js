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

  it('inserts', async () => {
    await tree.insert(10)

    assertBN(await tree.get(0, 0), 10, 'get node')
    assertBN(await tree.get(1, 15), 10, 'get sum')
  })

  it('inserts three', async () => {
    await tree.insert(10)
    await tree.insert(10)
    await tree.insert(10)

    assertBN(await tree.get(0, 1), 10, 'get node')
    assertBN(await tree.get(1, 15), 30, 'get sum')
  })

  it('sortition', async () => {
    for (let i = 0; i < 20; i++) {
      await tree.insert(10)
      const [depth, root, key] = await tree.getState()

      console.log(`#${i + 1}: Sum ${await tree.totalSum()}. Depth ${depth}. Root ${root}. Next key ${key}`)
    }

    assertBN(await tree.sortition(1), 0)
    assertBN(await tree.sortition(11), 1)
    assertBN(await tree.sortition(171), 17)

    console.log(await tree.sortition.estimateGas(11))
    console.log(await tree.sortition.estimateGas(171))
  })

  it('inserts into another node', async () => {
    for (let i = 0; i < 270; i++) {
      await tree.insert(10)
      const [depth, root, key] = await tree.getState()

      console.log(`#${i + 1}: Sum ${await tree.totalSum()}. Depth ${depth}. Root ${root}. Next key ${key}`)
    }

    assertBN(await tree.get(0, 16), 10, 'get node')
    assertBN(await tree.get(1, 15), 160, 'get sum 1.0')
    assertBN(await tree.get(1, 31), 160, 'get sum 1.1')
    assertBN(await tree.get(2, 255), 2560, 'get sum 2.0')

    assertBN(await tree.sortition(2605), 260)
    console.log(await tree.sortition.estimateGas(2605))
  })
})
