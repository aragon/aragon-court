const { getWeb3 } = require('@aragon/contract-helpers-test/src/config')

async function advanceBlock() {
  const web3 = getWeb3()
  return new Promise((resolve, reject) => web3.currentProvider.send({
    jsonrpc: '2.0',
    method: 'evm_mine',
    id: new Date().getTime()
  }, (error, result) => error ? reject(error) : resolve(result)))
}

async function advanceBlocks(blocks) {
  for (let i = 0; i < blocks; i++) {
    await advanceBlock()
  }
}

module.exports = {
  advanceBlock,
  advanceBlocks
}
