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

module.exports = config
