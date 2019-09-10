const REVERT_CODE = 'revert'
const THROW_ERROR_PREFIX_A = 'Returned error: VM Exception while processing transaction:'
const THROW_ERROR_PREFIX_B = 'VM Exception while processing transaction:' // ganache-core

function assertError(error, expectedErrorCode) {
  assert(error.message.search(expectedErrorCode) > -1, `Expected error code "${expectedErrorCode}" but failed with "${error}" instead.`)
}

async function assertThrows(blockOrPromise, expectedErrorCode, expectedReason) {
  try {
    (typeof blockOrPromise === 'function') ? await blockOrPromise() : await blockOrPromise
  } catch (error) {
    assertError(error, expectedErrorCode)
    return error
  }
  // assert.fail() for some reason does not have its error string printed 🤷
  assert(0, `Expected "${expectedErrorCode}"${expectedReason ? ` (with reason: "${expectedReason}")` : ''} but it did not fail`)
}

async function assertRevert(blockOrPromise, reason) {
  let ganacheCoreError = true;
  const error = await assertThrows(blockOrPromise, REVERT_CODE, reason)
  const errorPrefix_A = `${THROW_ERROR_PREFIX_A} ${REVERT_CODE}`
  const errorPrefix_B = `${THROW_ERROR_PREFIX_B} ${REVERT_CODE}`

  if (error.message.includes(errorPrefix_A)) {
    ganacheCoreError = false;
    error.reason = error.message.replace(errorPrefix_A, '')
    // Truffle 5 sometimes add an extra ' -- Reason given: reason.' to the error message 🤷
    error.reason = error.reason.replace(` -- Reason given: ${reason}.`, '').trim()
  }

  if (error.message.includes(errorPrefix_B) && ganacheCoreError){
    error.reason = error.message.replace(errorPrefix_B, '')
    // Truffle 5 sometimes add an extra ' -- Reason given: reason.' to the error message 🤷
    error.reason = error.reason.replace(` -- Reason given: ${reason}.`, '').trim()
  }

  if (process.env.SOLIDITY_COVERAGE !== 'true' && reason) {
    assert.equal(error.reason, reason, `Expected revert reason "${reason}" but failed with "${error.reason || 'no reason'}" instead.`)
  }
}

module.exports = {
  assertRevert,
}
