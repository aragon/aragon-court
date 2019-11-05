## 6.1. Controller

### 6.1.1 Events

The following events are emitted by the `Controller`:

#### 6.1.1.1. Config changed

- **Name:** `NewConfig`
- **Args:**
    - **From term ID:** Identification number of the Court term when the config change will happen 
    - **Court config ID:** Identification number of the Court config to be changed 

#### 6.1.1.2. Heartbeat

- **Name:** `Heartbeat`
- **Args:**
    - **Previous term ID:** Identification number of the Court term before the transition 
    - **Current term ID:** Identification number of the Court term after the transition 

#### 6.1.1.3. Automatic withdrawals changed

- **Name:** `AutomaticWithdrawalsAllowedChanged`
- **Args:**
    - **Holder:** Address of the token holder whose automatic withdrawals config was changed 
    - **Allowed:** Whether automatic withdrawals are allowed or not for the given holder  

#### 6.1.1.4. Module set

- **Name:** `ModuleSet`
- **Args:**
    - **Module ID:** ID of the module being set
    - **Address:** Address of the module being set

#### 6.1.1.5. Funds governor changed

- **Name:** `FundsGovernorChanged`
- **Args:**
    - **Previous governor:** Address of the previous funds governor
    - **Current governor:** Address of the current funds governor

#### 6.1.1.6. Config governor changed

- **Name:** `ConfigGovernorChanged`
- **Args:**
    - **Previous governor:** Address of the previous config governor
    - **Current governor:** Address of the current config governor

#### 6.1.1.7. Modules governor changed

- **Name:** `ModulesGovernorChanged`
- **Args:**
    - **Previous governor:** Address of the previous modules governor
    - **Current governor:** Address of the current modules governor

### 6.1.2. Getters

The following functions are state getters provided by the `Controller`:

#### 6.1.2.1. Config

- **Inputs:**
    - **Term ID:** Identification number of the term querying the Court config of 
- **Pre-flight checks:** None
- **Outputs:**
    - **Fee token:** Address of the token used to pay for fees
    - **Fees:** Array Array containing fee information:
        - **Juror fee:** Amount of fee tokens that is paid per juror per dispute
        - **Draft fee:** Amount of fee tokens per juror to cover the drafting cost
        - **Settle fee:** Amount of fee tokens per juror to cover round settlement cost
    - **Round state durations:** Array containing the durations in terms of the different phases of a dispute:
        - **Commit terms:** Commit period duration in Court terms
        - **Reveal terms:** Reveal period duration in Court terms
        - **Appeal terms:** Appeal period duration in Court terms
        - **Appeal confirmation terms:** Appeal confirmation period duration in Court terms
    - **Permyriads:** Array containing permyriads information:
        - **Penalty pct:** Permyriad of min active tokens balance to be locked for each drafted juror (‱ - 1/10,000)
        - **Final round reduction:** Permyriad of fee reduction for the last appeal round (‱ - 1/10,000)
    - **Round params:** Array containing params for rounds:
        - **First round jurors number:** Number of jurors to be drafted for the first round of disputes
        - **Appeal step factor:** Increasing factor for the number of jurors of each round of a dispute
        - **Max regular appeal rounds:** Number of regular appeal rounds before the final round is triggered
        - **Final round lock terms:** Number of terms that a coherent juror in a final round is disallowed to withdraw (to prevent 51% attacks)
    - **Appeal collateral params:** Array containing params for appeal collateral:
        - **Appeal collateral factor:** Multiple of juror fees required to appeal a preliminary ruling
        - **Appeal confirm collateral factor:** Multiple of juror fees required to confirm appeal

#### 6.1.2.2. Disputes config

- **Inputs:**
    - **Term ID:** Identification number of the term querying the Court disputes config of
- **Pre-flight checks:** None
- **Outputs:**
    - **Fee token:** ERC20 token to be used for the fees of the Court
    - **Final round reduction:** Permyriad of fees reduction applied for final appeal round (‱ - 1/10,000)
    - **Juror fee:** Amount of tokens paid to draft a juror to adjudicate a dispute
    - **Draft fee:** Amount of tokens paid per round to cover the costs of drafting jurors
    - **Settle fee:** Amount of tokens paid per round to cover the costs of slashing jurors
    - **First round jurors number:** Number of jurors drafted on first round

