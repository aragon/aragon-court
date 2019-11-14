const memdown = require('memdown')
const ganache = require('ganache-cli')

const server = ganache.server({
  db: memdown(),
  default_balance_ether: 10000,
  total_accounts: 200,
  network_id: 15,
  gasLimit: 8000000,
  logger: console
})

server.listen(8545, function (_) {
  console.log('Ganache started')
})
