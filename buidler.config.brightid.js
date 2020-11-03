// This buidler configuration is only used to compile the BrightIdRegister contracts for testing, which are using solc 0.4.24
// Compile with 'yarn compile:brightid'

module.exports = {
  solc: {
    version: "0.4.24",
    optimizer: {
      enabled: true,
      runs: 10000,
    },
  },
  paths: {
    sources: "./external",
  }
}
