const { soliditySha3 } = require('web3-utils')

const OUTCOMES = {
  MISSING: 0,
  LEAKED: 1,
  REFUSED: 2,
  LOW: 3,
  HIGH: 4,
}

module.exports = web3 => {
  const { bn } = require('./numbers')(web3)

  const SALT = soliditySha3('passw0rd')

  const encryptVote = (outcome, salt = SALT) => soliditySha3({ t: 'uint8', v: outcome }, { t: 'bytes32', v: salt })

  const getVoteId = (disputeId, roundId) => {
    return bn(2).pow(128).mul(disputeId).add(roundId)
  }

  const outcomeFor = (n) => {
    return n % 2 === 0 ? OUTCOMES.LOW : OUTCOMES.HIGH
  }

  const oppositeOutcome = outcome => {
    const isLow = (typeof outcome === 'object') ? outcome.eq(OUTCOMES.LOW) : (outcome == OUTCOMES.LOW)
    return isLow ? OUTCOMES.HIGH : OUTCOMES.LOW
  }

  return {
    SALT,
    OUTCOMES,
    encryptVote,
    getVoteId,
    outcomeFor,
    oppositeOutcome
  }
}
