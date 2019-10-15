const { bn, assertBn } = require('../helpers/numbers')

// utils
const buildOriginalFundsState = (users, jurors, jurorToken, feeTokens) => {
  const zeroFeeTokens = () => feeTokens.reduce((acc, token) => {
    acc[token.address] = {
      balance: bn(0),
      inAccounting: bn(0)
    }
    return acc
  }, {})

  const fundsState = {
    feeTokens: feeTokens.map(t => t.address),
    jurorToken: jurorToken.address,
    users: users.reduce((acc, user) => {
      acc[user] = {
        feeTokens: zeroFeeTokens()
      }
      return acc
    }, {}),
    jurors: jurors.reduce((acc, juror) => {
      acc[juror] = {
        jurorToken: {
          outside: bn(0),   // not in JurorsRegistry
          available: bn(0), // in JurorsRegistry, but not active
          active: bn(0)     // in JurorsRegistry, in the tree
        },
        feeTokens: zeroFeeTokens()
      }
      return acc
    }, {}),
    registry: {
      jurorToken: {
        remaining: bn(0)    // balance in JurorsRegistry not belonging to any juror
      }
    },
    accounting: {
      feeTokens: zeroFeeTokens()
    },
  }
  return fundsState
}

// checks
const checkEmptyBalances = async (address, tokens, name, web3, ERC20) => {
  const courtEthBalance = bn(await web3.eth.getBalance(address))
  assertBn(courtEthBalance, bn(0), `${name} contract should not hold ETH`)
  await Promise.all(tokens.map(
    async (tokenAddress) => {
      const token = await ERC20.at(tokenAddress)
      const tokenBalance = await token.balanceOf(address)
      assertBn(tokenBalance, bn(0), `${name} contract should not hold any ${token.address}`)
    }
  ))
}

const computeExpectedJurorsTotalSupply = (fundsState, balance) => {
  const expectedJurorsTotalSupply = Object.values(fundsState.jurors).reduce((acc, juror) => {
    return acc.add(juror.jurorToken[balance])
  }, bn(0))

  return expectedJurorsTotalSupply
}

const checkJurorTokenBalances = async (fundsState, jurorsRegistry, ERC20) => {
  const jurorToken = await ERC20.at(fundsState.jurorToken)
  const totalSupply = await jurorToken.totalSupply()
  const jurorsRegistryBalance = await jurorToken.balanceOf(jurorsRegistry.address)
  const treeBalance = await jurorsRegistry.totalActiveBalance()
  let totalJurorBalances = bn(0)
  for (const juror in fundsState.jurors) {
    const jurorBalance = await jurorToken.balanceOf(juror)
    assertBn(jurorBalance, fundsState.jurors[juror].jurorToken.outside, `Balance for juror ${juror} and token ${fundsState.jurorToken} doesn't match`)
    totalJurorBalances = totalJurorBalances.add(jurorBalance)
  }

  // expected values computed from jurors
  const jurorsExpectedOutsideTotalSupply = computeExpectedJurorsTotalSupply(fundsState, 'outside')
  const jurorsExpectedAvailableTotalSupply = computeExpectedJurorsTotalSupply(fundsState, 'available')
  const jurorsExpectedActiveTotalSupply = computeExpectedJurorsTotalSupply(fundsState, 'active')
  const jurorsRegistryExpectedRemaining = fundsState.registry.jurorToken.remaining

  // checks
  assertBn(totalSupply, jurorsRegistryBalance.add(totalJurorBalances), `Total supply for juror token doesn't match`)
  assertBn(totalJurorBalances, jurorsExpectedOutsideTotalSupply, `Juror balances for juror token don't macth`)
  assertBn(treeBalance, jurorsExpectedActiveTotalSupply, `Juror active token balances don't macth`)
  assertBn(jurorsRegistryBalance.sub(treeBalance), jurorsExpectedAvailableTotalSupply.add(jurorsRegistryExpectedRemaining), `Juror inactive token balances don't match`)
}

// check individual balances of a fee token for a group (jurors, users)
// return total amount of feeToken hold by a group (jurors, users)
const checkFeeTokenAndComputeSum = async (group, feeToken) => {
  let totalBalances = bn(0)
  for (const actor in group) {
    const balance = await feeToken.balanceOf(actor)
    assertBn(balance, group[actor].feeTokens[feeToken.address].balance, `Balance for ${actor} and token ${feeToken.address} doesn't match`)
    totalBalances = totalBalances.add(balance)
  }
  return totalBalances
}

// total amount of expected feeToken hold by a group (jurors, users)
const computeExpectedFeeTokenSum = (group, feeTokenAddress, where) => {
  const expectedTotalSupply = Object.values(group).reduce((acc, actor) => {
    return acc.add(actor.feeTokens[feeTokenAddress][where])
  }, bn(0))

  return expectedTotalSupply
}

