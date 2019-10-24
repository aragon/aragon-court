const aOSConfig = require("@aragon/os/truffle-config")
delete aOSConfig.solc

const config = {
  ...aOSConfig,

  compilers: {
    solc: {
      version: '0.5.8',
      settings: {
        optimizer: {
          enabled: true,
          runs: 10000
        },
      },
    },
  }
}

module.exports = config
