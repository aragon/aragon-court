const { usePlugin } = require('@nomiclabs/buidler/config')

usePlugin('@nomiclabs/buidler-truffle5')
usePlugin('buidler-abi-exporter')

module.exports = {
  defaultNetwork: 'buidlerevm',
  networks: {
    buidlerevm: {},
    localhost: {
      url: 'http://localhost:8545'
    },
    rinkeby: {
      url: 'https://rinkeby.eth.aragon.network',
      accounts: [
        process.env.ETH_KEY ||
        '0xa8a54b2d8197bc0b19bb8a084031be71835580a01e70a45a13babd16c9bc1563',
      ],
      gas: 7.9e6,
      gasPrice: 15000000001
    },
  },
  solc: {
    version: '0.5.8',
    optimizer: {
      enabled: true,
      runs: 3000 // DisputesManager module is hitting size limit with 10k runs
    }
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_KEY || ''
  },
  abiExporter: {
    path: './abi',
    only: [],
    clear: true,
  }
}
