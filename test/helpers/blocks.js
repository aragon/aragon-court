const { promisify } = require('util')

module.exports = web3 => {
  const advanceBlock = async () => {
    return new Promise((resolve, reject) => web3.currentProvider.sendAsync({
      jsonrpc: '2.0',
      method: 'evm_mine',
      id: new Date().getTime()
    }, (error, result) => error ? reject(error) : resolve(result)))
  }

  const advanceBlocks = async blocks => {
    for (let i = 0; i < blocks; i++) {
      await advanceBlock()
    }
  }

  return {
    advanceBlock,
    advanceBlocks
  }
}
