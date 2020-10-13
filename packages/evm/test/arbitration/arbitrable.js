const Arbitrable = artifacts.require('ArbitrableMock')

contract('Arbitrable', ([_, court]) => {
  let arbitrable

  beforeEach('create arbitrable instance', async () => {
    arbitrable = await Arbitrable.new(court)
  })

  it('supports ERC165', async () => {
    assert.isTrue(await arbitrable.supportsInterface('0x01ffc9a7'), 'does not support ERC165')
  })

  it('supports IArbitrable', async () => {
    assert.equal(await arbitrable.interfaceId(), '0x88f3ee69', 'IArbitrable interface ID does not match')
    assert.isTrue(await arbitrable.supportsInterface('0x88f3ee69'), 'does not support IArbitrable')
  })

  it('supports ERC165', async () => {
    assert.equal(await arbitrable.interfaceID(), await arbitrable.ARBITRABLE_INTERFACE(), 'IArbitrable interface ID does not match')
  })
})
