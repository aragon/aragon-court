const { toChecksumAddress } = require('web3-utils')

const filterJurors = (jurorsList, jurorsToFiler) => {
  const addressesToFiler = jurorsToFiler.map(j => toChecksumAddress(j.address))
  return jurorsList.filter(juror => !addressesToFiler.includes(toChecksumAddress(juror.address)))
}

const filterWinningJurors = (votersList, winningRuling) => {
  const winners = votersList.filter(({ outcome }) => outcome === winningRuling)
  const losers = filterJurors(votersList, winners)
  return [winners, losers]
}

module.exports = {
  filterJurors,
  filterWinningJurors
}
