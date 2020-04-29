![Aragon Court](./docs/aragon-court.png)

<img align="right" src="https://img.shields.io/travis/aragon/aragon-court/master.svg?style=for-the-badge">
  <a href="https://travis-ci.com/aragon/aragon-court/"/>
</img>

## Project

#### 👩‍️ [Become an Aragon Court juror](https://anj.aragon.org)
Aragon Court is now live on Ethereum mainnet. You can become a juror by staking 10,000 ANJ.

#### ⚖ [Check out the Aragon Court Dashboard](https://court.aragon.org)
The Aragon Court Dashboard is the central app where all dispute-related tools are available for jurors.

#### 📚 [Read the User Guide](https://help.aragon.org/category/47-aragoncourt) 
Read the user guide if you have any doubts about the protocol or the Aragon Court related tools

## Protocol

#### 📓 [Read the full documentation](/docs)
Aragon Court is a dispute resolution protocol that runs on Ethereum. It's one of the core components of the [Aragon Network](https://aragon.org/network/).

#### 🚧 Project stage: v1 implementation
After a long research and development phase, Aragon Court's v1 implementation has been [released](https://www.npmjs.com/package/@aragon/court) and [deployed](https://etherscan.io/address/0xee4650cBe7a2B23701D416f58b41D8B76b617797#code).

#### ✅ Security review status: audited
Aragon Court v1 has already been audited by an independent security professional. You can read the audit report [here](https://github.com/gakonst/publications/blob/master/aragon_court_audit.pdf). 

#### 👋 Get started contributing with a [good first issue](https://github.com/aragon/aragon-court/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)
Don't be shy to contribute even the smallest tweak. Everyone will be especially nice and helpful to beginners to help you get started!

## How does it work

**Full description of the mechanism: [Mechanism documentation](/docs/1-mechanism)**

Aragon Court handles subjective disputes that cannot be solved by smart contracts. For this, it employs jurors that need to stake a token to the Court which allows them to get drafted to adjudicate disputes, that can earn them fees. The more tokens a juror has activated, the higher the chance to get drafted and earn more fees.

Aragon Court attempts to find what the subjective truth is with a [Schelling game](https://en.wikipedia.org/wiki/Focal_point_(game_theory)). Jurors are asked to vote on the ruling that they think their fellow jurors are more likely to vote on. To incentivize consensus, jurors that don't vote on the consensus ruling have some tokens slashed. Jurors that vote with the consensus ruling are rewarded with ruling fees and juror tokens from the jurors that voted for a minority ruling.

A design goal of the mechanism is to require very few jurors to adjudicate a dispute and produce a ruling. A small number of jurors is adjudicated by default to a dispute, and their ruling can be appealed in multiple rounds of appeals.

Even though Aragon Court could theoretically resolve any type of binary dispute, in its first deployments it will be used to arbitrate **Proposal Agreements.** These agreements require entities creating a proposal in an organization to agree to its specific rules around proposal creation, putting some collateral at stake that could be lost if the Court finds the proposal invalid.

## Deployed instances

#### Mainnet

The mainnet instance of Aragon Court is deployed at [`0xee4650cBe7a2B23701D416f58b41D8B76b617797`](https://etherscan.io/address/0xee4650cBe7a2B23701D416f58b41D8B76b617797#code)

#### Testing

There are a few testing instances deployed of Aragon Court, please refer to the [testing guide](/docs/8-testing-guide) to have a better understanding about how to use these.

## Help shape Aragon Court
- Discuss in [Aragon Forum](https://forum.aragon.org/tags/dispute-resolution)
- Join the [Aragon Court channel](https://discordapp.com/channels/672466989217873929/674689908824342531) on Discord.
