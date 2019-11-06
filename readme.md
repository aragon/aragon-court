# Aragon Court <img align="right" src="https://raw.githubusercontent.com/aragon/design/master/readme-logo.png" height="80px" /> [![Travis branch](https://img.shields.io/travis/aragon/aragon-court/development.svg?style=for-the-badge)](https://travis-ci.com/aragon/aragon-court/)

#### 📓 [Read the full documentation](/docs)

Aragon Court is a dispute resolution protocol that runs on Ethereum. It's one of the core components of the [Aragon Network](https://aragon.org/network/).

#### 🚧 Project stage: v1 implementation
After a long research and development phase, Aragon Court's v1 implementation has been frozen. We don't foresee major changes to the mechanism except for security reasons.

#### ⚠️ Security review status: auditing
The current implementation has been sent out for auditing to an independent security professional. We expect the first audit report to arrive mid-November 2019.

#### 👋 Get started contributing with a [good first issue](https://github.com/aragon/aragon-court/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)
Don't be shy to contribute even the smallest tweak. Everyone will be especially nice and helpful to beginners to help you get started!

## How does it work

**Full description of the mechanism: [Mechanism documentation](/docs/1-mechanism)**

Aragon Court handles subjective disputes that cannot be solved by smart contracts. For this, it employs jurors that need to stake a token to the Court which allows them to get drafted to adjudicate disputes, that can earn them fees. The more tokens a juror has activated, the higher the chance to get drafted and earn more fees.

Aragon Court attempts to find what the subjective truth is with a [Schelling game](https://en.wikipedia.org/wiki/Focal_point_(game_theory)). Jurors are asked to vote on the ruling that they think their fellow jurors are more likely to vote on. To incentivize consensus, jurors that don't vote on the consensus ruling have some tokens slashed. Jurors that vote with the consensus ruling are rewarded with ruling fees and juror tokens from the jurors that voted for a minority ruling.

A design goal of the mechanism is to require very few jurors to adjudicate a dispute and produce a ruling. A small number of jurors is adjudicated by default to a dispute, and their ruling can be appealed in multiple rounds of appeals.

Even though Aragon Court could theoretically resolve any type of binary dispute, in its first deployments it will be used to arbitrate **Proposal Agreements.** These agreements require entities creating a proposal in an organization to agree to its specific rules around proposal creation, putting some collateral at stake that could be lost if the Court finds the proposal invalid.

This first version of Aragon Court was inspired by [Kleros protocol](https://github.com/kleros/kleros), although major changes to the mechanism were made to increase some important security aspects.


## Help shape Aragon Court
- Discuss in [Aragon Forum](https://forum.aragon.org/tags/dispute-resolution)
- Join the [#research channel](https://aragon.chat/channel/research) in [Aragon Chat](https://aragon.chat)
