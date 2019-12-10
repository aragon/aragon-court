## 6.3. Dispute Manager

### 6.3.1 Events

The following events are emitted by the `DisputeManager`:

#### 6.3.1.1. New dispute

- **Name:** `NewDispute`
- **Args:**
    - **Dispute ID:** Identification number of the dispute that has been created
    - **Subject:** Address of the `Arbitrable` subject associated to the dispute
    - **Draft term ID:** Identification number of the term when the dispute will be able to be drafted
    - **Jurors number:** First round jurors number 
    - **Metadata:** Optional metadata that can be used to provide additional information on the created dispute 

#### 6.3.1.2. Evidence period closed

- **Name:** `EvidencePeriodClosed`
- **Args:**
    - **Dispute ID:** Identification number of the dispute that has changed 
    - **Term ID:** Term ID in which the dispute evidence period has been closed 

#### 6.3.1.3. Juror drafted

- **Name:** `JurorDrafted`
- **Args:**
    - **Dispute ID:** Identification number of the dispute that was drafted
    - **Round ID:** Identification number of the dispute round that was drafted
    - **Juror:** Address of the juror drafted for the dispute

#### 6.3.1.4. Dispute changed

- **Name:** `DisputeStateChanged`
- **Args:**
    - **Dispute ID:** Identification number of the dispute that has changed 
    - **State:** New dispute state: pre-draft, adjudicating, or ruled 

#### 6.3.1.5. Ruling appealed

- **Name:** `RulingAppealed`
- **Args:**
    - **Dispute ID:** Identification number of the dispute appealed
    - **Round ID:** Identification number of the adjudication round appealed 
    - **Ruling:** Ruling appealed in favor of 

#### 6.3.1.6. Ruling appeal confirmed

- **Name:** `RulingAppealConfirmed`
- **Args:**
    - **Dispute ID:** Identification number of the dispute whose last round's appeal was confirmed 
    - **Round ID:** Identification number of the adjudication round whose appeal was confirmed 
    - **Draft term ID:** Identification number of the term when the next round will be able to be drafted
    - **Jurors number:** Next round jurors number
    
#### 6.3.1.7. Ruling computed

- **Name:** `RulingComputed`
- **Args:**
    - **Dispute ID:** Identification number of the dispute being ruled
    - **Ruling:** Final ruling decided for the dispute

#### 6.3.1.8. Penalties settled

- **Name:** `PenaltiesSettled`
- **Args:**
    - **Dispute ID:** Identification number of the dispute settled
    - **Round ID:** Identification number of the adjudication round settled 
    - **Collected tokens:** Total amount of juror tokens that were collected from slashed jurors for the requested round

#### 6.3.1.9. Reward settled

- **Name:** `RewardSettled`
- **Args:**
    - **Dispute ID:** Identification number of the dispute settled
    - **Round ID:** Identification number of the adjudication round settled 
    - **Juror:** Address of the juror rewarded

#### 6.3.1.10. Appeal deposit settled

- **Name:** `AppealDepositSettled`
- **Args:**
    - **Dispute ID:** Identification number of the dispute whose round's appeal was settled
    - **Round ID:** Identification number of the adjudication round whose appeal was settled 

#### 6.3.1.11. Max jurors per draft batch changed

- **Name:** `MaxJurorsPerDraftBatchChanged`
- **Args:**
    - **Previous max jurors per draft batch:** Previous max number of jurors to be drafted per batch
    - **Current max jurors per draft batch:** New max number of jurors to be drafted per batch  

### 6.3.2. Getters

The following functions are state getters provided by the `DisputeManager`:

#### 6.3.2.1. Dispute fees

- **Inputs:** None
- **Pre-flight checks:** None
- **Outputs:**
    - **Fee token:** Address of the ERC20 token used for the fees
    - **Total fee:** Total amount of fees required to create a dispute in the next draft term

#### 6.3.2.2. Dispute

- **Inputs:** 
    - **Dispute ID:** Identification number of the dispute being queried
- **Pre-flight checks:** 
    - Ensure a dispute object with that ID exists
- **Outputs:**
    - **Subject:** Arbitrable subject being disputed
    - **Possible rulings:** Number of possible rulings allowed for the drafted jurors to vote on the dispute
    - **State:** Current state of the dispute being queried: pre-draft, adjudicating, or ruled
    - **Final ruling:** The winning ruling in case the dispute is finished
    - **Last round ID:** Identification number of the last round created for the dispute

#### 6.3.2.3. Round

- **Inputs:** 
    - **Dispute ID:** Identification number of the dispute being queried
    - **Round ID:** Identification number of the adjudication round being queried 
- **Pre-flight checks:** 
    - Ensure a dispute object with that ID exists
    - Ensure an adjudication round object with that ID exists for the given dispute
- **Outputs:**
    - **Draft term ID:** Term from which the requested round can be drafted
    - **Delayed terms:** Number of terms the given round was delayed based on its requested draft term id
    - **Jurors number:** Number of jurors requested for the round
    - **Selected jurors:** Number of jurors already selected for the requested round
    - **Settled penalties:** Whether or not penalties have been settled for the requested round
    - **Collected tokens:** Amount of juror tokens that were collected from slashed jurors for the requested round
    - **Coherent jurors:** Number of jurors that voted in favor of the final ruling in the requested round
    - **State:** Adjudication state of the requested round

#### 6.3.2.4. Appeal

- **Inputs:** 
    - **Dispute ID:** Identification number of the dispute being queried
    - **Round ID:** Identification number of the adjudication round being queried 
- **Pre-flight checks:** 
    - Ensure a dispute object with that ID exists
    - Ensure an adjudication round object with that ID exists for the given dispute
- **Outputs:**
    - **Maker:** Address of the account appealing the given round
    - **Appealed ruling:** Ruling confirmed by the appealer of the given round
    - **Taker:** Address of the account confirming the appeal of the given round
    - **Opposed ruling:** Ruling confirmed by the appeal taker of the given round

#### 6.3.2.5. Next round details

- **Inputs:** 
    - **Dispute ID:** Identification number of the dispute being queried
    - **Round ID:** Identification number of the adjudication round being queried 
- **Pre-flight checks:** 
    - Ensure a dispute object with that ID exists
    - Ensure an adjudication round object with that ID exists for the given dispute
- **Outputs:**
    - **Start term ID:** Term ID from which the next round will start
    - **Jurors number:** Jurors number for the next round
    - **New dispute state:** New state for the dispute associated to the given round after the appeal
    - **Fee token:** ERC20 token used for the next round fees
    - **Juror fees:** Total amount of fees to be distributed between the winning jurors of the next round
    - **Total fees:** Total amount of fees for a regular round at the given term
    - **Appeal deposit:** Amount to be deposit of fees for a regular round at the given term
    - **Confirm appeal deposit:** Total amount of fees for a regular round at the given term

#### 6.3.2.6. Juror

- **Inputs:** 
    - **Dispute ID:** Identification number of the dispute being queried
    - **Round ID:** Identification number of the adjudication round being queried
    - **Juror:** Address of the juror being queried
- **Pre-flight checks:** 
    - Ensure a dispute object with that ID exists
    - Ensure an adjudication round object with that ID exists for the given dispute
- **Outputs:**
    - **Weight:** Juror weight drafted for the requested round
    - **Rewarded:** Whether or not the given juror was rewarded based on the requested round
