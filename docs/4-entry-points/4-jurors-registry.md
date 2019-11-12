## 4.4. Jurors Registry

The `JurorsRegistry` module is in charge of handling the jurors activity and mainly the different states of their staked balances. 
This module is in the one handling all the staking/unstaking logic for the jurors, all the ANJ staked into the Court is held by the registry.

### 4.4.1. Constructor

- **Actor:** Deployer account
- **Inputs:**
    - **Controller:** Address of the `Controller` contract that centralizes all the modules being used
    - **Juror token:** Address of the ERC20 token to be used as juror token for the registry
    - **Total active balance limit:** Maximum amount of total active balance that can be hold in the registry
- **Authentication:** Open
- **Pre-flight checks:**
    - Ensure that the controller address is a contract
    - Ensure that the juror token address is a contract
    - Ensure that the total active balance limit is greater than zero
- **State transitions:**
    - Save the controller address
    - Save the juror token address
    - Save the total active balance limit

### 4.4.2. Activate

- **Actor:** Juror of the Court
- **Inputs:**
    - **Amount:** Amount of juror tokens to be activated for the next term
- **Authentication:** Open. Implicitly, only jurors with some available balance can call this function
- **Pre-flight checks:**
    - Ensure that the Court term is up-to-date. Otherwise, perform a heartbeat before continuing the execution.
    - Ensure that the requested amount is greater than zero
    - Ensure that the juror's available balance is enough for the requested amount
    - Ensure that the new active balance is greater than the minimum active balance for the Court
    - Ensure that the total active balance held in the registry does not reach the limit
- **State transitions:**
    - Update current Court term if needed
    - Process previous deactivation requests if there is any, increase the juror's available balance
    - Update the juror's active balance for the next term
    - Decrease the juror's available balance

### 4.4.3. Deactivate

- **Actor:** Juror of the Court
- **Inputs:**
    - **Amount:** Amount of juror tokens to be deactivated for the next term
- **Authentication:** Open. Implicitly, only jurors with some activated balance can call this function
- **Pre-flight checks:**
    - Ensure that the Court term is up-to-date. Otherwise, perform a heartbeat before continuing the execution.
    - Ensure that the unlocked active balance of the jurors is enough for the requested amount
    - Ensure that the remaining active balance is either zero or greater than the minimum active balance for the Court
- **State transitions:**
    - Update current Court term if needed
    - Process previous deactivation requests if there is any, increase the juror's available balance
    - Create a new deactivation request object for the next term

### 4.4.4. Stake

- **Actor:** Juror of the Court
- **Inputs:**
    - **Amount:** Amount of tokens to be staked
    - **Data:** Optional data that can be used to request the activation of the transferred tokens
- **Authentication:** Open. Implicitly, only jurors that have open an ERC20 allowance with the requested amount of tokens to stake can call this function
- **Pre-flight checks:**
    - Ensure that the given amount is greater than zero
- **State transitions:**
    - Update the available balance of the juror
    - Activate the staked amount if requested by the juror
    - Pull the corresponding amount of juror tokens from the sender to the `JurorsRegistry` module, revert if the ERC20-transfer wasn't successful

### 4.4.5. Stake for

- **Actor:** External entity incentivized to stake some tokens in favor of a juror of the Court
- **Inputs:**
    - **Recipient:** Address of the juror to stake an amount of tokens to
    - **Amount:** Amount of tokens to be staked
    - **Data:** Optional data that can be used to request the activation of the transferred tokens
- **Authentication:** Open. Implicitly, only accounts that have open an ERC20 allowance with the requested amount of tokens to stake can call this function
- **Pre-flight checks:**
    - Ensure that the given amount is greater than zero 
- **State transitions:**
    - Update the available balance of the juror
    - Activate the staked amount if requested by the juror
    - Pull the corresponding amount of juror tokens from the sender to the `JurorsRegistry` module, revert if the ERC20-transfer wasn't successful 

### 4.4.6. Unstake

- **Actor:** Juror of the Court
- **Inputs:**
    - **Amount:** Amount of tokens to be unstaked
    - **Data:** Optional data is never used by this function
- **Authentication:** Open. Implicitly, only jurors that have some available balance in the registry can call this function
- **Pre-flight checks:**
    - Ensure that the requested amount is greater than zero
    - Ensure that there is enough available balance for the requested amount
- **State transitions:**
    - Update the available balance of the juror
    - Process previous deactivation requests if there is any, increase the juror's available balance
    - Transfer the requested amount of juror tokens from the `JurorsRegistry` module to the juror, revert if the ERC20-transfer wasn't successful

### 4.4.7. Receive approval

- **Actor:** ANJ token contract
- **Inputs:**
    - **From:** Address making the transfer
    - **Amount:** Amount of tokens to transfer
    - **Token:** Address of token contract calling the function
    - **Data:** Optional data that can be used to request the activation of the transferred tokens
- **Authentication:** Open. Implicitly, only the ANJ token contract
- **Pre-flight checks:**
    - Ensure that the given amount is greater than zero
