const { ONE_DAY } = require('./helpers/time')
const { buildHelper } = require('./helpers/court')(web3, artifacts)
const { SALT, encryptVote } = require('./helpers/crvoting')
const { assertRevert } = require('@aragon/os/test/helpers/assertThrow')
const { decodeEventsOfType } = require('./helpers/decodeEvent')

const TokenFactory = artifacts.require('TokenFactory')
const CourtAccounting = artifacts.require('CourtAccounting')
const JurorsRegistry = artifacts.require('JurorsRegistryMock')
const CRVoting = artifacts.require('CRVoting')
const Subscriptions = artifacts.require('SubscriptionsMock')
const Arbitrable = artifacts.require('ArbitrableMock')

const MINIME = 'MiniMeToken'

const getLog = (receipt, logName, argName) => {
  const log = receipt.logs.find(({ event }) => event == logName)
  return log ? log.args[argName] : null
}

const getDeepLog = (receipt, contractAbi, logName, argName) => {
  const logs = decodeEventsOfType(receipt, contractAbi, logName)
  const log = logs[0]
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

const assertDeepLogs = async (receiptPromise, contractAbi, ...logNames) => {
  const receipt = await receiptPromise
  for (const logName of logNames) {
    assert.isNotNull(getDeepLog(receipt, contractAbi, logName), `Expected ${logName} in receipt`)
  }
}

const getVoteId = (disputeId, roundId) => {
  return new web3.BigNumber(2).pow(128).mul(disputeId).add(roundId)
}

contract('Court: Disputes', ([ rich, juror1, juror2, juror3, other, appealMaker, appealTaker ]) => {
  const NO_DATA = ''
  const MAX_UINT256 = new web3.BigNumber(2).pow(256).sub(1)
  const jurors = [ juror1, juror2, juror3 ]

  const termDuration = ONE_DAY
  const jurorsMinActiveBalance = 400
  const commitTerms = 1
  const revealTerms = 1
  const appealTerms = 1
  const appealConfirmTerms = 1
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
  const RULING_APPEAL_CONFIRMED_EVENT = 'RulingAppealConfirmed'
  const RULING_EXECUTED_EVENT = 'RulingExecuted'
  const ROUND_SLASHING_SETTLED_EVENT = 'RoundSlashingSettled'

  const ERROR_INVALID_DISPUTE_STATE = 'CTBAD_DISPUTE_STATE'
  const ERROR_SUBSCRIPTION_NOT_PAID = 'CTSUBSC_UNPAID'
  const ERROR_NOT_DRAFT_TERM = 'CTNOT_DRAFT_TERM'
  const ERROR_ROUND_ALREADY_DRAFTED = 'CTROUND_ALRDY_DRAFTED'
  const ERROR_INVALID_ADJUDICATION_STATE = 'CTBAD_ADJ_STATE'
  const ERROR_INVALID_ADJUDICATION_ROUND = 'CTBAD_ADJ_ROUND'

  const REFUSED_RULING = 2

  const pct4 = (n, p) => n * p / 1e4

  before(async () => {
    this.tokenFactory = await TokenFactory.new()
  })

  beforeEach(async () => {
    // Mints 1,000,000 tokens for sender
    this.anj = await deployedContract(this.tokenFactory.newToken('ANJ', initialBalance, { from: rich }), MINIME)
    await assertEqualBN(this.anj.balanceOf(rich), initialBalance, 'rich balance')
    // fee token
    this.feeToken = await deployedContract(this.tokenFactory.newToken('CFT', initialBalance * 3, { from: rich }), MINIME)
    await this.feeToken.transfer(appealMaker, initialBalance, { from: rich })
    await this.feeToken.transfer(appealTaker, initialBalance, { from: rich })
    await assertEqualBN(this.feeToken.balanceOf(rich), initialBalance, 'rich fee token balance')
    await assertEqualBN(this.feeToken.balanceOf(appealMaker), initialBalance, 'appeal maker fee token balance')
    await assertEqualBN(this.feeToken.balanceOf(appealTaker), initialBalance, 'appeal taker fee token balance')

    this.jurorsRegistry = await JurorsRegistry.new()
    this.accounting = await CourtAccounting.new()
    this.voting = await CRVoting.new()
    this.arbitrable = await Arbitrable.new()
    this.subscriptions = await Subscriptions.new()
    await this.subscriptions.setUpToDate(true)

    this.courtHelper = buildHelper()
    this.court = await this.courtHelper.deploy({
      feeToken: this.feeToken,
      jurorToken: this.anj,
      voting: this.voting,
      accounting: this.accounting,
      subscriptions: this.subscriptions,
      jurorsRegistry: this.jurorsRegistry,
      termDuration,
      commitTerms,
      revealTerms,
      appealTerms,
      appealConfirmTerms,
      jurorsMinActiveBalance,
    })

    // tree searches always return jurors in the order that they were added to the tree
    await this.jurorsRegistry.mock_hijackTreeSearch()

    assert.equal(await this.jurorsRegistry.token(), this.anj.address, 'court token')
    await assertEqualBN(this.jurorsRegistry.mock_treeTotalSum(), 0, 'empty sum tree')
    
    await this.anj.approveAndCall(this.jurorsRegistry.address, richStake, NO_DATA, { from: rich })

    await this.anj.approve(this.jurorsRegistry.address, juror1Stake, { from: rich })
    await this.jurorsRegistry.stakeFor(juror1, juror1Stake, NO_DATA, { from: rich })
    await this.anj.approve(this.jurorsRegistry.address, juror2Stake, { from: rich })
    await this.jurorsRegistry.stakeFor(juror2, juror2Stake, NO_DATA, { from: rich })
    await this.anj.approve(this.jurorsRegistry.address, juror3Stake, { from: rich })
    await this.jurorsRegistry.stakeFor(juror3, juror3Stake, NO_DATA, { from: rich })

    await assertEqualBN(this.jurorsRegistry.totalStakedFor(rich), richStake, 'rich stake')
    await assertEqualBN(this.jurorsRegistry.totalStakedFor(juror1), juror1Stake, 'juror1 stake')
    await assertEqualBN(this.jurorsRegistry.totalStakedFor(juror2), juror2Stake, 'juror2 stake')
    await assertEqualBN(this.jurorsRegistry.totalStakedFor(juror3), juror3Stake, 'juror3 stake')

    await this.feeToken.approve(this.court.address, initialBalance, { from: rich })
    await this.feeToken.approve(this.court.address, initialBalance, { from: appealMaker })
    await this.feeToken.approve(this.court.address, initialBalance, { from: appealTaker })
  })

  it('can encrypt votes', async () => {
    const ruling = 10
    assert.equal(await this.voting.encryptVote(ruling, SALT), encryptVote(ruling))
  })

  context('activating jurors', () => {
    const passTerms = async terms => {
      await this.courtHelper.increaseTime(terms * termDuration)
      await this.court.heartbeat(terms)

      assert.isFalse(await this.court.canTransitionTerm(), 'all terms transitioned')
    }

    beforeEach(async () => {
      for (const juror of jurors) {
        await this.jurorsRegistry.activate(0, { from: juror })
      }
      await passTerms(1) // term = 1
    })

    context('on dispute', () => {
      const jurorsNumber = 3
      const term = 3
      const rulings = 2

      let disputeId = 0
      const firstRoundId = 0
      let voteId

      const DISPUTE_STATES = {
        PRE_DRAFT: 0,
        ADJUDICATING: 1,
        EXECUTED: 2
      }

      beforeEach(async () => {
        const receipt = await this.court.createDispute(this.arbitrable.address, rulings, jurorsNumber, term, { from: rich })
        assertLogs(receipt, NEW_DISPUTE_EVENT)
        disputeId = getLog(receipt, NEW_DISPUTE_EVENT, 'disputeId')
        voteId = getVoteId(disputeId, firstRoundId)
      })

      it('fails creating dispute if subscriptions are not up to date', async () => {
        await this.subscriptions.setUpToDate(false)
        await assertRevert(this.court.createDispute(this.arbitrable.address, rulings, jurorsNumber, term), ERROR_SUBSCRIPTION_NOT_PAID)
      })

      it('gets the correct dispute details', async () => {
        const [actualSubject, actualRulings, actualState, winningRuling] = await this.court.getDispute(disputeId)

        assert.strictEqual(actualSubject, this.arbitrable.address, 'incorrect dispute subject')
        await assertEqualBN(actualRulings, rulings, 'incorrect dispute rulings')
        await assertEqualBN(actualState, DISPUTE_STATES.PRE_DRAFT, 'incorrect dispute state')
        await assert.equal(winningRuling, 0, 'incorrect winning ruling')
      })

      it('fails to draft outside of the draft term', async () => {
        await passTerms(1) // term = 2
        // advance two blocks to ensure we can compute term randomness
        await this.courtHelper.advanceBlocks(2)

        await assertRevert(this.court.draftAdjudicationRound(disputeId), ERROR_NOT_DRAFT_TERM)
      })

      context('on juror draft (hijacked)', () => {
        const commitVotes = async votes => {
          for (const [draftId, [juror, vote]] of votes.entries()) {
            const receipt = await this.voting.commit(voteId, encryptVote(vote), { from: juror })
            assertLogs(receipt, VOTE_COMMITTED_EVENT)
          }
        }

        beforeEach(async () => {
          await passTerms(2) // term = 3
          // advance two blocks to ensure we can compute term randomness
          await this.courtHelper.advanceBlocks(2)

          const receipt = await this.court.draftAdjudicationRound(disputeId)
          assertDeepLogs(receipt, this.jurorsRegistry.abi, JUROR_DRAFTED_EVENT)
          assertLogs(receipt, DISPUTE_STATE_CHANGED_EVENT)
        })

        it('selects expected jurors', async () => {
          const expectedJurors = [juror1, juror2, juror3]

          for (const [ draftId, juror ] of expectedJurors.entries()) {
            const ruling = await this.voting.getVoterOutcome(voteId, juror)

            assert.equal(ruling, 0, `juror #${draftId} vote`)
          }
        })

        it('fails to get cast vote out of bounds', async () => {
          await assertRevert(this.voting.getVoterOutcome(voteId + 1, juror1)) // out of bounds
        })

        it('fails to draft a second time', async () => {
          await assertRevert(this.court.draftAdjudicationRound(disputeId), ERROR_ROUND_ALREADY_DRAFTED)
        })

        context('jurors commit', () => {
          const winningRuling = 3
          const losingRuling = 4
          const votes = [[juror1, losingRuling], [juror2, winningRuling], [juror3, winningRuling]]

          const revealVotes = async votes => {
            for (const [ draftId, [ juror, vote ]] of votes.entries()) {
              const receipt = await this.voting.reveal(voteId, vote, SALT, { from: juror })
              assertLogs(receipt, VOTE_REVEALED_EVENT)
            }
          }

          beforeEach(async () => {
            await commitVotes(votes)
          })

          it('fails to reveal during commit period', async () => {
            const draftId = 0
            const [ juror, vote ] = votes[draftId]
            const receiptPromise = this.voting.reveal(voteId, vote, SALT, { from: juror })
            await assertRevert(receiptPromise, ERROR_INVALID_ADJUDICATION_STATE)
          })

          it('fails to reveal if salt is incorrect', async () => {
            await passTerms(1) // term = 4
            const draftId = 0
            const [ juror, vote ] = votes[draftId]
            const badSalt = 'not the salt'
            const receiptPromise = this.voting.reveal(voteId, vote, badSalt, { from: juror })
            await assertRevert(receiptPromise, 'CRV_INVALID_COMMITMENT_SALT')
          })

          it('fails to reveal if already revealed', async () => {
            await passTerms(1) // term = 4
            const draftId = 0
            const [ juror, vote ] = votes[draftId]
            await this.voting.reveal(voteId, vote, SALT, { from: juror }) // reveal once
            const receiptPromise = this.voting.reveal(voteId, vote, SALT, { from: juror })
            await assertRevert(receiptPromise, 'CRV_VOTE_ALREADY_REVEALED') // fails to reveal twice
          })

          it("fails to reveal if sender isn't the drafted juror", async () => {
            await passTerms(1) // term = 4
            const draftId = 0
            const [, vote ] = votes[draftId]
            const receiptPromise = this.voting.reveal(voteId, vote, SALT, { from: other })
            await assertRevert(receiptPromise, 'CRV_REVEAL_DENIED_BY_OWNER')
          })

          context('jurors reveal', () => {
            beforeEach(async () => {
              await passTerms(1) // term = 4
              await revealVotes(votes)
            })

            it('stored votes', async () => {
              for (const [ draftId, [ juror, vote ]] of votes.entries()) {
                const ruling = await this.voting.getVoterOutcome(voteId, juror)

                assert.equal(ruling, vote, `juror #${draftId} revealed vote ${vote}`)
              }
            })

            it('has correct ruling result', async () => {
              assert.equal((await this.voting.getWinningOutcome(voteId)).toNumber(), winningRuling, 'winning ruling')
            })

            it('fails to appeal during reveal period', async () => {
              await assertRevert(this.court.appeal(disputeId, firstRoundId, losingRuling), ERROR_INVALID_ADJUDICATION_STATE)
            })

            it('fails to appeal incorrect round', async () => {
              await passTerms(1) // term = 5
              await assertRevert(this.court.appeal(disputeId, firstRoundId + 1, losingRuling), ERROR_INVALID_ADJUDICATION_ROUND)
            })

            it('can settle if executed', async () => {
              await passTerms(revealTerms + appealTerms + appealConfirmTerms)
              // execute
              const executeReceipt = await this.court.executeRuling(disputeId)
              assertLogs(executeReceipt, RULING_EXECUTED_EVENT)
              // settle
              assertLogs(await this.court.settleRoundSlashing(disputeId, firstRoundId, MAX_UINT256), ROUND_SLASHING_SETTLED_EVENT)
            })

            it('fails trying to execute twice', async () => {
              await passTerms(revealTerms + appealTerms + appealConfirmTerms)
              // execute
              const executeReceiptPromise = await this.court.executeRuling(disputeId)
              await assertLogs(executeReceiptPromise, RULING_EXECUTED_EVENT)
              // try to execute again
              await assertRevert(this.court.executeRuling(disputeId), ERROR_INVALID_DISPUTE_STATE)
            })

            context('settling round', () => {
              const slashed = pct4(jurorsMinActiveBalance, penaltyPct)

              beforeEach(async () => {
                await passTerms(revealTerms + appealTerms + appealConfirmTerms)
                assertLogs(await this.court.settleRoundSlashing(disputeId, firstRoundId, MAX_UINT256), ROUND_SLASHING_SETTLED_EVENT)
              })

              it('gets the correct dispute round details', async () => {
                const expectedPenalties = true
                const expectedSlashing = 4

                const [
                  actualTerm,
                  actualJurors,
                  actualAccount,
                  actualPenalties,
                  actualSlashing
                ] = await this.court.getAdjudicationRound(disputeId, firstRoundId)

                await assertEqualBN(actualTerm, term, 'incorrect round term')
                await assertEqualBN(actualJurors, jurorsNumber, 'incorrect round jurors')
                assert.strictEqual(actualAccount, rich, 'incorrect round account')
                assert.strictEqual(actualPenalties, expectedPenalties, 'incorrect round penalties')
                await assertEqualBN(actualSlashing, expectedSlashing, 'incorrect round slashing')
              })

              it('slashed incoherent juror', async () => {
                await assertEqualBN(this.jurorsRegistry.totalStakedFor(juror1), juror1Stake - slashed, 'juror1 slashed')
              })

              it('coherent jurors can claim reward', async () => {
                const reward = slashed / 2

                await assertEqualBN(this.jurorsRegistry.totalStakedFor(juror2), juror2Stake, 'juror2 pre-reward')
                assertLogs(await this.court.settleReward(disputeId, firstRoundId, juror2))
                await assertEqualBN(this.jurorsRegistry.totalStakedFor(juror2), juror2Stake + reward, 'juror2 post-reward')

                await assertEqualBN(this.jurorsRegistry.totalStakedFor(juror3), juror3Stake, 'juror3 pre-reward')
                assertLogs(await this.court.settleReward(disputeId, firstRoundId, juror3))
                await assertEqualBN(this.jurorsRegistry.totalStakedFor(juror3), juror3Stake + reward, 'juror3 post-reward')
              })
            })

            context('on appeal', () => {
              const appealMakerRuling = losingRuling
              const appealTakerRuling = winningRuling
              let makerInitialBalance
              let feeAmount, appealDeposit, appealConfirmDeposit

              beforeEach(async () => {
                await passTerms(1) // term = 5
                makerInitialBalance = await this.feeToken.balanceOf(appealMaker)
                //[ ,,, feeAmount, , appealDeposit, appealConfirmDeposit ] = await this.court.getNextAppealDetails(disputeId, firstRoundId)
                const [ ,,, ...details ] = await this.court.getNextAppealDetails(disputeId, firstRoundId);
                [ feeAmount, , appealDeposit, appealConfirmDeposit ] = details
                assertLogs(await this.court.appeal(disputeId, firstRoundId, appealMakerRuling, { from: appealMaker }), RULING_APPEALED_EVENT)
              })

              it('maker spends correct amount of collateral', async () => {
                const makerFinalBalance = await this.feeToken.balanceOf(appealMaker)
                assert.equal(makerFinalBalance.toNumber(), makerInitialBalance.minus(appealDeposit).toNumber(), "maker final balance doesn't match")
              })

              it('fails to draft without appeal confirmation', async () => {
                await passTerms(1) // term = 6
                // advance two blocks to ensure we can compute term randomness
                await this.courtHelper.advanceBlocks(2)

                await assertRevert(this.court.draftAdjudicationRound(disputeId), ERROR_ROUND_ALREADY_DRAFTED)
              })

              it('maker gets collateral back without appeal confirmation', async () => {
                await passTerms(appealTerms + appealConfirmTerms)
                await this.court.settleRoundSlashing(disputeId, firstRoundId, 10)
                await this.court.settleAppealDeposit(disputeId, firstRoundId)
                await this.accounting.withdraw(this.feeToken.address, appealMaker, (await this.accounting.balanceOf(this.feeToken.address, appealMaker)), { from: appealMaker })
                const makerFinalBalance = await this.feeToken.balanceOf(appealMaker)
                assert.equal(makerFinalBalance.toNumber(), makerInitialBalance.toNumber(), "maker final balance doesn't match")
              })

              context('on appeal confirmation', () => {
                let takerInitialBalance
                let roundId

                const draftJurors = async () => {
                  await passTerms(appealConfirmTerms)
                  // advance two blocks to ensure we can compute term randomness
                  await this.courtHelper.advanceBlocks(2)

                  const receipt = await this.court.draftAdjudicationRound(disputeId)
                  assertDeepLogs(receipt, this.jurorsRegistry.abi, JUROR_DRAFTED_EVENT)
                  assertLogs(receipt, DISPUTE_STATE_CHANGED_EVENT)
                }

                const voteAndSettle = async (vote) => {
                  voteId = getVoteId(disputeId, roundId)
                  // commit
                  await Promise.all(jurors.map(
                    juror => this.voting.commit(voteId, encryptVote(vote), { from: juror })
                  ))
                  await passTerms(commitTerms)

                  // reveal
                  await Promise.all(jurors.map(
                    juror => this.voting.reveal(voteId, vote, SALT, { from: juror })
                  ))
                  await passTerms(revealTerms)

                  // settle
                  await passTerms(appealTerms + appealConfirmTerms)
                  await this.court.settleRoundSlashing(disputeId, firstRoundId, 10)
                  await this.court.settleAppealDeposit(disputeId, firstRoundId)

                  // withdraw
                  const appealMakerBalance = (await this.accounting.balanceOf(this.feeToken.address, appealMaker)).toNumber()
                  if (appealMakerBalance > 0) {
                    await this.accounting.withdraw(this.feeToken.address, appealMaker, appealMakerBalance, { from: appealMaker })
                  }
                  const appealTakerBalance = (await this.accounting.balanceOf(this.feeToken.address, appealTaker)).toNumber()
                  if (appealTakerBalance > 0) {
                    await this.accounting.withdraw(this.feeToken.address, appealTaker, appealTakerBalance, { from: appealTaker })
                  }
                }

                beforeEach(async () => {
                  takerInitialBalance = await this.feeToken.balanceOf(appealTaker)
                  await passTerms(appealTerms)
                  const receipt = await this.court.appealConfirm(disputeId, firstRoundId, appealTakerRuling, { from: appealTaker })
                  assertLogs(receipt, RULING_APPEAL_CONFIRMED_EVENT)
                  roundId = getLog(receipt, RULING_APPEAL_CONFIRMED_EVENT, 'roundId')
                })

                it('taker spends correct amount of collateral', async () => {
                  const takerFinalBalance = await this.feeToken.balanceOf(appealTaker)
                  assert.equal(takerFinalBalance.toNumber(), takerInitialBalance.minus(appealConfirmDeposit).toNumber(), "taker final balance doesn't match")
                })

                it('drafts jurors', async () => {
                  await draftJurors()
                })

                it('maker wins', async () => {
                  await draftJurors()

                  await voteAndSettle(appealMakerRuling)

                  const makerFinalBalance = await this.feeToken.balanceOf(appealMaker)
                  assert.equal(makerFinalBalance.toNumber(), makerInitialBalance.plus(appealConfirmDeposit).minus(feeAmount).toNumber(), "maker final balance doesn't match")
                  const takerFinalBalance = await this.feeToken.balanceOf(appealTaker)
                  assert.equal(takerFinalBalance.toNumber(), takerInitialBalance.minus(appealConfirmDeposit).toNumber(), "taker final balance doesn't match")
                })

                it('taker wins', async () => {
                  await draftJurors()

                  await voteAndSettle(appealTakerRuling)

                  const makerFinalBalance = await this.feeToken.balanceOf(appealMaker)
                  assert.equal(makerFinalBalance.toNumber(), makerInitialBalance.minus(appealDeposit).toNumber(), "maker final balance doesn't match")
                  const takerFinalBalance = await this.feeToken.balanceOf(appealTaker)
                  assert.equal(takerFinalBalance.toNumber(), takerInitialBalance.plus(appealDeposit).minus(feeAmount).toNumber(), "taker final balance doesn't match")
                })

                it('refused ruling', async () => {
                  await draftJurors()

                  await voteAndSettle(REFUSED_RULING)

                  const makerFinalBalance = await this.feeToken.balanceOf(appealMaker)
                  assert.equal(makerFinalBalance.toNumber(), makerInitialBalance.toNumber() - feeAmount.toNumber() / 2, "maker final balance doesn't match")
                  const takerFinalBalance = await this.feeToken.balanceOf(appealTaker)
                  assert.equal(takerFinalBalance.toNumber(), takerInitialBalance.toNumber() - feeAmount.toNumber() / 2, "taker final balance doesn't match")
                })
              })
            })
          })
        })
      })
    })
  })
})
