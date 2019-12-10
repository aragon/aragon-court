const ARBITRABLE_EVENTS = {
  RULED: 'Ruled'
}

const DISPUTE_MANAGER_EVENTS = {
  DISPUTE_STATE_CHANGED: 'DisputeStateChanged',
  NEW_DISPUTE: 'NewDispute',
  JUROR_DRAFTED: 'JurorDrafted',
  EVIDENCE_PERIOD_CLOSED: 'EvidencePeriodClosed',
  RULING_APPEALED: 'RulingAppealed',
  RULING_APPEAL_CONFIRMED: 'RulingAppealConfirmed',
  RULING_COMPUTED: 'RulingComputed',
  PENALTIES_SETTLED: 'PenaltiesSettled',
  REWARD_SETTLED: 'RewardSettled',
  APPEAL_DEPOSIT_SETTLED: 'AppealDepositSettled',
  MAX_JURORS_PER_DRAFT_BATCH_CHANGED: 'MaxJurorsPerDraftBatchChanged'
}

const VOTING_EVENTS = {
  VOTING_CREATED: 'VotingCreated',
  VOTE_COMMITTED: 'VoteCommitted',
  VOTE_REVEALED: 'VoteRevealed',
  VOTE_LEAKED: 'VoteLeaked'
}

const REGISTRY_EVENTS = {
  STAKED: 'Staked',
  UNSTAKED: 'Unstaked',
  SLASHED: 'Slashed',
  COLLECTED: 'Collected',
  JUROR_ACTIVATED: 'JurorActivated',
  JUROR_DEACTIVATION_REQUESTED: 'JurorDeactivationRequested',
  JUROR_DEACTIVATION_PROCESSED: 'JurorDeactivationProcessed',
  JUROR_DEACTIVATION_UPDATED: 'JurorDeactivationUpdated',
  JUROR_BALANCE_LOCKED: 'JurorBalanceLocked',
  JUROR_BALANCE_UNLOCKED: 'JurorBalanceUnlocked',
  JUROR_SLASHED: 'JurorSlashed',
  JUROR_TOKENS_BURNED: 'JurorTokensBurned',
  JUROR_TOKENS_ASSIGNED: 'JurorTokensAssigned',
  JUROR_TOKENS_COLLECTED: 'JurorTokensCollected',
  TOTAL_ACTIVE_BALANCE_LIMIT_CHANGED: 'TotalActiveBalanceLimitChanged'
}

const TREASURY_EVENTS = {
  ASSIGN: 'Assign',
  WITHDRAW: 'Withdraw'
}

const SUBSCRIPTIONS_EVENTS = {
  FEES_PAID: 'FeesPaid',
  FEES_DONATED: 'FeesDonated',
  FEES_CLAIMED: 'FeesClaimed',
  GOVERNOR_FEES_TRANSFERRED: 'GovernorFeesTransferred',
  FEE_TOKEN_CHANGED: 'FeeTokenChanged',
  FEE_AMOUNT_CHANGED: 'FeeAmountChanged',
  PRE_PAYMENT_PERIODS_CHANGED: 'PrePaymentPeriodsChanged',
  GOVERNOR_SHARE_PCT_CHANGED: 'GovernorSharePctChanged',
  LATE_PAYMENT_PENALTY_CHANGED: 'LatePaymentPenaltyPctChanged',
  RESUME_PENALTIES_CHANGED: 'ResumePenaltiesChanged'
}

const CONTROLLER_EVENTS = {
  MODULE_SET: 'ModuleSet',
  FUNDS_GOVERNOR_CHANGED: 'FundsGovernorChanged',
  CONFIG_GOVERNOR_CHANGED: 'ConfigGovernorChanged',
  MODULES_GOVERNOR_CHANGED: 'ModulesGovernorChanged'
}

const CONTROLLED_EVENTS = {
  RECOVER_FUNDS: 'RecoverFunds'
}

const CONFIG_EVENTS = {
  CONFIG_CHANGED: 'NewConfig',
  AUTOMATIC_WITHDRAWALS_ALLOWED_CHANGED: 'AutomaticWithdrawalsAllowedChanged'
}

const CLOCK_EVENTS = {
  HEARTBEAT: 'Heartbeat',
  START_TIME_DELAYED: 'StartTimeDelayed'
}

module.exports = {
  DISPUTE_MANAGER_EVENTS,
  VOTING_EVENTS,
  REGISTRY_EVENTS,
  TREASURY_EVENTS,
  SUBSCRIPTIONS_EVENTS,
  CONTROLLER_EVENTS,
  CONTROLLED_EVENTS,
  CONFIG_EVENTS,
  CLOCK_EVENTS,
  ARBITRABLE_EVENTS
}
