const aOSConfig = require("@aragon/os/truffle-config")

module.exports = {
  ...aOSConfig,

  solc: {
    optimizer: {
      enabled: true,
      runs: 1000     // could be increased depending on the final size of Court.sol
    },
  },
}
