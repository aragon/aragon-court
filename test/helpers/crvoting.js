const { soliditySha3 } = require('web3-utils')

const OUTCOMES = {
  MISSING: 0,
  LEAKED: 1,
  REFUSED: 2,
  LOW: 3,
  HIGH: 4,
}

const SALT = soliditySha3('passw0rd')
const encryptVote = (outcome, salt = SALT) => soliditySha3({ t: 'uint8', v: outcome }, { t: 'bytes32', v: salt })

module.exports = {
  SALT,
  OUTCOMES,
  encryptVote
}