const checkAccountingFeeTokenAndComputeSum = async (group, accounting, feeTokenAddress) => {
  let totalBalances = bn(0)
  for (const actor in group) {
    const balance = await accounting.balanceOf(feeTokenAddress, actor)
    assertBn(balance, group[actor].feeTokens[feeTokenAddress].inAccounting, `Balance for ${actor} and token ${feeTokenAddress} in CourtAccounting doesn't match`)
    totalBalances = totalBalances.add(balance)
  }
  return totalBalances
}

const checkFeeTokenBalances = async (fundsState, accounting, feeTokenAddress, ERC20) => {
  const feeToken = await ERC20.at(feeTokenAddress)
  const totalSupply = await feeToken.totalSupply()

  const accountingBalance = await feeToken.balanceOf(accounting.address)

  // real values computed from users and jurors
  let totalUserBalances = await checkFeeTokenAndComputeSum(fundsState.users, feeToken)
  let totalUserAccountingBalances = await checkAccountingFeeTokenAndComputeSum(fundsState.users, accounting, feeTokenAddress)
  let totalJurorBalances = await checkFeeTokenAndComputeSum(fundsState.jurors, feeToken)
  let totalJurorAccountingBalances = await checkAccountingFeeTokenAndComputeSum(fundsState.jurors, accounting, feeTokenAddress)

  // expected values computed from users and jurors
  const userExpectedFeeTokenSum = computeExpectedFeeTokenSum(fundsState.users, feeTokenAddress, 'balance')
  const userExpectedAccountingFeeTokenSum = computeExpectedFeeTokenSum(fundsState.users, feeTokenAddress, 'inAccounting')
  const jurorExpectedFeeTokenSum = computeExpectedFeeTokenSum(fundsState.jurors, feeTokenAddress, 'balance')
  const jurorExpectedAccountingFeeTokenSum = computeExpectedFeeTokenSum(fundsState.jurors, feeTokenAddress, 'inAccounting')

  // checks
  // total supply
  assertBn(
    totalSupply,
    accountingBalance.add(totalUserBalances).add(totalJurorBalances),
    `Total supply for token ${feeTokenAddress} doesn't match`
  )
  assert.isTrue(
    totalSupply.gte(totalUserAccountingBalances.add(totalJurorAccountingBalances)),
    `Total supply in accounting for token ${feeTokenAddress} should be greater or equal than the sum of individual local balances`
  )

  // users
  assertBn(totalUserBalances, userExpectedFeeTokenSum, `User balances for token ${feeTokenAddress} don't macth`)
  assertBn(totalUserAccountingBalances, userExpectedAccountingFeeTokenSum, `User balances for token ${feeTokenAddress} don't macth`)

  // jurors
  assertBn(totalJurorBalances, jurorExpectedFeeTokenSum, `Juror balances for token ${feeTokenAddress} don't macth`)
  assertBn(totalJurorAccountingBalances, jurorExpectedAccountingFeeTokenSum, `Juror balances for token ${feeTokenAddress} don't macth`)
}

const checkAllFeeTokensBalances = async (fundsState, accounting, ERC20) => {
  await Promise.all(fundsState.feeTokens.map(token => checkFeeTokenBalances(fundsState, accounting, token, ERC20)))
}

// funds state actions
// All these function update the testing funds state object according to the corresponding action. They take up to 3 params:
// 1 - Original funds state object
// 2 - Params corresponding to the action needed to perform the computation, known in advance
// 3 - Optiona extra params coming from the real action output. Needed when randomnes is involved.
//     For instance, when drafting, we need to know which jurors were drafted. As it's not the task of accounting tests
//     to check that those jurors were the correct ones, we trust the contract on this,
//     and avoid having to perform that computiation here (these is already done in registry unit tests)
const activate = (originalFundsState, jurors) => {
  const newFundsState = Object.assign({}, originalFundsState)

  jurors.map(juror => {
    newFundsState.jurors[juror.address].jurorToken.active =
      newFundsState.jurors[juror.address].jurorToken.active.add(juror.initialActiveBalance)
  })

  return newFundsState
}

const dispute = (originalFundsState, disputeFeesInfo) => {
  const newFundsState = Object.assign({}, originalFundsState)

  const { feeToken, totalFees } = disputeFeesInfo

  newFundsState.accounting.feeTokens[feeToken].balance =
    newFundsState.accounting.feeTokens[feeToken].balance.add(totalFees)

  return newFundsState
}

