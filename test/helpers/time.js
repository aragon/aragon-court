const ONE_DAY = 60 * 60 * 24
const ONE_WEEK = ONE_DAY * 7
const NOW = parseInt(new Date().getTime() / 1000) // EVM timestamps are expressed in seconds
const TOMORROW = NOW + ONE_DAY
const NEXT_WEEK = NOW + ONE_WEEK

module.exports = {
  NOW,
  TOMORROW,
  NEXT_WEEK,
  ONE_DAY,
  ONE_WEEK,
}
