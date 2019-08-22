const { assertRevert } = require('@aragon/os/test/helpers/assertThrow')

const HexSumTree = artifacts.require('HexSumTreeMock')

const CHILDREN = 16

const getGas = (r) => {
  return { total: r.receipt.gasUsed, function: r.logs.filter(l => l.event == 'GasConsumed')[0].args['gas'].toNumber() }
}

const testRunner = process.env.SUMTREE_GAS_ANALYSIS ? contract.only : contract.skip

// TODO: profiling with an unused method, change to multisortition
contract.skip('Hex Sum Tree (Gas analysis)', (accounts) => {
  let tree

  beforeEach(async () => {
    tree = await HexSumTree.new()
    await tree.init()
  })

  const assertBN = (bn, n, m) => {
    assert.equal(bn.toNumber(), n, m)
  }

  const logTreeState = async () => {
    //console.log((await tree.getState()).map(x => x.toNumber()))
    const [ depth, nextKey ] = await tree.getState()
    console.log(`Tree depth:    ${depth}`);
    console.log(`Tree next key: ${nextKey.toNumber().toLocaleString()}`);
    console.log(`Tree total sum: `, (await tree.totalSum()).toNumber().toLocaleString())
  }

  const logSortitionGas = async (value, blockNumber) => {
    const r = await tree.sortition(value, blockNumber)
    const gas = getGas(r)
    console.log(`Sortition ${value} gas:`, gas.total.toLocaleString(), gas.function.toLocaleString())
  }

  const logSortitionHex = async (value, blockNumber) => {
    console.log(`Sortition ${value}:`, web3.toHex(await tree.sortition(value, blockNumber)))
  }

  const logSortition = async (value, blockNumber) => {
    console.log(`Sortition ${value}:`, (await tree.sortition(value, blockNumber)).toNumber())
  }

  const formatDivision = (result, colSize) => {
    return Math.round(result).toLocaleString().padStart(colSize, ' ')
  }
  const logGasStats = (title, gasArray, batchSize = 1) => {
    const COL_SIZE = 7
    console.log(title)
    console.log('Size:   ', gasArray.length)
    const min = (k) => Math.min(...gasArray.map(x => x[k]))
    const max = (k) => Math.max(...gasArray.map(x => x[k]))
    const avg = (k) => Math.round(gasArray.map(x => x[k]).reduce((a,b) => a + b, 0) / gasArray.length)
    console.log()
    console.log('|         |', 'Total'.padStart(COL_SIZE, ' '), '|', 'Function'.padStart(COL_SIZE, ' '), '|')
    console.log('|---------|' + '-'.padStart(COL_SIZE + 2, '-') + '|' + '-'.padStart(COL_SIZE + 2, '-') + '|')
    console.log('| Min     |', formatDivision(min('total') / batchSize, COL_SIZE), '|', formatDivision(min('function') / batchSize, COL_SIZE), '|')
    console.log('| Max     |', formatDivision(max('total') / batchSize, COL_SIZE), '|', formatDivision(max('function') / batchSize, COL_SIZE), '|')
    console.log('| Average |', formatDivision(avg('total') / batchSize, COL_SIZE), '|', formatDivision(avg('function') / batchSize, COL_SIZE), '|')
    console.log()
  }

  it('inserts one node', async () => {
    const r = await tree.insertNoLog(10)
    const insertGas = getGas(r)

    await logTreeState()
    console.log(`Insert gas:`, insertGas.total.toLocaleString(), insertGas.function.toLocaleString())
    await logSortitionGas(5, 0)
  })

  it('inserts a few consecutive nodes', async () => {
    let insertGas = []
    for (let i = 0; i < 270; i++) {
      const r = await tree.insertNoLog(10)
      insertGas.push(getGas(r))
    }

    await logTreeState()
    logGasStats('Inserts', insertGas)
    await logSortitionGas(2605, 0)
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
        const r = await tree.insertNoLog(VALUE)
        insertGas.push(getGas(r))
      }

      // remove
      for (let k = 0; k < REMOVES; k++) {
        const r = await tree.removeNoLog((INSERTS - REMOVES) * i + k)
        removeGas.push(getGas(r))
      }

      //console.log(`Iteration ${i}:`, (await tree.totalSum()).toNumber())
      // draw
      const sum = (await tree.totalSum()).toNumber()
      for (const v of [0, Math.round(sum / 2), sum - 1]) {
        const r = await tree.sortition(v, 0)
        sortitionGas.push(getGas(r))
      }
    }

    await logTreeState()
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
      const r1 = await tree.insertMultiple(VALUE, INSERTS)
      insertGas.push(getGas(r1))

      // remove
      const r2 = await tree.removeMultiple((INSERTS - REMOVES) * i, REMOVES)
      removeGas.push(getGas(r2))

      //console.log(`Iteration ${i}:`, (await tree.totalSum()).toNumber())
      // draw
      const sum = (await tree.totalSum()).toNumber()
      for (const v of [0, Math.round(sum / 2), sum - 1]) {
        const r = await tree.sortition(v, 0)
        sortitionGas.push(getGas(r))
      }
    }

    await logTreeState()
    logGasStats('Inserts', insertGas, INSERTS)
    logGasStats('Removes', removeGas, REMOVES)
    logGasStats('Sortitions', sortitionGas)

    assertBN(await tree.totalSum(), VALUE * ITERATIONS * (INSERTS - REMOVES), 'Total sum')
  })

  it('forcing (fake) big tree', async () => {
    const STARTING_KEY = (new web3.BigNumber(CHILDREN)).pow(7)
    await tree.setNextKey(STARTING_KEY)
    let insertGas = []
    for (let i = 0; i < 270; i++) {
      const r = await tree.insertNoLog(10)
      insertGas.push(getGas(r))
    }

    await logTreeState()
    logGasStats('Inserts', insertGas)
    await logSortitionGas(2605, 0)
  })

  const multipleUpdatesOnSingleNode = async (node, updates, initialValue) => {
    let setBns = [0]
    let setGas = []
    for (let i = 1; i <= updates; i++) {
      const r = await tree.set(node, initialValue + i)
      setGas.push(getGas(r))
      setBns.push(r.receipt.blockNumber)
    }

    return { setBns, setGas }
  }

  const historySortition = async (node, initialValue, setBns) => {
    let sortitionGas = []
    for (let i = 1; i < setBns.length; i++) {
      const value = (node + 1) * initialValue + i - 1
      const r = await tree.sortition(value, setBns[i])
      const gas = getGas(r)
      sortitionGas.push(gas)
    }
    return sortitionGas
  }

  it('inserts a lot of times into the first node', async () => {
    const NODE = 0
    const UPDATES = 200
    await tree.insertNoLog(10)

    const { setBns, setGas } = await multipleUpdatesOnSingleNode(NODE, UPDATES, 10)

    // check all past values
    const sortitionGas = await historySortition(NODE, 10, setBns)

    await logTreeState()
    logGasStats('Sets', setGas)
    logGasStats('Sortitions', sortitionGas)
  })

  const insertNodes = async (nodes, value) => {
    let insertGas = []
    for (let i = 0; i < nodes; i++) {
      const r = await tree.insertNoLog(value)
      insertGas.push(getGas(r))
    }
    return insertGas
  }

  it('inserts a lot of times into a middle node', async () => {
    const NODE = 250
    const UPDATES = 200

    const insertGas = await insertNodes(NODE + 20, 10)
    const { setBns, setGas } = await multipleUpdatesOnSingleNode(NODE, UPDATES, 10)

    // check all past values
    const sortitionGas = await historySortition(NODE, 10, setBns)

    await logTreeState()
    logGasStats('Sets', setGas)
    logGasStats('Inserts', insertGas)
    logGasStats('Sortitions', sortitionGas)
  })

  const multipleUpdatesOnMultipleNodes = async (nodes, updates, startingKey, initialValue) => {
    let setBns = [[]]
    let setGas = []
    for (let i = 1; i <= updates; i++) {
      setBns.push([])
      for (let j = 0; j < nodes; j++) {
        const r = await tree.set(startingKey.add(j), initialValue + i)
        setGas.push(getGas(r))
        setBns[i].push(r.receipt.blockNumber)
      }
    }
    return { setBns, setGas }
  }

  it('inserts a lot of times into a all nodes of a (fake) big tree', async () => {
    const STARTING_KEY = (new web3.BigNumber(CHILDREN)).pow(7)
    const NODES = 17
    const UPDATES = 80
    await tree.setNextKey(STARTING_KEY)

    const insertGas = await insertNodes(NODES, 10)
    const { setBns, setGas } = await multipleUpdatesOnMultipleNodes(NODES, UPDATES, STARTING_KEY, 10)

    // check all past values
    let sortitionGas = []
    for (let i = 1; i <= UPDATES; i++) {
      for (let j = 0; j < NODES; j++) {
        const value = (j + 1) * 10 + i - 1
        const r = await tree.sortition(value, setBns[i][j])
        const gas = getGas(r)
        sortitionGas.push(gas)
      }
    }

    await logTreeState()
    logGasStats('Inserts', insertGas)
    logGasStats('Sets', setGas)
    logGasStats('Sortitions', sortitionGas)
  })
})
