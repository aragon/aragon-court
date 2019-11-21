## 6.4. Jurors Registry

### 6.4.1 Events

The following events are emitted by the `JurorsRegistry`:

#### 6.4.1.1. Juror drafted

- **Name:** `JurorDrafted`
- **Args:**
    - **Dispute ID:** Identification number of the dispute that was drafted
    - **Juror:** Address of the juror drafted for the dispute

#### 6.4.1.2. Juror activated

- **Name:** `JurorActivated`
- **Args:**
    - **Juror:** Address of the juror activated
    - **Amount:** Amount of juror tokens activated
    - **From term ID:** Identification number of the term in which the juror tokens will be activated
    
#### 6.4.1.3. Juror deactivation requested

- **Name:** `JurorDeactivationRequested`
- **Args:**
    - **Juror:** Address of the juror that requested a tokens deactivation
    - **Amount:** Amount of juror tokens to be deactivated
    - **Available term ID:** Identification number of the term in which the requested tokens will be deactivated
    
#### 6.4.1.4. Juror deactivation processed

- **Name:** `JurorDeactivationProcessed`
- **Args:**
    - **Juror:** Address of the juror whose deactivation request was processed
    - **Amount:** Amount of juror tokens deactivated
    - **Available term ID:** Identification number of the term in which the requested tokens will be deactivated
    - **Processed term ID:** Identification number of the term in which the given deactivation was processed
    
#### 6.4.1.5. Juror deactivation updated

- **Name:** `JurorDeactivationUpdated`
- **Args:**
    - **Juror:** Address of the juror whose deactivation request was updated
    - **Amount:** New amount of juror tokens of the deactivation request
    - **Available term ID:** Identification number of the term in which the requested tokens will be deactivated
    - **Updated term ID:** Identification number of the term in which the given deactivation was updated
    
#### 6.4.1.6. Juror available balance changed

- **Name:** `JurorAvailableBalanceChanged`
- **Args:**
    - **Juror:** Address of the juror whose available balance was updated
    - **Amount:** Amount of juror tokens updated to the available balance of the juror
    - **Positive:** Whether the updated amount was subtracted or added to the available balance of the juror

#### 6.4.1.7. Juror tokens collected

- **Name:** `JurorTokensCollected`
- **Args:**
    - **Juror:** Address of the juror whose active tokens were collected
    - **Amount:** Amount of juror tokens collected from the juror active tokens
    - **Term ID:** Identification number of the term when the juror tokens were collected

#### 6.4.1.8. Total active balance limit changed

- **Name:** `TotalActiveBalanceLimitChanged`
- **Args:**
    - **Previous limit:** Previous total active balance limit
    - **Current limit:** Current total active balance limit

### 6.4.2. Getters

The following functions are state getters provided by the `JurorsRegistry`:

#### 6.4.2.1. Token
- **Inputs:** None 
- **Pre-flight checks:** None
- **Outputs:**
    - **Juror token:** Address of the juror token

#### 6.4.2.2. Total staked
- **Inputs:** None 
- **Pre-flight checks:** None
- **Outputs:**
    - **Amount:** Total amount of juror tokens held by the registry contract

#### 6.4.2.3. Total active balance
- **Inputs:** None 
- **Pre-flight checks:** None
- **Outputs:**
    - **Amount:** Total amount of active juror tokens

#### 6.4.2.4. Total active balance at
- **Inputs:** 
    - **Term ID:** Identification number of the term querying the total active balance of
- **Pre-flight checks:** None
- **Outputs:**
    - **Amount:** Total amount of active juror tokens at the given term ID
    
#### 6.4.2.5. Total staked for
- **Inputs:** 
    - **Juror:** Address of the juror querying the total amount staked of
- **Pre-flight checks:** None
- **Outputs:**
    - **Amount:** Total amount of tokens of a juror
    
#### 6.4.2.6. Balance of
- **Inputs:** 
    - **Juror:** Address of the juror querying the balance information of
- **Pre-flight checks:** None
- **Outputs:**
    - **Active:** Amount of active tokens of a juror
    - **Available:** Amount of available tokens of a juror
    - **Locked:** Amount of active tokens that are locked due to ongoing disputes
    - **Pending deactivation:** Amount of active tokens that were requested for deactivation

#### 6.4.2.7. Balance of at
- **Inputs:** 
    - **Juror:** Address of the juror querying the balance information of
    - **Term ID:** Identification number of the term querying the balance information of the given juror
- **Pre-flight checks:** None
- **Outputs:**
    - **Active:** Amount of active tokens of a juror at the requested term
    - **Available:** Amount of available tokens of a juror
    - **Locked:** Amount of active tokens that are locked due to ongoing disputes
    - **Pending deactivation:** Amount of active tokens that were requested for deactivation
    
#### 6.4.2.8. Active balance of at
- **Inputs:** 
    - **Juror:** Address of the juror querying the active balance of
    - **Term ID:** Identification number of the term querying the total active balance of the given juror
- **Pre-flight checks:** None
- **Outputs:**
    - **Amount:** Amount of active tokens for juror in the requested term ID
    
#### 6.4.2.9. Unlocked active balance of
- **Inputs:** 
    - **Juror:** Address of the juror querying the unlocked active balance of
- **Pre-flight checks:** None
- **Outputs:**
    - **Amount:** Amount of active tokens of a juror that are not locked due to ongoing disputes
    
#### 6.4.2.10. Deactivation request
- **Inputs:** 
    - **Juror:** Address of the juror querying the deactivation request of
- **Pre-flight checks:** None
- **Outputs:**
    - **Amount:** Amount of tokens to be deactivated
    - **Available term ID:** Term in which the deactivated amount will be available
    
#### 6.4.2.11. Withdrawals lock term ID
- **Inputs:** 
    - **Juror:** Address of the juror querying the lock term ID of
- **Pre-flight checks:** None
- **Outputs:**
    - **Term ID:** Term ID in which the juror's withdrawals will be unlocked (due to final rounds)
    
#### 6.4.2.12. Total active balance limit
- **Inputs:** None 
- **Pre-flight checks:** None
- **Outputs:**
    - **Total active balance limit:** Maximum amount of total active balance that can be held in the registry
    
#### 6.4.2.13. Juror ID
- **Inputs:** 
    - **Juror:** Address of the juror querying the ID of
- **Pre-flight checks:** None
- **Outputs:**
    - **Juror ID:** Identification number associated to a juror address, zero in case it wasn't registered yet
