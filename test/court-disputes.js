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

contract('Court: Disputes', ([ poor, rich, governor, juror1, juror2, juror3, arbitrable, other ]) => {
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
      await this.court.heartbeat(terms)
      await this.court.mock_blockTravel(1)
      assert.isFalse(await this.court.canTransitionTerm(), 'all terms transitioned')
    }

    beforeEach(async () => {
      const activateTerm = 1
      const deactivateTerm = 10000
      for (const juror of [juror1, juror2, juror3]) {
        await this.court.activate(activateTerm, deactivateTerm, { from: juror })
      }
      await passTerms(1) // term = 1
    })

    context('on dispute', () => {
      const jurors = 3
      const term = 3
      const rulings = 2

      const disputeId = 0 // TODO: Get from NewDispute event
      const firstRoundId = 0

      const DISPUTE_STATES = {
        PRE_DRAFT: 0,
        ADJUDICATING: 1,
        EXECUTED: 2,
        DISMISSED: 3
      }

      const commitVotes = async votes => {
        for (const [draftId, [juror, vote]] of votes.entries()) {
          const receiptPromise = this.court.commitVote(disputeId, firstRoundId, draftId, encryptVote(vote), { from: juror })
          await assertLogs(receiptPromise, VOTE_COMMITTED_EVENT)
        }
      }

      const revealVotes = async votes => {
        for (const [ draftId, [ juror, vote ]] of votes.entries()) {
          const receiptPromise = this.court.revealVote(disputeId, firstRoundId, draftId, vote, SALT, { from: juror })
          await assertLogs(receiptPromise, VOTE_REVEALED_EVENT)
        }
      }

      beforeEach(async () => {
        await assertLogs(this.court.createDispute(arbitrable, rulings, jurors, term, { from: poor }), NEW_DISPUTE_EVENT)
      })

      it('gets the correct dispute details', async () => {
        const [actualSubject, actualRulings, actualState] = await this.court.getDispute(disputeId)

        assert.strictEqual(actualSubject, arbitrable, 'incorrect dispute subject')
        await assertEqualBN(actualRulings, rulings, 'incorrect dispute rulings')
        await assertEqualBN(actualState, DISPUTE_STATES.PRE_DRAFT, 'incorrect dispute state')
      })

      it('gets the correct dispute round details', async () => {
        const expectedRuling = 1
        const expectedPenalties = true
        const expectedSlashing = 4
        const votes = [[juror1, 2], [juror2, 1], [juror3, 1]]
        await passTerms(2) // term = 3
        await this.court.draftAdjudicationRound(disputeId)
        await commitVotes(votes)
        await passTerms(1)
        await revealVotes(votes)
        await passTerms(2)
        await this.court.settleRoundSlashing(disputeId, firstRoundId)

        const [
          actualRuling,
          actualTerm,
          actualJurors,
          actualAccount,
          actualPenalties,
          actualSlashing
        ] = await this.court.getAdjudicationRound(disputeId, firstRoundId)

        await assertEqualBN(actualRuling, expectedRuling, 'incorrect round ruling')
        await assertEqualBN(actualTerm, term, 'incorrect round term')
        await assertEqualBN(actualJurors, jurors, 'incorrect round jurors')
        assert.strictEqual(actualAccount, poor, 'incorrect round account')
        assert.strictEqual(actualPenalties, expectedPenalties, 'incorrect round penalties')
        await assertEqualBN(actualSlashing, expectedSlashing, 'incorrect round slashing')
      })

      it('fails to draft outside of the draft term', async () => {
        await passTerms(1) // term = 2
        await assertRevert(this.court.draftAdjudicationRound(firstRoundId), 'COURT_NOT_DRAFT_TERM')
        await passTerms(2) // term = 4
        await assertRevert(this.court.draftAdjudicationRound(firstRoundId), 'COURT_NOT_DRAFT_TERM')
      })

      context('on juror draft (hijacked)', () => {
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
