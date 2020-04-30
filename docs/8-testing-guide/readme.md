# 8. Testing guide

This guide aims to cover all the things you should know in order to try Aragon Court or integrate your application with it. 

## 8.1. Testing instances

There are a few testing instances already deployed for Aragon Court. 
All of these are mimicking the mainnet instance with some exceptions of term durations to provide a better testing experience.
Additionally, all the instances are using their own deployed version of the following ERC20 tokens:
- ANJ, the native token of Aragon Court. You will need some fake ANJ to stake as a juror to be selected to resolve disputes.  
- DAI, used for the Aragon Court fees. You will need some fake DAI to pay jurors and pay the Court subscription fees.

Of course, there is an ERC20 faucet deployed for all these instances that you can use to claim some fake ANJ or DAI to start testing. More information is outlined below on using these faucets.

### 8.1.1. Usability

- Network: Rinkeby
- Court term: 30 minutes
- Subscription period: 1440 court terms
- Dashboard: https://court-usability.aragon.org/
- Address: [`0x44f788370206696b20b94bc77c4f73ca264aa05e`](http://rinkeby.etherscan.io/address/0x44f788370206696b20b94bc77c4f73ca264aa05e)
- Fake ANJ: [`0xe9efff723800bb86f31db9a369e47c2bf336008e`](http://rinkeby.etherscan.io/address/0xe9efff723800bb86f31db9a369e47c2bf336008e)
- Fake DAI: [`0x55ab9b236cdc9e2cecbd41ada45d8261f8a6049b`](http://rinkeby.etherscan.io/address/0x55ab9b236cdc9e2cecbd41ada45d8261f8a6049b)
- ERC20 faucet: [`0x109dB6047d83f4dd5a8d9da3b9e9228728E3710a`](http://rinkeby.etherscan.io/address/0x109dB6047d83f4dd5a8d9da3b9e9228728E3710a)

### 8.1.2. Rinkeby

- Network: Rinkeby
- Court term: 8 hours (same as mainnet)
- Subscription period: 720 court terms
- Dashboard: https://court-rinkeby.aragon.org/
- Address: [`0xb5ffbe75fa785725eea5f931b64fc04e516c9c5d`](http://rinkeby.etherscan.io/address/0xb5ffbe75fa785725eea5f931b64fc04e516c9c5d)
- Fake ANJ: [`0x975ef6b5fde81c24c4ec605091f2e945872b6036`](http://rinkeby.etherscan.io/address/0x975ef6b5fde81c24c4ec605091f2e945872b6036)
- Fake DAI: [`0xe9a083d88eed757b1d633321ce0519f432c6284d`](http://rinkeby.etherscan.io/address/0xe9a083d88eed757b1d633321ce0519f432c6284d)
- ERC20 faucet: [`0x3b86Fd8C30445Ddcbed79CE7eB052fe935D34Fd2`](http://rinkeby.etherscan.io/address/0x3b86Fd8C30445Ddcbed79CE7eB052fe935D34Fd2)

### 8.1.3. Ropsten

- Network: Ropsten
- Court term: 8 hours (same as mainnet)
- Subscription period: 720 court terms
- Dashboard: https://court-ropsten.aragon.org/
- Address: [`0x3b26bc496aebaed5b3e0e81cde6b582cde71396e`](http://ropsten.etherscan.io/address/0x3b26bc496aebaed5b3e0e81cde6b582cde71396e)
- Fake ANJ: [`0xc863e1ccc047beff17022f4229dbe6321a6bce65`](http://ropsten.etherscan.io/address/0xc863e1ccc047beff17022f4229dbe6321a6bce65)
- Fake DAI: [`0x4e1f48db14d7e1ada090c42ffe15ff3024eec8bf`](http://ropsten.etherscan.io/address/0x4e1f48db14d7e1ada090c42ffe15ff3024eec8bf)
- ERC20 faucet: [`0x83c1ECDC6fAAb783d9e3ac2C714C0eEce3349638`](http://ropsten.etherscan.io/address/0x83c1ECDC6fAAb783d9e3ac2C714C0eEce3349638)

### 8.1.4. Local

To deploy a local instance of Aragon Court you will need to clone the deployment scripts first:
 
```bash
git clone https://github.com/aragon/aragon-network-deploy/
cd aragon-network-deploy
npm i
npm run deploy:court:rpc 
```

Once you have done that, you can deploy a local instance by running the following command:

```bash
npm run deploy:court:rpc
```

This command will output the addresses of all the deployed modules of Aragon Court including the main entry point (the `AragonCourt` contract).
Additionally, it should deploy a fake version of the ANJ and DAI tokens usable for testing purposes as explained above.

## 8.2. Claiming fake tokens from the ERC20 faucets

You can claim ANJ or DAI fake tokens from the ERC20 faucets.
You can do this directly through Etherscan, simply click in any of the faucet links shared above in section 8.1.
Once there, you just need to enable your Web3 account and call the `withdraw()` function providing the desired token address and amount:
![faucet](./faucet.png)

Bear in mind there is a quota set for these faucets; they will only allow you to withdraw up to 10,000 fake-DAI or 10,000 fake-ANJ every 7 days.

## 8.3. Installing the Aragon Court dev CLI tool

To interact with the deployed versions of Aragon Court, we built a node-based [CLI tool](https://github.com/aragonone/court-backend/tree/development/packages/cli) that you can use.
Currently, there is no published version of it. But you can clone the GitHub repo and run it locally.
To continue with the testing guide you will need to use it. First, make sure you clone it and install its dependencies as follows:
```
git clone https://github.com/aragonone/court-backend/
cd court-backend
npm i
npx lerna bootstrap
cd packages/cli
```

This CLI tool is built on top of Truffle using a custom [config file](https://www.npmjs.com/package/@aragon/truffle-config-v5) provided by Aragon.
Please review that package's documentation to understand how to set up your private keys for testing.

Let's continue with with the Aragon Court testing guide and see how we can use the CLI tool.

## 8.4. Becoming a juror

To become a juror you simply need to activate some ANJ tokens into Aragon Court.
First make sure to have claimed some fake ANJ tokens from the faucet corresponding to the Aragon Court instance you're willing to try. 
Then, you can activate tokens into Aragon Court using the `activate` command of the CLI tool as follows:

```bash
node ./bin/index.js activate --jurors [JUROR] --amount [AMOUNT] --from [FROM] --network [NETWORK] 
```

Where:
- `[JUROR]`: address of the juror you will activate the tokens for
- `[AMOUNT]`: amount of fake ANJ tokens you will activate for the specified juror
- `[FROM]`: address paying for the fake ANJ tokens; this must be the address you used to claim the tokens from the faucet
- `[NETWORK]`: name of the Aragon Court instance you are willing to use: `usability`, `rinkeby`, or `ropsten` 

In case the sender address is the juror to be activated, you can simplify to the following:
```bash
node ./bin/index.js activate -a [AMOUNT] -n [NETWORK]
```

Note that you can also use the flag `--verbose` to have more details about the transactions being sent to the network.

You can check your current stake as a juror in the dashboards linked above in section 8.1.

## 8.5. Creating a dispute

As you may know, disputes can only be submitted to Aragon Court through smart contracts that implement a specific interface to support being ruled by the court itself.
This is specified by the [`IArbitrable`](../../contracts/arbitration/IArbitrable.sol) interface.

Thus, the first thing we should do is to deploy an Arbitrable contract. You can do this from the CLI running the following command:

```bash
node ./bin/index.js arbitrable -n [NETWORK]
```

This command will output the address of your new Arbitrable contract.

The next step is to subscribe your Arbitrable instance to Aragon Court by paying the subscription fees.
For the testing instances, each subscription period costs 7,500 fake-DAI, so make sure you claim some fake DAI from the ERC20 faucet as described in section 8.2.

Once you have done that you can subscribe your Arbitrable instance running the following command:

```bash
node ./bin/index.js subscribe -a [ARBITRABLE] -n [NETWORK]
``` 

Where `[ARBITRABLE]` is the address of your Arbitrable instance.

Now, we are almost ready to create a dispute. The last step is to send some fake DAI to the Arbitrable instance so that it can pay for the court's dispute fees.
These are different from the subscription fees. The dispute fees are to pay the jurors for each dispute to be resolved.
For the testing instances, each dispute costs 30.87 fake-DAI.
Thus, you will need to make a transfer from your account to your Arbitrable instance.
To do that you can use the Etherscan interface for the DAI instance linked in section 8.1.

Finally, we are ready to create your dispute running the following command:

```bash
node ./bin/index.js dispute \
  -a [ARBITRABLE] \
  -m [METADATA] \
  -e [EVIDENCE_1] [EVIDENCE_2] ... [EVIDENCE_N] \
  -s [SUBMITTER_1] [SUBMITTER_1] ... [SUBMITTER_N] \
  -c \
  -n [NETWORK] \
```

Where: 
- `[ARBITRABLE]`: address of your Arbitrable instance
- `[METADATA]`: metadata to be linked for your dispute (continue reading to have a better understanding of how to build a proper dispute metadata)
- `[EVIDENCE_N]`: links in the form of `ipfs:[CID]` to human-readable evidence hosted on IPFS (continue reading for example evidence links) 
- `[SUBMITTER_N]`: addresses submitting each piece of evidence; this list should match the evidence list length 
- `-c` flag: optional to declare that the evidence submission period should be immediately closed. Otherwise you will need to manually close it afterwards. 
- `[NETWORK]`: name of the Aragon Court instance you are willing to use: `usability`, `rinkeby`, or `ropsten`

This command will output the ID of the dispute you've just created.

A few things to bear in mind is that, even though the `[METADATA]` and `[EVIDENCE_N]` arguments could be any arbitrary information, in order to use the Court Dashboard to rule disputes, these should follow a specific structure.
Please check out the [Court Dashboard instructions](https://github.com/aragon/court-dashboard/blob/development/docs/metadata.md) about how these objects should be formatted.

### 8.5.1. Metadata

The Court Dashboard expects the metadata to be built as a specific JSON formatted data:
```json
{ 
    "description": "Your dispute description",  
    "metadata": "[CID]/metadata.json" 
}
```

Where `[CID]` is the hash of a directory holding a `metadata.json` file with the rest of the metadata.
You can checkout the [`metadata.json`](https://ipfs.io/ipfs/QmYt33BkuHMLe4dSTfLan7QXxQVTGRyhVLt5sujrZkhd1w/metadata.json) file used for the [dispute #1](https://court-usability.aragon.org/disputes/1) of Aragon Court as an example.

### 8.5.2. Evidence

For the Court Dashboard, the evidence is simpler than the metadata, it only needs to be a human-readable content uploaded to IPFS.
Then it should be submitted as `ipfs:[CID]`. For example, [`ipfs:QmYGNe8jhTEwdDfixtDnPpzjQpXhX2nMj3xMK3swy69naP`](https://ipfs.io/ipfs/QmYGNe8jhTEwdDfixtDnPpzjQpXhX2nMj3xMK3swy69naP) is the evidence submitted for the [dispute #1](https://court-usability.aragon.org/disputes/1) of Aragon Court.

## 8.6. Ruling a dispute

You can use any of the Court Dashboard instances linked in section 8.1 to interact with your created disputes (note that in some environments, it may be difficult to ensure that your account is drafted—and therefore can be difficult to come to a ruling you want—due to the randomness nature of the court). 
If you did not format or ensure your dispute metadata was available as explained in sections 8.5.1 and 8.5.2, the dispute will most likely not display the intended information to jurors.

Alternatively, you can use the rest of the CLI tool [commands](https://github.com/aragonone/court-backend/tree/master/packages/cli/#commands) to begin ruling your dispute:
- [`draft`](https://github.com/aragonone/court-backend/blob/master/packages/cli/src/commands/draft.js): Draft dispute and close evidence submission period if necessary
- [`commit`](https://github.com/aragonone/court-backend/blob/master/packages/cli/src/commands/commit.js): Commit vote for a dispute round
- [`reveal`](https://github.com/aragonone/court-backend/blob/master/packages/cli/src/commands/reveal.js): Reveal committed vote
- [`appeal`](https://github.com/aragonone/court-backend/blob/master/packages/cli/src/commands/appeal.js): Appeal dispute in favour of a certain outcome
- [`confirm-appeal`](https://github.com/aragonone/court-backend/blob/master/packages/cli/src/commands/confirm-appeal.js): Confirm an existing appeal for a dispute
- [`execute`](https://github.com/aragonone/court-backend/blob/master/packages/cli/src/commands/execute.js): Execute ruling for a dispute
