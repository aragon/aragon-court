## 6.5. Voting

### 6.5.1 Events

The following events are emitted by the `Voting`:

#### 6.5.1.1. Voting created

- **Name:** `VotingCreated`
- **Args:**
    - **Vote ID:** Identification number of the new vote instance that has been created
    - **Possible outcomes:** Number of possible outcomes of the new vote instance that has been created 

#### 6.5.1.2. Vote committed

- **Name:** `VoteCommitted`
- **Args:**
    - **Vote ID:** Identification number of the vote instance where a vote has been committed
    - **Voter:** Address of the voter that has committed the vote 
    - **Commitment:** Hashed outcome of the committed vote 

#### 6.5.1.3. Vote revealed

- **Name:** `VoteRevealed`
- **Args:**
    - **Vote ID:** Identification number of the vote instance where a vote has been revealed
    - **Voter:** Address of the voter whose vote has been revealed
    - **Outcome:** Outcome of the vote that has been revealed

#### 6.5.1.4. Vote leaked

- **Name:** `VoteLeaked`
- **Args:**
    - **Vote ID:** Identification number of the vote instance where a vote has been leaked
    - **Voter:** Address of the voter whose vote has been leaked
    - **Outcome:** Outcome of the vote that has been leaked
    - **Leaker:** Address of the account that has leaked the vote

### 6.5.2. Getters

The following functions are state getters provided by the `Voting`:

#### 6.5.2.1. Max allowed outcome

- **Inputs:** 
    - **Vote ID:** Vote identification number 
- **Pre-flight checks:**
    - Ensure a vote object with that ID exists
- **Outputs:**
    - **Max outcome:** Max allowed outcome for the given vote instance
    
#### 6.5.2.2. Winning outcome

- **Inputs:**  
    - **Vote ID:** Vote identification number 
- **Pre-flight checks:**
    - Ensure a vote object with that ID exists
- **Outputs:**
    - **Winning outcome:** Winning outcome of the given vote instance or refused in case it's missing
    
#### 6.5.2.3. Outcome tally

- **Inputs:**  
    - **Vote ID:** Vote identification number 
    - **Outcome:** Outcome querying the tally of
- **Pre-flight checks:**
    - Ensure a vote object with that ID exists
- **Outputs:**
    - **Tally:** Tally of the outcome being queried for the given vote instance
    
#### 6.5.2.4. Is valid outcome

- **Inputs:**  
    - **Vote ID:** Vote identification number 
    - **Outcome:** Outcome to check if valid or not
- **Pre-flight checks:**
    - Ensure a vote object with that ID exists
- **Outputs:**
    - **Valid:** True if the given outcome is valid for the requested vote instance, false otherwise

#### 6.5.2.5. Voter outcome

- **Inputs:**  
    - **Vote ID:** Vote identification number querying the outcome of
    - **Voter:** Address of the voter querying the outcome of
- **Pre-flight checks:**
    - Ensure a vote object with that ID exists
- **Outputs:**
    - **Outcome:** Outcome of the voter for the given vote instance
    
#### 6.5.2.6. Has voted in favor of

- **Inputs:**  
    - **Vote ID:** Vote identification number querying if a voter voted in favor of a certain outcome
    - **Outcome:** Outcome to query if the given voter voted in favor of
    - **Voter:** Address of the voter to query if voted in favor of the given outcome
- **Pre-flight checks:**
    - Ensure a vote object with that ID exists
- **Outputs:**
    - **In favor:** True if the given voter voted in favor of the given outcome, false otherwise
    
#### 6.5.2.7. Voters in favor of

- **Inputs:**  
    - **Vote ID:** Vote identification number querying if a voter voted in favor of a certain outcome
    - **Outcome:** Outcome to query if the given voter voted in favor of
    - **Voters:** List of addresses of the voters to be filtered
- **Pre-flight checks:**
    - Ensure a vote object with that ID exists
- **Outputs:**
    - **In favor:** List of results to tell whether a voter voted in favor of the given outcome or not
