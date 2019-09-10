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
          runs: 1     // Could be increased depending on the final size of Court.sol. We are currently disabling the optimizer
                      // cause it is increasing the Court bytecode which causes an out-of-gas error when deploying it.
        },
      },
    },
  },
  plugins: [
    "solidity-coverage"
  ]
}

module.exports = config
