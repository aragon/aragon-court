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

  const logSortitionGas = async (value) => {
    console.log(`Sortition ${value} gas:`, await tree.sortition.estimateGas(value))
  }

  const logSortition = async (value) => {
    console.log(`Sortition ${value}:`, web3.toHex(await tree.sortition(value)))
  }

  const logGasStats = (title, gasArray) => {
    console.log(title)
    console.log('Size:   ', gasArray.length)
    console.log('| Min     |', Math.min(...gasArray), '|')
    console.log('| Max     |', Math.max(...gasArray), '|')
    console.log('| Average |', Math.round(gasArray.reduce((a,b) => a + b, 0) / gasArray.length), '|')
  }

  it('inserts', async () => {
    await tree.insert(10)

    assertBN(await tree.get(0, 0), 10, 'get node')
    assertBN(await tree.get(1, 0), 10, 'get sum')
  })

  it('inserts three', async () => {
    await tree.insert(10)
    await tree.insert(10)
    await tree.insert(10)

    /*
    await logSortition(0)
    await logSortition(9)
    await logSortition(10)
    await logSortition(20)
    await logSortition(29)
    */
    assertBN(await tree.get(0, 1), 10, 'get node')
    assertBN(await tree.get(1, 0), 30, 'get sum')
  })

  it('inserts two', async () => {
    await tree.insert(5)
    await tree.insert(5)

    for (let i = 0; i < 5; i++) {
      //await logSortition(i)
      assertBN(await tree.sortition(i), 0, `Draw first, value ${i}`)
    }
    for (let i = 5; i < 10; i++) {
      //await logSortition(i)
      assertBN(await tree.sortition(i), 1, `Draw second, value ${i}`)
    }
  })

  it('sortition', async () => {
    for (let i = 0; i < 20; i++) {
      await tree.insert(10)
      const [depth, key] = await tree.getState()

      //if (i % 10 == 0 || i > 15)
        //console.log(`#${i + 1}: Sum ${await tree.totalSum()}. Depth ${depth}. Next key ${web3.toHex(key)}`)
    }

    assertBN(await tree.sortition(1), 0)
    assertBN(await tree.sortition(11), 1)
    assertBN(await tree.sortition(171), 17)
  })

  it('inserts into another node', async () => {
    let insertGas = []
    for (let i = 0; i < 270; i++) {
      insertGas.push(await tree.insert.estimateGas(10))
      await tree.insert(10)
      //console.log('insert gas:', await tree.insert.estimateGas(10))
      const [depth, key] = await tree.getState()

      //if (i % 10 == 0)
        //console.log(`#${i + 1}: Sum ${await tree.totalSum()}. Depth ${depth}. Next key ${web3.toHex(key)}`)
    }

    logGasStats('Inserts', insertGas)

    assertBN(await tree.get(0, 16), 10, 'get node')
    assertBN(await tree.get(1, 0), 160, 'get sum 1.0')
    assertBN(await tree.get(1, 16), 160, 'get sum 1.1')
    assertBN(await tree.get(2, 0), 2560, 'get sum 2.0')

    assertBN(await tree.sortition(2605), 260)
    //await logSortitionGas(2605)
  })

  it('lots of activity', async () => {
    const INSERTS = 32
    const REMOVES = 3
    const ITERATIONS = 72 //129
    const VALUE = 10

    let insertGas = []
    let removeGas = []
    let sortitionGas = []

    for (let i = 0; i < ITERATIONS; i++) {
      // add nodes
      for (let j = 0; j < INSERTS; j++) {
        insertGas.push(await tree.insert.estimateGas(VALUE))
        await tree.insert(VALUE)
      }

      // remove
      for (let k = 0; k < REMOVES; k++) {
        removeGas.push(await tree.remove.estimateGas((INSERTS - REMOVES) * i + k))
        await tree.remove((INSERTS - REMOVES) * i + k)
      }

      //console.log(`Iteration ${i}:`, (await tree.totalSum()).toNumber())
      // draw
      const sum = (await tree.totalSum()).toNumber()
      sortitionGas.push(await tree.sortition.estimateGas(0))
      sortitionGas.push(await tree.sortition.estimateGas(Math.round(sum / 2)))
      sortitionGas.push(await tree.sortition.estimateGas(sum - 1))
    }

    //console.log((await tree.getState()).map(x => x.toNumber()))
    logGasStats('Inserts', insertGas)
    logGasStats('Removes', removeGas)
    logGasStats('Sortitions', sortitionGas)

    assertBN(await tree.totalSum(), VALUE * ITERATIONS * (INSERTS - REMOVES), 'Total sum')
  })

  it('lots of activity, batched', async () => {
    const INSERTS = 64
    const REMOVES = 6
    const ITERATIONS = 65//1025
    const VALUE = 10

    let insertGas = []
    let removeGas = []
    let sortitionGas = []

    for (let i = 0; i < ITERATIONS; i++) {
      // add nodes
      insertGas.push(await tree.insertMultiple.estimateGas(VALUE, INSERTS))
      await tree.insertMultiple(VALUE, INSERTS)

      // remove
      removeGas.push(await tree.removeMultiple.estimateGas((INSERTS - REMOVES) * i, REMOVES))
      await tree.removeMultiple((INSERTS - REMOVES) * i, REMOVES)

      //console.log(`Iteration ${i}:`, (await tree.totalSum()).toNumber())
      // draw
      const sum = (await tree.totalSum()).toNumber()
      sortitionGas.push(await tree.sortition.estimateGas(0))
      sortitionGas.push(await tree.sortition.estimateGas(Math.round(sum / 2)))
      sortitionGas.push(await tree.sortition.estimateGas(sum - 1))
    }

    console.log((await tree.getState()).map(x => x.toNumber()))
    logGasStats('Inserts', insertGas)
    logGasStats('Removes', removeGas)
    logGasStats('Sortitions', sortitionGas)

    assertBN(await tree.totalSum(), VALUE * ITERATIONS * (INSERTS - REMOVES), 'Total sum')
  })
})
