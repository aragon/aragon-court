const assertRevert = require('./helpers/assert-revert')

const CHILDREN = 16

const THRESHOLDS = [50, 1000, 1000000]

const getGas = (r) => {
  return { total: r.receipt.gasUsed, function: r.logs.filter(l => l.event == 'GasConsumed')[0].args['gas'].toNumber() }
}

const getTreeId = (value) => {
  let i
  for (i = 0; i < THRESHOLDS.length; i++) {
    if (value < THRESHOLDS[i]) {
      return i;
    }
  }
  return i;
}
const getLastTreeKey = async (tree, treeId) => {
  const [ depth, nextKey ] = await tree.getState(treeId)
  return nextKey.sub(1)
}
const encodeKeyVoid = async (tree, node, oldValue, newValue) => {
  return { key: node, newNode: node }
}
const encodeKey = async (tree, node, oldValue, newValue) => {
  const oldTreeId = getTreeId(oldValue)
  const newTreeId = getTreeId(newValue)
  if (oldTreeId == newTreeId) {
    return {
      key: new web3.BigNumber(2).pow(248).mul(oldTreeId).add(node),
      newNode: node
    }
  } else {
    const treeKey = await getLastTreeKey(tree, newTreeId)
    return {
      key: new web3.BigNumber(2).pow(248).mul(newTreeId).add(treeKey),
      newNode: treeKey
    }
  }
}

const TREE_CONTRACTS = {
  /**/
  HexSumTreePublic: {
    initParams: {},
    thresholds: [],
    encodeKey: encodeKeyVoid
  },
   /**/
  TierTreesWrapperPublic: {
    initParams: THRESHOLDS,
    thresholds: THRESHOLDS,
    encodeKey: encodeKey
  }
  /**/
}

for (const treeName of Object.keys(TREE_CONTRACTS)) {
  const TreePublic = artifacts.require(treeName)

  contract(treeName + ' (Gas analysis)', (accounts) => {
    let tree

    beforeEach(async () => {
      tree = await TreePublic.new()
      await tree.init(TREE_CONTRACTS[treeName].initParams)
    })

    const assertBN = (bn, n, m) => {
      assert.equal(bn.toNumber(), n, m)
    }

    const logTreeState = async () => {
      for (let i = 0; i <= TREE_CONTRACTS[treeName].thresholds.length; i++) {
        const [ depth, nextKey ] = await tree.getState(i)
        console.log(`Tree ${i} depth:    ${depth}`);
        console.log(`Tree ${i} next key: ${nextKey.toNumber().toLocaleString()}`);
        console.log(`Tree ${i} total sum: `, (await tree.getSubTreeSum(i)).toNumber().toLocaleString())
      }
      console.log()
      console.log(`Tree total sum: `, (await tree.totalSum()).toNumber().toLocaleString())
      console.log()
    }

    const logSortitionGas = async (value) => {
      const r = await tree.sortition(value)
      const gas = getGas(r)
      console.log(`Sortition ${value} gas:`, gas.total.toLocaleString(), gas.function.toLocaleString())
    }

    const logSortitionHex = async (value) => {
      console.log(`Sortition ${value}:`, web3.toHex(await tree.sortition(value)))
    }

    const logSortition = async (value) => {
      console.log(`Sortition ${value}:`, (await tree.sortition(value)).toNumber())
    }

    const logMultiSortitionGas = async (number) => {
      console.log(`Sortition of ${number} elements gas:`, (await tree.multiRandomSortition.estimateGas(number)).toLocaleString())
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
      await logSortitionGas(5)
    })

    it('inserts a few consecutive nodes', async () => {
      let insertGas = []
      for (let i = 0; i < 270; i++) {
        const r = await tree.insertNoLog(10)
        insertGas.push(getGas(r))
      }
      await logTreeState()
      logGasStats('Inserts', insertGas)
      await logSortitionGas(2605)
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

        // draw
        const sum = (await tree.totalSum()).toNumber()
        for (const v of [0, Math.round(sum / 2), sum - 1]) {
          const r = await tree.sortition(v)
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

        // draw
        const sum = (await tree.totalSum()).toNumber()
        for (const v of [0, Math.round(sum / 2), sum - 1]) {
          const r = await tree.sortition(v)
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
      await logSortitionGas(2605)
    })

    const multipleUpdatesOnSingleNode = async (node, updates, initialValue) => {
      let setGas = []
      for (let i = 1; i <= updates; i++) {
        const value = initialValue + i
        const { key, newNode } = await TREE_CONTRACTS[treeName].encodeKey(tree, node, value - 2, value - 1)
        node = newNode
        const r = await tree.set(key, value)
        setGas.push(getGas(r))
      }
      return setGas
    }

    it('inserts a lot of times into the first node', async () => {
      await tree.insertNoLog(10)

      const setGas = await multipleUpdatesOnSingleNode(0, 200, 10)

      await logTreeState()
      logGasStats('Sets', setGas)
      //await logSortition(0)
      await logSortitionGas(0)
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
      const insertGas = await insertNodes(270, 10)
      const setGas = await multipleUpdatesOnSingleNode(250, 200, 10)

      await logTreeState()
      logGasStats('Inserts', insertGas)
      logGasStats('Sets', setGas)
      //await logSortition(2505)
      await logSortitionGas(2505)
    })

    const multipleUpdatesOnMultipleNodes = async (nodes, updates, startingKey, initialValue) => {
      let setGas = []
      for (let j = 0; j < nodes; j++) {
        let node = startingKey.add(j)
        for (let i = 1; i <= updates; i++) {
          const value = initialValue + i
          const { key, newNode } = await TREE_CONTRACTS[treeName].encodeKey(tree, node, value - 2, value - 1)
          node = newNode
          const r = await tree.set(key, value)
          setGas.push(getGas(r))
        }
      }
      return setGas
    }

    it('inserts a lot of times into all nodes of a (fake) big tree', async () => {
      const STARTING_KEY = (new web3.BigNumber(CHILDREN)).pow(7)
      const NODES = 17
      const UPDATES = 100
      await tree.setNextKey(STARTING_KEY)

      const insertGas = await insertNodes(NODES, 10)
      const setGas = await multipleUpdatesOnMultipleNodes(NODES, UPDATES, STARTING_KEY, 10)

      await logTreeState()
      logGasStats('Inserts', insertGas)
      logGasStats('Sets', setGas)
      await logSortitionGas(UPDATES * NODES)
    })

    it('multiple random sortition on a (fake) big tree with a lot of updates', async () => {
      const STARTING_KEY = (new web3.BigNumber(CHILDREN)).pow(5)
      const NODES = 15
      const UPDATES = 50
      const SORTITION_NUMBER = 10
      await tree.setNextKey(STARTING_KEY)

      const insertGas = await insertNodes(NODES, 10)
      const setGas = await multipleUpdatesOnMultipleNodes(NODES, UPDATES, STARTING_KEY, 10)

      await logTreeState()
      logGasStats('Inserts', insertGas)
      logGasStats('Sets', setGas)
      await logMultiSortitionGas(SORTITION_NUMBER)
    })
  })
}
