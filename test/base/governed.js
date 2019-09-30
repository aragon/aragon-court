const { assertRevert } = require('../helpers/assertThrow')
const { assertAmountOfEvents, assertEvent } = require('../helpers/assertEvent')

const Governed = artifacts.require('Governed')

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

const itBehavesLikeGoverned = (GovernedContract, accounts) => {
  let governed
  const [_, governor, someone] = accounts

  beforeEach('create governed', async () => {
    governed = await GovernedContract.new(governor)
  })

  describe('getGovernor', () => {
    it('tells the expected governor', async () => {
      assert.equal(await governed.getGovernor(), governor, 'governor does not match')
    })
  })

  describe('changeGovernor', () => {
    context('when the sender is the governor', () => {
      const from = governor

      context('when the given address is not the zero address', () => {
        const newGovernor = someone

        it('changes the governor', async () => {
          await governed.changeGovernor(newGovernor, { from })

          assert.equal(await governed.governor(), newGovernor, 'governor does not match')
        })

        it('emits an event', async () => {
          const receipt = await governed.changeGovernor(newGovernor, { from })

          assertAmountOfEvents(receipt, 'GovernorChanged')
          assertEvent(receipt, 'GovernorChanged', { previousGovernor: governor, currentGovernor: newGovernor })
        })
      })

      context('when the given address is not the zero address', () => {
        const newGovernor = ZERO_ADDRESS

        it('reverts', async () => {
          await assertRevert(governed.changeGovernor(newGovernor, { from }), 'GVD_INVALID_GOVERNOR_ADDRESS')
        })
      })
    })

    context('when the sender is not the governor', () => {
      const from = someone

      it('reverts', async () => {
        await assertRevert(governed.changeGovernor(someone, { from }), 'GVD_SENDER_NOT_GOVERNOR')
      })
    })
  })

  describe('eject', () => {
    context('when the sender is the governor', () => {
      const from = governor

      it('removes the governor', async () => {
        await governed.eject({ from })

        assert.equal(await governed.governor(), ZERO_ADDRESS, 'governor does not match')
      })

      it('emits an event', async () => {
        const receipt = await governed.eject({ from })

        assertAmountOfEvents(receipt, 'GovernorChanged')
        assertEvent(receipt, 'GovernorChanged', { previousGovernor: governor, currentGovernor: ZERO_ADDRESS })
      })
    })

    context('when the sender is not the governor', () => {
      const from = someone

      it('reverts', async () => {
        await assertRevert(governed.eject({ from }), 'GVD_SENDER_NOT_GOVERNOR')
      })
    })
  })
}

contract('Governed', accounts => {
  itBehavesLikeGoverned(Governed, accounts)
})

module.exports = itBehavesLikeGoverned
