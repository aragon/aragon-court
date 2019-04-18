const assertRevert = require('./helpers/assert-revert')
const { promisify } = require('util')
const { soliditySha3 } = require('web3-utils')

const TokenFactory = artifacts.require('TokenFactory')
const CourtMock = artifacts.require('CourtMock')

const MINIME = 'MiniMeToken'

const getLog = (receipt, logName, argName) => {
  const log = receipt.logs.find(({ event }) => event == logName)
  return log ? log.args[argName] : null
}

const deployedContract = async (receiptPromise, name) =>
  artifacts.require(name).at(getLog(await receiptPromise, 'Deployed', 'addr'))

const assertEqualBN = async (actualPromise, expected, message) =>
  assert.equal((await actualPromise).toNumber(), expected, message)

const assertLogs = async (receiptPromise, ...logNames) => {
  const receipt = await receiptPromise
  for (const logName of logNames) {
    assert.isNotNull(getLog(receipt, logName), `Expected ${logName} in receipt`)
  }
}

contract('Court: Disputes', ([ poor, rich, governor, juror1, juror2, juror3, arbitrable, other, ...accounts ]) => {
  const NO_DATA = ''
  const ZERO_ADDRESS = '0x' + '00'.repeat(20)
  
  const termDuration = 10
  const firstTermStart = 1
  const jurorMinStake = 400
  const startBlock = 1000
  const commitTerms = 1
  const revealTerms = 1
  const appealTerms = 1
  const penaltyPct = 100 // 100‱ = 1%
  
  const initialBalance = 1e6
  const richStake = 1000
  const juror1Stake = 1000
  const juror2Stake = 600
  const juror3Stake = 500

  const NEW_DISPUTE_EVENT = 'NewDispute'
  const JUROR_DRAFTED_EVENT = 'JurorDrafted'
  const DISPUTE_STATE_CHANGED_EVENT = 'DisputeStateChanged'
  const VOTE_COMMITTED_EVENT = 'VoteCommitted'
  const VOTE_REVEALED_EVENT = 'VoteRevealed'
  const RULING_APPEALED_EVENT = 'RulingAppealed'
  const ROUND_SLASHING_SETTLED_EVENT = 'RoundSlashingSettled'

  const SALT = soliditySha3('passw0rd')

  const encryptVote = (ruling, salt = SALT) =>
    soliditySha3(
      { t: 'uint8', v: ruling },
      { t: 'bytes32', v: salt }
    )

  const pct4 = (n, p) => n * p / 1e4

  before(async () => {
    this.tokenFactory = await TokenFactory.new()
  })

  beforeEach(async () => {
    // Mints 1,000,000 tokens for sender
    this.anj = await deployedContract(this.tokenFactory.newToken('ANJ', initialBalance, { from: rich }), MINIME)
    assertEqualBN(this.anj.balanceOf(rich), initialBalance, 'rich balance')
    assertEqualBN(this.anj.balanceOf(poor), 0, 'poor balance')

    this.court = await CourtMock.new(
      termDuration,
      this.anj.address,
      ZERO_ADDRESS, // no fees
      0,
      0,
      0,
      0,
      0,
      governor,
      firstTermStart,
      jurorMinStake,
      [ commitTerms, appealTerms, revealTerms ],
      penaltyPct
    )
    await this.court.mock_setBlockNumber(startBlock)
    // tree searches always return jurors in the order that they were added to the tree
    await this.court.mock_hijackTreeSearch()

    assert.equal(await this.court.token(), this.anj.address, 'court token')
    assert.equal(await this.court.jurorToken(), this.anj.address, 'court juror token')
    await assertEqualBN(this.court.mock_treeTotalSum(), 0, 'empty sum tree')
    
    await this.anj.approveAndCall(this.court.address, richStake, NO_DATA, { from: rich })

    await this.anj.approve(this.court.address, juror1Stake, { from: rich })
    await this.court.stakeFor(juror1, juror1Stake, NO_DATA, { from: rich })
    await this.anj.approve(this.court.address, juror2Stake, { from: rich })
    await this.court.stakeFor(juror2, juror2Stake, NO_DATA, { from: rich })
    await this.anj.approve(this.court.address, juror3Stake, { from: rich })
    await this.court.stakeFor(juror3, juror3Stake, NO_DATA, { from: rich })

    await assertEqualBN(this.court.totalStakedFor(rich), richStake, 'rich stake')
    await assertEqualBN(this.court.totalStakedFor(juror1), juror1Stake, 'juror1 stake')
    await assertEqualBN(this.court.totalStakedFor(juror2), juror2Stake, 'juror2 stake')
    await assertEqualBN(this.court.totalStakedFor(juror3), juror3Stake, 'juror3 stake')
  })

  it('can encrypt votes', async () => {
    const ruling = 10
    assert.equal(await this.court.encryptVote(ruling, SALT), encryptVote(ruling))
  })

  context('activating jurors', () => {

    const passTerms = async terms => {
      await this.court.mock_timeTravel(terms * termDuration)
      const heartbeatReceipt = await this.court.heartbeat(terms)
      await this.court.mock_blockTravel(1)
      assert.isFalse(await this.court.canTransitionTerm(), 'all terms transitioned')
      return heartbeatReceipt
    }

    beforeEach(async () => {
      const activateTerm = 1
      const deactivateTerm = 10000
      for (const juror of [juror1, juror2, juror3]) {
        await this.court.activate(activateTerm, deactivateTerm, { from: juror })
      }
      await passTerms(1) // term = 1
    })

    it('heartbeat executes after many jurors have activated', async () => {

      const activateJurors = async numberOfJurors => {
        const activateTerm = 2
        const deactivateTerm = 3

        for (let jurorNumber = 0; jurorNumber < numberOfJurors; jurorNumber++) {
          const juror = accounts[jurorNumber]
          await this.anj.approve(this.court.address, jurorMinStake, { from: rich })
          await this.court.stakeFor(juror, jurorMinStake, NO_DATA, { from: rich })
          await this.court.activate(activateTerm, deactivateTerm, { from: juror })
          console.log(`${jurorNumber + 1}) Total staked for juror ${juror}: ${await this.court.totalStakedFor(juror)}`)
        }
      }

      // Adds an update to the accounts in the egress queue, mocking their state as if the accounts had been slashed.
      // This increases the processing required when processing the egress queue. This gives us a better idea of the
      // upper limit for the size of the egress queue.
      const insertUpdates = async numberOfJurors => {
        for (let jurorNumber = 0; jurorNumber < numberOfJurors; jurorNumber++) {
          const juror = accounts[jurorNumber]
          await this.court.mock_accountUpdate(juror, 3, false, 100)
        }
      }

      const numberOfJurors = 195

      await activateJurors(numberOfJurors)

      const heartbeatUpdateQueueReceipt = await passTerms(1)
      console.log(`Gas used for update heartbeat: ${heartbeatUpdateQueueReceipt.receipt.gasUsed}`)

      await insertUpdates(numberOfJurors) // Can be commented out to show more typical gas usage

      const heartbeatEgressQueueReceipt = await passTerms(1)
      console.log(`Gas used for egress heartbeat: ${heartbeatEgressQueueReceipt.receipt.gasUsed}`)

      /**
       * Benchmarking results:
       *
       * 1 jurors: Update heartbeat: 58484 Egress heartbeat: 72059 (with inserted update: 66615)
       * 10 jurors: Update heartbeat: 262858 Egress heartbeat: 338313 (with inserted update: 344174)
       * 100 jurors: Update heartbeat: 2619489 Egress heartbeat: 3351588 (with inserted update: 3410099)
       * 145 jurors: Update heartbeat: 3794366 Egress heartbeat: 4843805 (with inserted update: 4928641)
       * 148 jurors: Update heartbeat: 3871194 Egress heartbeat: 4943288 (with inserted update: OOG)
       * 149 jurors: Update heartbeat: 3896803 Egress heartbeat: 4976450
       * 150 jurors: Update heartbeat: 3922412 Egress heartbeat: OOG
       * 190 jurors: Update heartbeat: 4969307 Egress heartbeat: OOG
       * 195 jurors: Update heartbeat: OOG Egress heartbeat: OOG
       *
       * Update queue processing limit ~190
       * Egress queue processing limit ~149
       * Egress queue with extra update limit ~145
       *
       * Update queue processing increases linearly, egress queue processing increases exponentially.
       * It should be noted that the OOG for each queue doesn't seem to happen at the gas limit (10000000),
       * but I believe this is due to the refund made after deleting data from storage.
       */
    })


    context('on dispute', () => {
      const jurors = 3
      const term = 3
      const rulings = 2

      const disputeId = 0 // TODO: Get from NewDispute event
      const firstRoundId = 0

      beforeEach(async () => {
        await assertLogs(this.court.createDispute(arbitrable, rulings, jurors, term), NEW_DISPUTE_EVENT)
      })

      it('fails to draft outside of the draft term', async () => {
        await passTerms(1) // term = 2
        await assertRevert(this.court.draftAdjudicationRound(firstRoundId), 'COURT_NOT_DRAFT_TERM')
        await passTerms(2) // term = 4
        await assertRevert(this.court.draftAdjudicationRound(firstRoundId), 'COURT_NOT_DRAFT_TERM')
      })

      context('on juror draft (hijacked)', () => {
        const commitVotes = async votes => {
          for (const [draftId, [juror, vote]] of votes.entries()) {
            const receiptPromise = this.court.commitVote(disputeId, firstRoundId, draftId, encryptVote(vote), { from: juror })
            await assertLogs(receiptPromise, VOTE_COMMITTED_EVENT)
          }
        }

        beforeEach(async () => {
          await passTerms(2) // term = 3
          await assertLogs(this.court.draftAdjudicationRound(firstRoundId), JUROR_DRAFTED_EVENT, DISPUTE_STATE_CHANGED_EVENT)
        })

        it('selects expected jurors', async () => {
          const expectedJurors = [juror1, juror2, juror3]

          for (const [ draftId, juror ] of expectedJurors.entries()) {
            const [ jurorAddr, ruling ] = await this.court.getJurorVote(disputeId, firstRoundId, draftId)

            assert.equal(jurorAddr, juror, `juror #${draftId} address`)
            assert.equal(ruling, 0, `juror #${draftId} vote`)
          }

          assertRevert(this.court.getJurorVote(0, 0, jurors)) // out of bounds
        })

        it('fails to draft a second time', async () => {
          await assertRevert(this.court.draftAdjudicationRound(firstRoundId), 'COURT_ROUND_ALREADY_DRAFTED') 
        })

        context('jurors commit', () => {
          const votes = [[juror1, 2], [juror2, 1], [juror3, 1]]
          const round1Ruling = 1
          const round1WinningVotes = 2

          const revealVotes = async votes => {
            for (const [ draftId, [ juror, vote ]] of votes.entries()) {
              const receiptPromise = this.court.revealVote(disputeId, firstRoundId, draftId, vote, SALT, { from: juror })
              await assertLogs(receiptPromise, VOTE_REVEALED_EVENT)
            }
          }

          beforeEach(async () => {
            await commitVotes(votes)
          })

          it('fails to reveal during commit period', async () => {
            const draftId = 0
            const [ juror, vote ] = votes[draftId]
            const receiptPromise = this.court.revealVote(disputeId, firstRoundId, draftId, vote, SALT, { from: juror })
            assertRevert(receiptPromise, 'COURT_INVALID_ADJUDICATION_STATE')
          })

          it('fails to reveal if salt is incorrect', async () => {
            await passTerms(1) // term = 4
            const draftId = 0
            const [ juror, vote ] = votes[draftId]
            const badSalt = soliditySha3('not the salt')
            const receiptPromise = this.court.revealVote(disputeId, firstRoundId, draftId, vote, badSalt, { from: juror })
            assertRevert(receiptPromise, 'COURT_FAILURE_COMMITMENT_CHECK')
          })

          it('fails to reveal if already revealed', async () => {
            await passTerms(1) // term = 4
            const draftId = 0
            const [ juror, vote ] = votes[draftId]
            await this.court.revealVote(disputeId, firstRoundId, draftId, vote, SALT, { from: juror }) // reveal once
            const receiptPromise = this.court.revealVote(disputeId, firstRoundId, draftId, vote, SALT, { from: juror })
            assertRevert(receiptPromise, 'COURT_ALREADY_VOTED') // fails to reveal twice
          })

          it("fails to reveal if sender isn't the drafted juror", async () => {
            await passTerms(1) // term = 4
            const draftId = 0
            const [, vote ] = votes[draftId]
            const receiptPromise = this.court.revealVote(disputeId, firstRoundId, draftId, vote, SALT, { from: other })
            assertRevert(receiptPromise, 'COURT_INVALID_JUROR')
          })

          context('jurors reveal', () => {
            beforeEach(async () => {
              await passTerms(1) // term = 4
              await revealVotes(votes)
            })

            it('stored votes', async () => {
              for (const [ draftId, [ juror, vote ]] of votes.entries()) {
                const [, ruling ] = await this.court.getJurorVote(disputeId, firstRoundId, draftId)

                assert.equal(ruling, vote, `juror #${draftId} revealed vote ${vote}`)
              }
            })

            it('has correct ruling result', async () => {
              assertEqualBN(this.court.getWinningRuling(disputeId), round1Ruling, 'winning ruling')
            })

            it('fails to appeal during reveal period', async () => {
              await assertRevert(this.court.appealRuling(disputeId, firstRoundId), 'COURT_INVALID_ADJUDICATION_STATE')
            })

            it('fails to appeal incorrect round', async () => {
              await passTerms(1) // term = 5
              await assertRevert(this.court.appealRuling(disputeId, firstRoundId + 1), 'COURT_INVALID_ADJUDICATION_ROUND')
            })

            context('settling round', () => {
              const slashed = pct4(jurorMinStake, penaltyPct)

              beforeEach(async () => {
                await passTerms(2) // term = 6
                await assertLogs(this.court.settleRoundSlashing(disputeId, firstRoundId), ROUND_SLASHING_SETTLED_EVENT)
              })

              it('slashed incoherent juror', async () => {
                await assertEqualBN(this.court.totalStakedFor(juror1), juror1Stake - slashed, 'juror1 slashed')
              })

              it('coherent jurors can claim reward', async () => {
                const reward = slashed / 2

                await assertEqualBN(this.court.totalStakedFor(juror2), juror2Stake, 'juror2 pre-reward')
                await assertLogs(this.court.settleReward(disputeId, firstRoundId, 1))
                await assertEqualBN(this.court.totalStakedFor(juror2), juror2Stake + reward, 'juror2 post-reward')

                await assertEqualBN(this.court.totalStakedFor(juror3), juror3Stake, 'juror3 pre-reward')
                await assertLogs(this.court.settleReward(disputeId, firstRoundId, 2))
                await assertEqualBN(this.court.totalStakedFor(juror3), juror3Stake + reward, 'juror3 post-reward')
              })
            })

            context('on appeal', () => {
              beforeEach(async () => {
                await passTerms(1) // term = 5
                await assertLogs(this.court.appealRuling(disputeId, firstRoundId), RULING_APPEALED_EVENT)
              })

              it('drafts jurors', async () => {
                await passTerms(1) // term = 6
                await assertLogs(this.court.draftAdjudicationRound(firstRoundId), JUROR_DRAFTED_EVENT, DISPUTE_STATE_CHANGED_EVENT)
              })
            })
          })
        })
      })
    })
  })
})
