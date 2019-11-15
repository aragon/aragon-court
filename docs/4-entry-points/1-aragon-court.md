## 4.1. AragonCourt

`AragonCourt` is the main entry point of the whole Court protocol and is only responsible for providing a few entry points to the users of the protocol while orchestrating the rest of the modules to fulfill these request.
Additionally, as shown in [section 2](../2-architecture), `AragonCourt` inherits from `Controller`. The inherited functionality is core to architecture of the protocol and can be found in the [next section](./2-controller.md).
To read more information about its responsibilities and how the whole architecture structure looks like, go to [section 2](../2-architecture).

### 4.1.1. Constructor

- **Actor:** Deployer account
- **Inputs:**
    - **Term duration:** Duration in seconds per Court term
    - **First-term start time:** Timestamp in seconds when the Court will start
    - **Governor:** Object containing
        - **Funds governor:** Address of the governor allowed to manipulate module's funds
        - **Config governor:** Address of the governor allowed to manipulate court settings
        - **Modules governor:** Address of the governor allowed to manipulate module's addresses
    - **Settings:** Object containing
        - **Fee token:** Address of the token contract that is used to pay for the fees
        - **Juror fee:** Amount of fee tokens paid per drafted juror per dispute
        - **Heartbeat fee:** Amount of fee tokens per dispute to cover terms update costs
        - **Draft fee:**  Amount of fee tokens per juror to cover the drafting costs
        - **Settle fee:** Amount of fee tokens per juror to cover round settlement costs
        - **Evidence terms:** Max submitting evidence period duration in Court terms
        - **Commit terms:** Duration of the commit phase in Court terms
        - **Reveal terms:** Duration of the reveal phase in Court terms
        - **Appeal terms:** Duration of the appeal phase in Court terms
        - **Appeal confirmation terms:** Duration of the appeal confirmation phase in Court terms
        - **Penalty permyriad:** ‱ of min active tokens balance to be locked for each drafted juror (1/10,000)
        - **Final-round reduction:** ‱ of fee reduction for the last appeal round (1/10,000)
        - **First-round jurors number:** Number of jurors to be drafted for the first round of a dispute
        - **Appeal step factor:** Increasing factor for the number of jurors of each dispute round
        - **Max regular appeal rounds:** Number of regular appeal rounds before the final round is triggered
        - **Final round lock terms:** Number of terms that a coherent juror in a final round is disallowed to withdraw
        - **Appeal collateral factor:** ‱ multiple of juror fees required to appeal a preliminary ruling (1/10,000)
        - **Appeal confirmation collateral factor:** ‱ multiple of juror fees required to confirm an appeal (1/10,000)
        - **Min active balance:** Minimum amount of juror tokens that can be activated
- **Authentication:** Open
- **Pre-flight checks:** None
- **State transitions:**
    - Call `Controller` constructor

### 4.1.2. Create dispute

- **Actor:** Arbitrable instances, entities that need a dispute adjudicated
- **Inputs:**
    - **Possible rulings:** Number of possible results for a dispute
    - **Metadata:** Optional metadata that can be used to provide additional information on the dispute to be created
- **Authentication:** Open. Implicitly, only smart contracts that are up to date on their subscriptions in the `Subscription` module and that have open an ERC20 allowance with an amount of at least the dispute fee to the `DisputeManager` module can call this function
- **Pre-flight checks:**
    - Ensure that the msg.sender supports the `IArbitrable` interface
    - Ensure that the subject is up-to-date on its subscription fees
- **State transitions:**
    - Create a new dispute object in the DisputeManager module

### 4.1.3. Close evidence period

- **Actor:** Arbitrable instances, entities that need a dispute adjudicated.
- **Inputs:**
    - **Dispute ID:** Dispute identification number
- **Authentication:** Open. Implicitly, only the Arbitrable instance related to the given dispute
- **Pre-flight checks:**
    - Ensure a dispute object with that ID exists
    - Ensure that the dispute subject is the Arbitrable calling the function
    - Ensure that the dispute evidence period is still open
- **State transitions:**
    - Update the dispute to allow being drafted immediately

### 4.1.4. Execute dispute

- **Actor:** External entity incentivized to execute the final ruling decided for a dispute. Alternatively, an altruistic entity to make sure the dispute is ruled.
- **Inputs:**
    - **Dispute ID:** Dispute identification number
- **Authentication:** Open
- **Pre-flight checks:**
    - Ensure a dispute object with that ID exists
    - Ensure that the dispute has not been executed yet
    - Ensure that the dispute's last round adjudication phase has ended
- **State transitions:**
    - Compute the final ruling in the DisputeManager module
    - Execute the `IArbitrable` instance linked to the dispute based on the decided ruling
