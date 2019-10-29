const { bn } = require('./numbers')
const { soliditySha3 } = require('web3-utils')

const OUTCOMES = {
  MISSING: bn(0),
  LEAKED: bn(1),
  REFUSED: bn(2),
  LOW: bn(3),
  HIGH: bn(4)
}

const SALT = soliditySha3('passw0rd')

const encryptVote = (outcome, salt = SALT) => {
  return soliditySha3({ t: 'uint8', v: outcome }, { t: 'bytes32', v: salt })
}

const getVoteId = (disputeId, roundId) => {
  return bn(2).pow(bn(128)).mul(bn(disputeId)).add(bn(roundId))
}

const outcomeFor = (n) => {
  return n % 2 === 0 ? OUTCOMES.LOW : OUTCOMES.HIGH
}

const oppositeOutcome = outcome => {
  return outcome.eq(OUTCOMES.LOW) ? OUTCOMES.HIGH : OUTCOMES.LOW
}

module.exports = {
  SALT,
  OUTCOMES,
  encryptVote,
  getVoteId,
  outcomeFor,
  oppositeOutcome
}