- **State transitions:**
    - Update the available balance of the juror
    - Activate the staked amount if requested by the juror
    - Pull the corresponding amount of juror tokens from the sender to the `JurorsRegistry` module, revert if the ERC20-transfer wasn't successful

### 4.4.8. Process deactivation request

- **Actor:** External entity incentivized to update jurors available balances
- **Inputs:**
    - **Juror:** Address of the juror to process the deactivation request of
- **Authentication:** Open
- **Pre-flight checks:**
    - Ensure that the Court term is up-to-date. Otherwise, perform a heartbeat before continuing the execution.
    - Ensure there is an existing deactivation request for the juror
    - Ensure that the existing deactivation request can be processed at the current term
- **State transitions:**
    - Increase the available balance of the juror
    - Reset the deactivation request of the juror

### 4.4.9. Assign tokens

- **Actor:** `DisputesManager` module
- **Inputs:**
    - **Juror:** Address of the juror to add an amount of tokens to
    - **Amount:** Amount of tokens to be added to the available balance of a juror
- **Authentication:** Only `DisputesManager` module
- **Pre-flight checks:** None
- **State transitions:**
    - Increase the juror's available balance

### 4.4.10. Burn tokens

- **Actor:** `DisputesManager` module
- **Inputs:**
    - **Amount:** Amount of tokens to be burned
- **Authentication:** Only `DisputesManager` module
- **Pre-flight checks:** None 
- **State transitions:**
    - Increase the burn address's available balance

### 4.4.11. Draft

- **Actor:** `DisputesManager` module
- **Inputs:**
    - **Draft params:** Object containing:
        - **Term randomness:** Randomness to compute the seed for the draft
        - **Dispute ID:** Identification number of the dispute to draft jurors for
        - **Term ID:** Identification number of the current term when the draft is being computed
        - **Selected jurors:** Number of jurors already selected for the draft
        - **Batch requested jurors:** Number of jurors to be selected in the given batch of the draft
        - **Draft requested jurors:** Total number of jurors requested to be drafted
        - **Draft locking permyriad:** ‱ of the minimum active balance to be locked for the draft (1/10,000)
- **Authentication:** Only `DisputesManager` module
- **Pre-flight checks:**
    - Ensure that the requested number of jurors to be drafted is greater than zero
    - Ensure each drafted juror has enough active balance to be locked for the draft
    - Ensure that a limit number of drafting iterations will be computed
- **State transitions:**
    - Update the locked active balance of each drafted juror
    - Decrease previous deactivation requests if there is any and needed to draft the juror

### 4.4.12. Slash or unlock

- **Actor:** `DisputesManager` module
- **Inputs:**
    - **Term ID:** Current term identification number
    - **Jurors:** List of juror addresses to be slashed
    - **Locked amounts:** List of amounts locked for each corresponding juror that will be either slashed or returned
    - **Rewarded jurors:** List of booleans to tell whether a juror's active balance has to be slashed or not
- **Authentication:** Only `DisputesManager` module
- **Pre-flight checks:**
    - Ensure that both lists lengths match
    - Ensure that each juror has enough locked balance to be unlocked
- **State transitions:**
    - Decrease the unlocked balance of each juror based on their corresponding given amounts
    - In case of a juror being slashed, decrease their active balance for the next term 

### 4.4.13. Collect tokens

- **Actor:** `DisputesManager` module
- **Inputs:**
    - **Juror:** Address of the juror to collect the tokens from
    - **Amount:** Amount of tokens to be collected from the given juror and for the requested term id
    - **Term ID:** Current term identification number
- **Authentication:** Only `DisputesManager` module
- **Pre-flight checks:**
    - Ensure the juror has enough active balance based on the requested amount
- **State transitions:**
    - Decrease the active balance of the juror for the next term
    - Decrease previous deactivation requests if there is any and its necessary to collect the requested amount of tokens from a juror

### 4.4.14. Lock withdrawals

- **Actor:** `DisputesManager` module
- **Inputs:**
    - **Juror:** Address of the juror to locked the withdrawals of
    - **Term ID:** Term identification number until which the juror's withdrawals will be locked
- **Authentication:** Only `DisputesManager` module
- **Pre-flight checks:** None
- **State transitions:**
    - Update the juror's state with the term ID until which their withdrawals will be locked

### 4.4.15. Set total active balance limit

- **Actor:** External entity in charge of maintaining the Court protocol
- **Inputs:**
    - **New total active balance limit:** New limit of total active balance of juror tokens
- **Authentication:** Only config governor
- **Pre-flight checks:**
    - Ensure that the total active balance limit is greater than zero
- **State transitions:**
    - Update the total active balance limit

### 4.4.16. Recover funds

- **Actor:** External entity in charge of maintaining the Court protocol
- **Inputs:**
    - **Token:** Address of the ERC20-compatible token to be recovered from the `JurorsRegistry` module
    - **Recipient:** Address that will receive the funds of the `JurorsRegistry` module
- **Authentication:** Only funds governor
- **Pre-flight checks:**
    - Ensure that the balance of the `JurorsRegistry` module is greater than zero
- **State transitions:**
    - Transfer the whole balance of the `JurorsRegistry` module to the recipient address, revert if the ERC20-transfer wasn't successful
