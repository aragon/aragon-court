const { bn } = require('./numbers')

module.exports = web3 => {
  async function getWeiBalance(address) {
    const balance = await web3.eth.getBalance(address)
    return bn(balance)
  }

  async function getGasConsumed(receipt) {
    const { tx, receipt: { gasUsed } } = receipt
    const { gasPrice } = await web3.eth.getTransaction(tx)
    return bn(gasUsed).mul(bn(gasPrice))
  }

  return {
    getWeiBalance,
    getGasConsumed
  }
}
