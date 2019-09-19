const { bigExp } = require('../test/helpers/numbers')(web3)
const { getEventArgument } = require('@aragon/test-helpers/events')

const MAX_APPEAL_ROUNDS = 4
const APPEAL_STEP_FACTOR = 3
const INITIAL_JURORS_NUMBER = 3

const TREE_SIZE_STEP_FACTOR = 10
const TREE_MAX_SIZE = 10000

const MIN_JUROR_BALANCE = 100
const MAX_JUROR_BALANCE = 1000000

async function profileGas() {
  console.log(`MAX_APPEAL_ROUNDS: ${MAX_APPEAL_ROUNDS}`)
  console.log(`APPEAL_STEP_FACTOR: ${APPEAL_STEP_FACTOR}`)
  console.log(`INITIAL_JURORS_NUMBER: ${INITIAL_JURORS_NUMBER}`)
  const HexSumTree = artifacts.require('HexSumTreeGasProfiler')

  for (let treeSize = TREE_SIZE_STEP_FACTOR; treeSize <= TREE_MAX_SIZE; treeSize *= TREE_SIZE_STEP_FACTOR) {
    console.log(`\n=====================================`)
    console.log(`PROFILING TREE WITH SIZE ${treeSize}`)
    const tree = await HexSumTree.new()
    await insert(tree, treeSize)

    for (let round = 1, jurorsNumber = INITIAL_JURORS_NUMBER; round <= MAX_APPEAL_ROUNDS; round++, jurorsNumber *= APPEAL_STEP_FACTOR) {
      console.log(`\n------------------------------------`)
      console.log(`ROUND #${round} - drafting ${jurorsNumber} jurors`)
      await search(tree, jurorsNumber, round)
    }
  }
}

async function insert(tree, values) {
  const insertGasCosts = []
  for (let i = 0; i < values; i++) {
    const balance = Math.floor(Math.random() * MAX_JUROR_BALANCE) + MIN_JUROR_BALANCE
    const receipt = await tree.insert(0, bigExp(balance, 18))
    insertGasCosts.push(getGas(receipt))
  }

  await logTreeState(tree)
  logInsertStats(`${values} values inserted:`, insertGasCosts)
}

async function search(tree, jurorsNumber, batches) {
  const searchGasCosts = []
  const values = await computeSearchValues(tree, jurorsNumber, batches)

  for (let batch = 0; batch < batches; batch++) {
    const batchSearchValues = values[batch]
    const receipt = await tree.search(batchSearchValues, 0)
    searchGasCosts.push({ ...getGas(receipt), values: batchSearchValues.length })
  }

  logSearchStats(`${jurorsNumber} jurors searched in ${batches} batches:`, searchGasCosts)
}

async function computeSearchValues(tree, jurorsNumber, batches) {
  const searchValues = []
  const total = (await tree.total()).div(bigExp(1, 18))
  const step = total.divToInt(jurorsNumber)
  for (let i = 1; i <= jurorsNumber; i++) {
    const value = step.mul(i)
    searchValues.push(bigExp(value, 18))
  }

  const searchValuesPerBatch = []
  const jurorsPerBatch = Math.floor(jurorsNumber / batches)
  for (let batch = 0, batchSize = 0; batch < batches; batch++, batchSize += jurorsPerBatch) {
    const limit = (batch === batches - 1) ? searchValues.length : batchSize + jurorsPerBatch
    searchValuesPerBatch.push(searchValues.slice(batchSize, limit))
  }
  return searchValuesPerBatch
}

const getGas = receipt => {
  const total = receipt.receipt.gasUsed
  const functionCost = getEventArgument(receipt, 'GasConsumed', 'gas').toNumber()
  return { total, function: functionCost }
}

const logTreeState = async (tree) => {
  const total = await tree.total()
  const height = await tree.height()
  const nextKey = await tree.nextKey()
  console.log(`\nTree height:   ${height.toString()}`)
  console.log(`Tree next key: ${nextKey.toNumber().toLocaleString()}`)
  console.log(`Tree total:    ${total.div(bigExp(1, 18)).toNumber().toLocaleString()} e18`)
}

const logInsertStats = (title, gasCosts) => {
  const min = prop => Math.min(...gasCosts.map(x => x[prop])).toLocaleString()
  const max = prop => Math.max(...gasCosts.map(x => x[prop])).toLocaleString()
  const avg = prop => Math.round(gasCosts.map(x => x[prop]).reduce((a, b) => a + b, 0) / gasCosts.length).toLocaleString()

  printTable(title, [
    ['', 'Total', 'Function'],
    ['Min', min('total'), min('function')],
    ['Max', max('total'), max('function')],
    ['Average', avg('total'), avg('function')],
  ])
}

const logSearchStats = (title, gasCosts) => {
  const body = gasCosts.map((gasCost, batch) => {
    const { total, values, function: fnCost } = gasCost
    const batchName = `Batch ${batch} - ${values} values`
    return [batchName, total.toLocaleString(), fnCost.toLocaleString()]
  })

  printTable(title, [['', 'Total', 'Function'], ...body])
}

const printTable = (title, rows) => {
  const header = rows[0]
  const columnsMaxLengths = rows.reduce((maxLengths, row) =>
    row.map((cell, i) => Math.max(cell.length, maxLengths[i])),
    header.map(() => 0)
  )

  const formattedHeader = header.map((cell, i) => cell.padEnd(columnsMaxLengths[i], ' '))
  const formattedHeaderDiv = header.map((cell, i) => '-'.padEnd(columnsMaxLengths[i], '-'))
  const formattedBody = rows.slice(1).map(row => row.map((cell, i) => cell.padStart(columnsMaxLengths[i], ' ')))

  console.log(`\n${title}\n`)
  console.log(`| ${formattedHeader.join(' | ')} |`)
  console.log(`|-${formattedHeaderDiv.join('-|-')}-|`)
  formattedBody.forEach(row => console.log(`| ${row.join(' | ')} |`))
}

module.exports = callback => {
  profileGas()
    .then(callback)
    .catch(callback)
}

