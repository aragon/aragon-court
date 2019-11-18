const Arbitrable = artifacts.require('ArbitrableMock')

contract('Arbitrable', ([_, court]) => {
  it('supports ERC165', async () => {
    const arbitrable = await Arbitrable.new(court)

    assert.equal(await arbitrable.interfaceID(), await arbitrable.ARBITRABLE_INTERFACE_ID(), 'arbitrable interface ID does not match')
  })
})
