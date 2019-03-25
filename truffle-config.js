const aOSConfig = require("@aragon/os/truffle-config")

let config = {
  ...aOSConfig,

  solc: {
    optimizer: {
      enabled: true,
      runs: 1     // could be increased depending on the final size of Court.sol
      // Disabling the optimizer or setting a higher runs value causes CourtMock deployments to out of gas for any gas amount
    },
  },
}

config.networks.rpc.gas = 10e6

module.exports = config