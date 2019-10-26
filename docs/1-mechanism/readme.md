# 1. Mechanism

### 1.1. Description

The Aragon Court is a dispute resolution protocol that handles subjective disputes that cannot be solved by smart contracts. Aragon Court is one of the core components of the [Aragon Network](https://aragon.org/network/). This is achieved by having a set of jurors drafted for each dispute that will vote to guarantee a certain ruling. 

Jurors can sign up by staking tokens to the Court, the more tokens a juror has activated, the higher the chance to get drafted. Jurors will deposit ANT into a bonding curve to mint ANJ tokens, likely using [Aragon Fundraising](https://blog.aragon.org/introducing-aragon-fundraising/).

Jurors are asked to vote on the ruling that they think their fellow jurors are more likely to vote on. Every time a juror is drafted for a dispute, a portion of their staked tokens are locked until the dispute is finalized. To incentivize consensus, jurors that don’t vote in favor of the consensus ruling have their locked tokens slashed. Jurors that vote in favor of the consensus ruling are rewarded with ruling fees and juror tokens from the jurors that voted for a minority ruling.

Once a ruling has been decided for a dispute, there is a time period where anyone is allowed to appeal said ruling while putting some collateral at stake to initiate a new dispute round. If this occurs, a new set of jurors will be drafted and a new ruling will be proposed. Rulings can be appealed multiple times until the final round is reached. All jurors are allowed to opt-in vote during a final round. For further versions of the Court protocol, the idea of using [futarchy decision markets](https://blog.aragon.one/futarchy-courts/) to solve a final dispute round is being considered instead.

The different phases of a dispute are determined by a time period measured in Court terms, a time unit. Although these phases duration may change in the future, the duration of each Court term is guaranteed to remain constant.

Even though the Aragon Court could theoretically resolve any type of binary dispute, in its first version it will be used to arbitrate [Proposal Agreements](https://blog.aragon.one/proposal-agreements-and-the-aragon-court/). These agreements require entities creating a proposal in an organization to agree to its specific rules around proposal creation, putting some collateral at stake that could be lost if the Court finds the proposal invalid. However, how disputes arrive at the Aragon Court is outside of the scope of this protocol. The Court simply relies on a small interface to be able to link the corresponding disputes and trigger them once a ruling has been decided.

### 1.2. High-level flow

- Jurors deposit ANT into a bonding curve to generate ANJ tokens.
- Jurors stake ANJ to the Court contract and schedule their activation and deactivation for the time period in which they can be drafted to rule on disputes.
- Court fees and configuration parameters are controlled by a governor (the Aragon Network), but can only be modified for future terms to ensure that the rules can’t change for ongoing disputes as much as possible.
- The creator of a dispute must pay fees to cover the maintenance gas costs of the Court and the jurors that will adjudicate their dispute. The governor of the Court gets a share of all the fees paid out in the Court.
- Jurors are randomly drafted to adjudicate disputes, where the chance to be drafted is proportional to the amount of ANJ they have activated.
- When drafted, jurors must commit and reveal to a ruling. Failure to vote or reveal results in a penalty for the jurors.
- After a ruling is decided, it can be appealed by anyone a certain number of times, after which all active jurors will vote on the last appeal, providing an unappealable ruling.
- When the final ruling is decided, all the adjudication rounds for the dispute can be settled taking into account the final ruling for rewards and penalties.
