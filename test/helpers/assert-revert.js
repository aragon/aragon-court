module.exports = async (receiptPromise, reason) => {
  try {
    await receiptPromise
  } catch (e) {
    if (reason) {
      e.reason = e.message.replace('VM Exception while processing transaction: revert ', '')
      assert.equal(e.reason, reason, 'Incorrect revert reason')
    }
    return
  }

  assert.fail(`Expected a revert for reason: ${reason}`)
}
