const { BN } = require('web3-utils')

const bn = x => new BN(x)
const bigExp = (x, y) => bn(x).mul(bn(10).pow(bn(y)))
const maxUint = (e) => bn(2).pow(bn(e)).sub(bn(1))

const ONE = bigExp(1, 18)
const MAX_UINT64 = maxUint(64)
const MAX_UINT192 = maxUint(192)
const MAX_UINT256 = maxUint(256)

module.exports = {
  bn,
  bigExp,
  ONE,
  MAX_UINT64,
  MAX_UINT192,
  MAX_UINT256
}