#### 6.1.2.3. Drafts config

- **Inputs:**
    - **Term ID:** Identification number of the term querying the Court drafts config of
- **Pre-flight checks:** None
- **Outputs:**
    - **Fee token:** ERC20 token to be used for the fees of the Court
    - **Draft fee:** Amount of fee tokens per juror to cover the drafting cost
    - **Penalty pct:** Permyriad of min active tokens balance to be locked for each drafted juror (‱ - 1/10,000)

#### 6.1.2.4. Minimum ANJ active balance

- **Inputs:**
    - **Term ID:** Identification number of the term querying the Court min active balance of
- **Pre-flight checks:** None
- **Outputs:**
    - **Min active balance:** Minimum amount of juror tokens jurors have to activate to participate in the Court

#### 6.1.2.5. Config change term ID

- **Inputs:** None 
- **Pre-flight checks:** None
- **Outputs:**
    - **Config change term ID:** Term identification number of the next scheduled config change

#### 6.1.2.6. Term duration

- **Inputs:** None 
- **Pre-flight checks:** None
- **Outputs:**
    - **Term duration:** Duration in seconds of the Court term

#### 6.1.2.7. Last ensured term ID

- **Inputs:** None 
- **Pre-flight checks:** None
- **Outputs:**
    - **Last ensured term ID:** Identification number of the last ensured term

#### 6.1.2.8. Current term ID

- **Inputs:** None 
- **Pre-flight checks:** None
- **Outputs:**
    - **Current term ID:** Identification number of the current term

#### 6.1.2.9. Needed transitions

- **Inputs:** None 
- **Pre-flight checks:** None  
- **Outputs:**
    - **Needed transitions:** Number of terms the Court should transition to be up-to-date
    
#### 6.1.2.10. Term

- **Inputs:** 
    - **Term ID:** Identification number of the term being queried
- **Pre-flight checks:** None  
- **Outputs:**
    - **Start time:** Term start time
    - **Randomness BN:** Block number used for randomness in the requested term
    - **Randomness:** Randomness computed for the requested term
    
#### 6.1.2.11. Term randomness

- **Inputs:** 
    - **Term ID:** Identification number of the term being queried
- **Pre-flight checks:**
    - Ensure the term was already transitioned  
- **Outputs:**
    - **Term randomness:** Randomness of the requested term

#### 6.1.2.12. Are withdrawals allowed for

- **Inputs:** 
    - **Address:** Address of the token holder querying if withdrawals are allowed for
- **Pre-flight checks:** None
- **Outputs:**
    - **Allowed:** True if the given holder accepts automatic withdrawals of their tokens, false otherwise

#### 6.1.2.13. Funds governor

- **Inputs:** None 
- **Pre-flight checks:** None
- **Outputs:**
    - **Funds governor:** Address of the funds governor

#### 6.1.2.14. Config governor

- **Inputs:** None 
- **Pre-flight checks:** None
- **Outputs:**
    - **Config governor:** Address of the config governor

#### 6.1.2.15. Modules governor

- **Inputs:** None 
- **Pre-flight checks:** None
- **Outputs:**
    - **Modules governor:** Address of the modules governor

#### 6.1.2.16. Module

- **Inputs:** None 
- **Pre-flight checks:** 
    - **Module ID:** ID of the module being queried
- **Outputs:**
    - **Module address:** Address of the module queried

#### 6.1.2.17. Court

- **Inputs:** None 
- **Pre-flight checks:** None
- **Outputs:**
    - **Court address:** Address of the `Court` module set

#### 6.1.2.18. Jurors registry

- **Inputs:** None 
- **Pre-flight checks:** None
- **Outputs:**
    - **Jurors registry address:** Address of the `JurorsRegistry` module set

#### 6.1.2.19. Voting

- **Inputs:** None 
- **Pre-flight checks:** None
- **Outputs:**
    - **Voting address:** Address of the `Voting` module set

#### 6.1.2.20. Subscriptions

- **Inputs:** None 
- **Pre-flight checks:** None
- **Outputs:**
    - **Subscriptions address:** Address of the `Subscriptions` module set

#### 6.1.2.21. Treasury

- **Inputs:** None 
- **Pre-flight checks:** None
- **Outputs:**
    - **Treasury address:** Address of the `Treasury` module set