const heartbeat = (originalFundsState, params) => {
  const newFundsState = Object.assign({}, originalFundsState)

  const { sender, terms } = params
  terms.map(term => {
    const { feeToken, heartbeatFee, dependingDrafts } = term
    newFundsState.users[sender].feeTokens[feeToken].inAccounting =
      newFundsState.users[sender].feeTokens[feeToken].inAccounting.add(heartbeatFee.mul(dependingDrafts))
  })

  return newFundsState
}

const draft = (originalFundsState, params, draftedJurors) => {
  const newFundsState = Object.assign({}, originalFundsState)

  const jurorsNumber = Object.values(draftedJurors).reduce((acc, juror) => {
    return acc.add(juror.weight)
  }, bn(0))

  const { sender, feeToken, draftFee } = params
  newFundsState.users[sender].feeTokens[feeToken].inAccounting =
    newFundsState.users[sender].feeTokens[feeToken].inAccounting.add(draftFee.mul(jurorsNumber))

  return newFundsState
}

const appeal = (originalFundsState, params) => {
  const newFundsState = Object.assign({}, originalFundsState)

  const { sender, feeToken, appealDeposit } = params
  // Accounting contract
  newFundsState.accounting.feeTokens[feeToken].balance =
    newFundsState.accounting.feeTokens[feeToken].balance.add(appealDeposit)
  // Appeal maker doesn't need to be updated because tokens are newly minted in courtHelper

  return newFundsState
}

const confirmAppeal = (originalFundsState, params) => {
  const newFundsState = Object.assign({}, originalFundsState)

  const { sender, feeToken, confirmAppealDeposit } = params
  // Accounting contract
  newFundsState.accounting.feeTokens[feeToken].balance =
    newFundsState.accounting.feeTokens[feeToken].balance.add(confirmAppealDeposit)
  // Appeal taker doesn't need to be updated because tokens are newly minted in courtHelper}

  return newFundsState
}

const settleRegularRoundPenalties = (originalFundsState, params) => {
  const newFundsState = Object.assign({}, originalFundsState)

  const { sender, feeToken, settleFee, jurorsToSettle, penalty } = params
  // sender fees
  newFundsState.users[sender].feeTokens[feeToken].inAccounting =
    newFundsState.users[sender].feeTokens[feeToken].inAccounting.add(settleFee.mul(bn(jurorsToSettle.length)))
  // jurors
  // even jurors (odd index, as it starts wit zero) are losing
  for (let i = 1; i < jurorsToSettle.length; i += 2) {
    const weightedPenalty = penalty.mul(jurorsToSettle[i].weight)
    newFundsState.jurors[jurorsToSettle[i].address].jurorToken.active =
      newFundsState.jurors[jurorsToSettle[i].address].jurorToken.active.sub(weightedPenalty)
    // add to jurors registry remaining balance
    newFundsState.registry.jurorToken.remaining =
      newFundsState.registry.jurorToken.remaining.add(weightedPenalty)
  }

  return newFundsState
}

const settleReward = (originalFundsState, params) => {
  const newFundsState = Object.assign({}, originalFundsState)

  const { feeToken, jurorFees, collectedTokens, juror, coherentJurors } = params

  const weightedReward = collectedTokens.mul(juror.weight).div(coherentJurors)
  // juror Tokens
  newFundsState.jurors[juror.address].jurorToken.available =
    newFundsState.jurors[juror.address].jurorToken.available.add(weightedReward)
  // subtract jurors registry remaining balance
  newFundsState.registry.jurorToken.remaining =
    newFundsState.registry.jurorToken.remaining.sub(weightedReward)

  // fee Tokens
  const weightedFees = jurorFees.mul(juror.weight).div(coherentJurors)
  newFundsState.jurors[juror.address].feeTokens[feeToken].inAccounting =
    newFundsState.jurors[juror.address].feeTokens[feeToken].inAccounting.add(weightedFees)


  return newFundsState
}

const settleAppealDeposit = (originalFundsState, params) => {
  const newFundsState = Object.assign({}, originalFundsState)

  const { feeToken, totalFees, appealDeposit, confirmAppealDeposit, winner } = params

  // fee Tokens
  const reward = appealDeposit.add(confirmAppealDeposit).sub(totalFees)
  newFundsState.users[winner].feeTokens[feeToken].inAccounting =
    newFundsState.users[winner].feeTokens[feeToken].inAccounting.add(reward)

  return newFundsState
}

module.exports = {
  // utils
  buildOriginalFundsState,
  // checks
  checkEmptyBalances,
  checkJurorTokenBalances,
  checkAllFeeTokensBalances,
  // funds state actions
  fundsActions: {
    activate,
    dispute,
    heartbeat,
    draft,
    appeal,
    confirmAppeal,
    settleRegularRoundPenalties,
    settleReward,
    settleAppealDeposit,
  },
}
