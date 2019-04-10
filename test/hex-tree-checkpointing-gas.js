const HexSumTreePublic = artifacts.require('HexSumTreePublic')

const CHILDREN = 16

const getGas = (r) => {
  return { total: r.receipt.gasUsed, function: r.logs.filter(l => l.event == 'GasConsumed')[0].args['gas'].toNumber() }
}

contract('Hex Sum Tree (Gas analysis)', (accounts) => {
  let tree

  beforeEach(async () => {
    tree = await HexSumTreePublic.new()
    await tree.init()
  })

  const logTreeState = async () => {
    //console.log((await tree.getState()).map(x => x.toNumber()))
    const [ depth, nextKey ] = await tree.getState()
    console.log(`Tree depth:    ${depth}`);
    console.log(`Tree next key: ${nextKey.toNumber().toLocaleString()}`);
    console.log(`Tree total sum: `, (await tree.totalSum()).toNumber().toLocaleString())
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

  const insertNodes = async (nodes, value) => {
    let insertGas = []
    for (let i = 0; i < nodes; i++) {
      const r = await tree.insertNoLog(value)
      insertGas.push(getGas(r))
    }
    return insertGas
  }

  const getCheckpointTime = async () => {
    //return Math.floor(r.receipt.blockNumber / 256)
    return (await tree.getCheckpointTime()).toNumber()
  }

  const multipleUpdatesOnMultipleNodes = async (nodes, updates, startingKey, initialValue, blocksOffset) => {
    let setBns = [[]]
    let setGas = []
    for (let i = 1; i <= updates; i++) {
      setBns.push([])
      for (let j = 0; j < nodes; j++) {
        const checkpointTime = await getCheckpointTime()
        const value = initialValue + i
        const r = await tree.set(startingKey.add(j), value)
        setGas.push(getGas(r))
        if (setBns[i][setBns[i].length - 1] != checkpointTime) {
          setBns[i].push(checkpointTime)
        }
        await tree.advanceTime(blocksOffset) // blocks
      }
    }
    return { setBns, setGas }
  }
  const round = async(blocksOffset) => {
    const STARTING_KEY = (new web3.BigNumber(CHILDREN)).pow(5)
    const NODES = 10
    const UPDATES = 30
    const SORTITION_NUMBER = 10
    const initialBlockNumber = await tree.getBlockNumber64()
    const initialCheckpointTime = await tree.getCheckpointTime()
    console.log(`initial block number ${initialBlockNumber}, term ${initialCheckpointTime}`)
    await tree.setNextKey(STARTING_KEY)

    const insertGas = await insertNodes(NODES, 10)
    const { setBns, setGas } = await multipleUpdatesOnMultipleNodes(NODES, UPDATES, STARTING_KEY, 10, blocksOffset)

    // check all past values
    let sortitionGas = []
    for (let i = 1; i < setBns.length; i++) {
      for (let j = 0; j < setBns[i].length; j++) {
        const r = await tree.multiRandomSortition(SORTITION_NUMBER, setBns[i][j])
        const gas = getGas(r)
        sortitionGas.push(gas)
      }
    }

    await logTreeState()
    logGasStats('Inserts', insertGas)
    logGasStats('Sets', setGas)
    logGasStats('Sortitions', sortitionGas)

    const finalBlockNumber = await tree.getBlockNumber64()
    const finalCheckpointTime = await tree.getCheckpointTime()
    console.log(`final block number ${finalBlockNumber}, term ${finalCheckpointTime}`)
  }

  for (const blocksOffset of [1, 243]) {
    it(`multiple random sortition on a (fake) big tree with a lot of updates, ${blocksOffset} blocks in between`, async () => {
      await round(blocksOffset)
    })
  }

  it(`multiple random sortition on a (fake) big tree with a lot of updates in different terms, sortition always on last one`, async () => {
    const STARTING_KEY = (new web3.BigNumber(CHILDREN)).pow(5)
    const INITIAL_VALUE = 10
    const NODES = 10
    const UPDATES = 30
    const SORTITION_NUMBER = 10
    const initialBlockNumber = await tree.getBlockNumber64()
    const initialCheckpointTime = await tree.getCheckpointTime()
    console.log(`initial block number ${initialBlockNumber}, term ${initialCheckpointTime}`)
    await tree.setNextKey(STARTING_KEY)

    const insertGas = await insertNodes(NODES, 10)
    let setGas = []
    let sortitionGas = []
    for (let i = 1; i <= UPDATES; i++) {
      for (let j = 0; j < NODES; j++) {
        const checkpointTime = await getCheckpointTime()
        const value = INITIAL_VALUE + i
        const r1 = await tree.set(STARTING_KEY.add(j), value)
        setGas.push(getGas(r1))
        await tree.advanceTime(256) // blocks
        // sortition
        const r2 = await tree.multiRandomSortitionLast(SORTITION_NUMBER)
        sortitionGas.push(getGas(r2))
      }
    }

    await logTreeState()
    logGasStats('Inserts', insertGas)
    logGasStats('Sets', setGas)
    logGasStats('Sortitions', sortitionGas)

    const finalBlockNumber = await tree.getBlockNumber64()
    const finalCheckpointTime = await tree.getCheckpointTime()
    console.log(`final block number ${finalBlockNumber}, term ${finalCheckpointTime}`)
  })
})
