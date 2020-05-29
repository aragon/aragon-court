# 1. Mechanism

### 1.1. Description

The Aragon Court is a dispute resolution protocol designed to handle subjective disputes which cannot be arbitrated by smart contracts. At a high level, this is achieved by drafting a random set of jurors for each dispute over which a ruling is voted over. Aragon Court is one of the core components of the [Aragon Network](https://aragon.org/network/).

A separate ANJ token will be created for the canonical Aragon Court, and Ethereum accounts (including contracts) will sign up to be jurors by staking this ANJ token to the Court. The more tokens a juror has staked and activated, the higher their chance of being drafted. ANJ will be directly convertable to ANT via a bonding curve, through a [Aragon Fundraising](https://blog.aragon.org/introducing-aragon-fundraising/) organization deployed alongside the Court.

Based on the concept of a [Schelling point](https://en.wikipedia.org/wiki/Focal_point_(game_theory)), jurors are asked to vote on the ruling they think their fellow jurors are most likely to vote on. Every time a juror is drafted for a dispute, a portion of their staked (TODO: should this be activated?) tokens are locked until the dispute is finalized. To incentivize consensus, jurors that don’t vote in favor of the consensus ruling have their locked tokens slashed. Jurors that vote in favor of the consensus ruling are rewarded with ruling fees and a portion of the tokens slashed from the minority-voting jurors.

Once a ruling has been decided for a dispute, there is a time period where anyone is allowed to appeal said ruling by putting some collateral at stake to initiate a new dispute round. If this occurs, a new set of jurors will be drafted and a new ruling will be voted on. Rulings can be appealed multiple times until the final round is reached. To mitigate 51% attacks, all active juror accounts can opt into voting during the final round. For future versions of the Court, we are considering using [futarchy decision markets](https://blog.aragon.one/futarchy-courts/) for the final dispute round instead.

The Court uses an inherent time unit, called a "term," to determine how long certain actions or phases last. The length of a "term" is guaranteed to be constant, although each phase in a dispute can have its length configured by setting how many "terms" the phase will last for. Terms are advanced via "heartbeat" transactions and most functionality will only execute if the Court has been updated to its latest term.

Even though the Aragon Court could theoretically resolve any type of binary dispute, we intend for its first version to be primarily used for arbitrating [Proposal Agreements](https://blog.aragon.one/proposal-agreements-and-the-aragon-court/). These agreements require entities to first agree upon a set of rules and processes for creating proposals in an organization, each forcing proposal creators to stake collateral that may be forfeit if the proposal is deemed invalid by the Court. However, how disputes arrive at the Aragon Court is outside of the scope of this protocol. The Court relies on a small external interface to link corresponding disputes and execute them once a ruling has been decided.

### 1.2. High-level flow

- Jurors deposit ANT into a bonding curve to generate ANJ tokens.
- Jurors stake ANJ to the Court contract and schedule their activation and deactivation for the time period in which they can be drafted to rule on disputes.
- Court fees and configuration parameters are controlled by a governor (eventually the Aragon Network), but can only be modified for future terms to ensure that parameters can’t change for ongoing disputes.
- The creator of a dispute must pay fees to cover the maintenance gas costs of the Court and the jurors that will adjudicate their dispute. The governor of the Court receives a share of all fees paid to the Court.
- Jurors are randomly drafted to adjudicate disputes, where the chance to be drafted is proportional to the amount of ANJ they have activated.
- When drafted, each juror must commit and reveal their vote for the ruling. Failure to commit or reveal results in a penalty for the juror.
- After a ruling is decided, it can be appealed by anyone a certain number of times, after which all active jurors will vote on the last appeal (an unappealable ruling).
- When the final ruling is decided, all the adjudication rounds for the dispute can be settled, taking into account the final ruling for rewards and penalties.
