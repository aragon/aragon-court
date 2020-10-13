const { sha3, toChecksumAddress } = require('web3-utils')

const ACTIVATE_DATA = sha3('activate(uint256)').slice(0, 10)

const filterJurors = (jurorsList, jurorsToFiler) => {
  const addressesToFiler = jurorsToFiler.map(j => toChecksumAddress(j.address))
  return jurorsList.filter(juror => !addressesToFiler.includes(toChecksumAddress(juror.address)))
}

const filterWinningJurors = (votersList, winningRuling) => {
  const winners = votersList.filter(({ outcome }) => outcome === winningRuling)
  const losers = filterJurors(votersList, winners)
  return [winners, losers]
}

const countJuror = (list, jurorAddress) => {
  const equalJurors = list.filter(address => address === jurorAddress)
  return equalJurors.length
}

const countEqualJurors = addresses => {
  return addresses.reduce((totals, address) => {
    const index = totals.map(juror => juror.address).indexOf(address)
    if (index >= 0) totals[index].count++
    else totals.push({ address, count: 1 })
    return totals
  }, [])
}

module.exports = {
  ACTIVATE_DATA,
  countJuror,
  countEqualJurors,
  filterJurors,
  filterWinningJurors
}
