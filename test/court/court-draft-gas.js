const { bn, bigExp } = require('../helpers/numbers')
const { buildHelper } = require('../helpers/court')(web3, artifacts)
const { decodeEventsOfType } = require('../helpers/decodeEvent')
const { assertAmountOfEvents, assertEvent } = require('../helpers/assertEvent')

const JurorsRegistry = artifacts.require('JurorsRegistry')

contract('Court', ([_, juror500, juror1000, juror1500, juror2000]) => {
  let courtHelper, court, disputeId

  const jurors = [
    { address: juror500,  initialActiveBalance: bigExp(500,  21) },
    { address: juror1000, initialActiveBalance: bigExp(1000, 21) },
    { address: juror1500, initialActiveBalance: bigExp(1500, 21) },
    { address: juror2000, initialActiveBalance: bigExp(2000, 21) },
  ]

  const deployAndcreateDispute = async (jurorsNumber) => {
    const draftTermId = bn(1)
    courtHelper = buildHelper()
    court = await courtHelper.deploy({ maxJurorsToBeDraftedPerBatch: jurorsNumber, firstRoundJurorsNumber: jurorsNumber })
    await courtHelper.activate(jurors)
    disputeId = await courtHelper.dispute({ draftTermId })
    await courtHelper.passRealTerms(1)
  }

  it('measures gas', async () => {
    for (let j of [ 3, 5, 10, 50, 100 ]) {
      await deployAndcreateDispute(j)
      const gas = await court.draft.estimateGas(disputeId)
      console.log(`Number of jurors: ${j}, gas: ${gas}, ratio: ${Math.round(gas / j)}`)
      const receipt = await court.draft(disputeId)
      const logs = decodeEventsOfType(receipt, JurorsRegistry.abi, 'JurorDrafted')
      assertAmountOfEvents({ logs }, 'JurorDrafted', j)
    }
  })

})
