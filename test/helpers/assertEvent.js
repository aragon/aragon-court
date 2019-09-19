const { getEventAt, getEvents } = require('@aragon/test-helpers/events')
const { isAddress, isBN, toChecksumAddress } = require('web3-utils')

const assertEvent = (receipt, eventName, expectedArgs = {}, index = 0) => {
  const event = getEventAt(receipt, eventName, index)

  assert(typeof event === 'object', `could not find an emitted ${eventName} event ${index === 0 ? '' : `at index ${index}`}`)

  for (const arg of Object.keys(expectedArgs)) {
    let foundArg = event.args[arg]
    if (isBN(foundArg)) foundArg = foundArg.toString()
    if (isAddress(foundArg)) foundArg = toChecksumAddress(foundArg)

    let expectedArg = expectedArgs[arg]
    if (isBN(expectedArg)) expectedArg = expectedArg.toString()
    if (isAddress(foundArg)) expectedArg = toChecksumAddress(expectedArg)

    assert.equal(foundArg, expectedArg, `${eventName} event ${arg} value does not match`)
  }
}

const assertAmountOfEvents = (receipt, eventName, expectedAmount = 1) => {
  const events = getEvents(receipt, eventName)
  assert.equal(events.length, expectedAmount, `number of ${eventName} events does not match`)
}

module.exports = {
  assertEvent,
  assertAmountOfEvents
}
