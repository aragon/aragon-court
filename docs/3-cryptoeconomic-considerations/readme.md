# 3. Crypto-economic considerations

The present implementation is the first iteration of a crypto-economic protocol designed for reaching consensus over subjective issues which can cause side effects in a purely objective deterministic system, such as a public blockchain.

By definition, it is impossible for Aragon Court's rulings to be perceived as correct by every observer, as their own personal biases and values can make them interpret a subjective issue in a different way than the majority of jurors.

It's important that all system participants understand these three concepts and take these into account when interacting with the protocol:

## Aragon Court as a Schelling game

Opposed to judges in the legacy legal systems of land jurisdictions, Aragon Court jurors are not asked for their impartial opinion on a dispute, but to vote on the ruling they think their fellow jurors will  also vote for. Those who vote with the majority are rewarded with tokens that are slashed with jurors that vote for a losing ruling.

If the protocol asked for everyone's unbiased opinion, it would be unfair to penalize those in the minority, as they could have done a perfectly fine job and just not agree with the rest. But if you don't slash those in the minority, attacks would be free and therefore the system wouldn't be secure.

Aragon Court is therefore a Schelling game. An easy example of a Schelling game would be if two people are in New York City and they have to meet on a certain day but have no way to coordinate, both would probably pick a recognizable place such as Times Square and go there at noon, as it is the most plausible rational decision making process the other person could do as well.

## Aragon Court as a 'proof of stake' system

When designing a permissionless protocol, that is one in which any participants can come and go without asking anyone's authorization, one has to assume that any given entity can have multiple identities at the same time.

Aragon Court was designed with this in mind and assumes participants can [sybil 'attack](https://www.google.com/url?sa=t&rct=j&q=&esrc=s&source=web&cd=3&cad=rja&uact=8&ved=2ahUKEwiV_uj82vvlAhWPMewKHdrEAYMQFjACegQIDxAG&url=https%3A%2F%2Fwww.geeksforgeeks.org%2Fsybil-attack%2F&usg=AOvVaw2aSXD_OryloK6K0X7YcgYj)' the system without it being an issue for the integrity of the protocol. The amount of active tokens of Aragon Court's native token (ANJ for Aragon Network's deployment) act as the weight for someone's impact. If someone has 50 ANJ, it should be equally or more preferable to have all the tokens active under in one identity, than say 10 ANJ across five different identities.

As in most subjective systems in which consensus decisions are weighted by stake, the integrity of the system can be attacked by a cartel with influence over the decisions of more than 50% of the active stake.

From this we can infer that the security of Aragon Court is a function of the market capitalization of its native token. A naïve calculation would be to assume that one can attack the integrity of the Court by spending 51% of the token's market cap to acquire a majority position. In reality this wouldn't be the case, as acquiring 51% of the tokens of a network will almost always be more expensive than 51% of the initial market cap, specially if there's low liquidity and a fair amount of the supply is already staked and active by honest participants.

Even with this in mind, Aragon Court has a mechanism to protect an honest minority of jurors from a hostile takeover in the form of a 51% attack: after a certain number of appeal rounds (in which the number of jurors increases geometrically, and therefore the amount of token at stake), there's a final appeal round that will decide the final ruling for the dispute. In the final appeal round, all active jurors are invited to rule, and the final ruling is decided by a majority commit and reveal vote in which participating jurors put all their tokens at stake.

After the final appeal round votes are tallied, a final ruling is issued and every juror who participated in the dispute and didn't support the winning ruling is slashed. In the case of a successful 51% attack, the attackers will be rewarded with some tokens from honest jurors. Aragon Court will then block withdrawals for every juror that voted for the winning ruling in the final appeal round. The rationale behind this is that even if Aragon Court was successfully attacked, malicious jurors will be locked in for a period of time, allowing honest jurors to exit the system and sell their juror tokens before the attackers are allowed to withdraw. Therefore, the attack is disincentivized with the threat of losing almost all of the value spent purchasing the tokens.

In conclusion, the security of Aragon Court is a function of its market cap, although acquiring a majority stake requires an investment more expensive than half of the initial market cap. By locking withdrawals for winning jurors in final appeal rounds, attackers should expect to lose most of the value spent in acquiring their token position, therefore requiring them to pay an exorbitant amount of money to influence the outcome of just one dispute. 

## Aragon Court as an efficient consensus reaching mechanism

Aragon Court tries to reach consensus over a ruling involving the minimum number of participating jurors. The optimal number of participants involved needs to tend to zero, that is, everyone's trust in Aragon Court is so high, that misbehaving is disincentivized by the very threat of the Court's existence.

When a dispute is created in Aragon Court, a sortition process is performed to select the jurors that will adjudicate the dispute. A small random set of jurors is drafted from the active juror pool (weighted by active stake for sybil resistance) and asked to rule on the dispute. This initial number of jurors can be as small as 3 jurors (or even just 1) and they are expected to provide the ruling that a majority vote among all active jurors would have produced.

The advantage of this is reducing the number of participants that need to review the case and evidence, resulting a more efficient and cheaper system. Because only a small number of participants is involved, any observer can appeal a decision and make a profit if the ruling ends up being flipped. Every appeal geometrically increases the number of jurors drafted to adjudicate the next round, and after a certain number of appeals, there's a final majority vote in which all active jurors can vote to produce the final ruling.

If jurors were only rewarded when drafted to work, by doing their job really well and maintaining a super honest court, they would be decreasing their future returns, as the incentive to create disputes in a highly effective court is low, as both parties to the dispute can predict what the outcome will be. If jurors leave the Court because the returns are decreasing as a result of a well functioning Court, the market cap of the token will decrease, making attacks cheaper.

For this reason, Aragon Court charges subscription fees to its users for the right to use the Court should a dispute arise. These subscription fees are then distributed to all active jurors during that period proportional to their relative stake. Even if no disputes are created in a period of time, jurors should expect a predictable income coming from passive users of the Court who are getting security from it even if they don't have the need create disputes.

## A glimpse into Aragon Court v2 potential improvements

Even though we consider the system production ready, this is just the first iteration of the protocol in which we have optimized for simplicity of the mechanism. We plan on working on a future version of the protocol taking into account user feedback and tackling some aspects to make the protocol even more robust and making some attacks even more expensive.

At the moment, a ruling can be appealed all the way up to a majority vote happens in the final appeal round. As explained above, this is vulnerable to 51% attacks, even if made really expensive and discouraged by locking winning jurors for a period of time. We did some research on better finality mechanisms and we settled on using futarchy for making the final decision after all appeal rounds occur. By using futarchy, a prediction market can be asked which ruling will make the Court be more valuable at some point in the future. This mechanism is not possible to 51% attack, and attackers can expect to lose all their money if honest participants take on the other side of the market to make a profit. You can read a more in-depth description in Luke Duncan's ['Futarchy Courts' post](https://blog.aragon.one/futarchy-courts/).

The drafting mechanism currently uses the hash of a future Ethereum block as its randomness seed. Even though the hash of a future block is impossible to predict, the potential miner for a block that will impact a dispute's randomness can decide to drop the block (by not broadcasting it to the network) if its hash is not favorable to them. The miner has the ability to have another drafting chance  at the expense of the lost block reward. Given the possibility to use the appeals process all the way up to the entire active juror set, this vulnerability was considered low risk and decided on using block hash randomness for its simplicity. For a future versions of Aragon Court we are exploring using more robust randomness such as a RANDAO mechanism or Keep's Random Beacon.