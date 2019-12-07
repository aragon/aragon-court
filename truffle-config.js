const TruffleConfig = require('@aragon/truffle-config-v5/truffle-config')

TruffleConfig.compilers.solc.version = '0.5.8'
TruffleConfig.compilers.solc.settings.optimizer.runs = 3000 // DisputesManager module is hitting size limit with 10k runs

module.exports = TruffleConfig
