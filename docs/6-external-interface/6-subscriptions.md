## 6.6. Subscriptions

### 6.6.1 Events

The following events are emitted by the `Subscriptions`:

#### 6.6.1.1. App fees paid

- **Name:** `AppFeePaid`
- **Args:**
    - **By:** Address of the paying for the app fees
    - **App ID:** App identifier
    - **Data:** Optional data being logged only

#### 6.6.1.2. Fees donated

- **Name:** `FeesDonated`
- **Args:**
    - **Payer:** Address of the donner
    - **Period ID:** Identification number of the subscription period when the donation was made 
    - **Token:** Address of the fee token used for the donation
    - **Amount:** Amount of fee tokens that were donated

#### 6.6.1.3. Fees claimed

- **Name:** `FeesClaimed`
- **Args:**
    - **Juror:** Address of the juror whose fees have been claimed
    - **Period ID:** Identification number of the subscription period claimed by the juror
    - **Token:** Address of the fee token used for the fees
    - **Amount:** Amount of tokens the juror received for the requested period

#### 6.6.1.4. Governor fees transferred

- **Name:** `GovernorFeesTransferred`
- **Args:**
    - **Token:** Address of the fee token used for the fees
    - **Amount:** Amount of tokens transferred to the governor address

#### 6.6.1.5. Fee token changed

- **Name:** `FeeTokenChanged`
- **Args:**
    - **Previous token:** Previous address of the ERC20 used for the subscriptions fees
    - **Current token:** Current address of the ERC20 used for the subscriptions fees

#### 6.6.1.6. App fee set

- **Name:** `AppFeeSet`
- **Args:**
    - **App ID:** App identifier
    - **Token:** App fee token address
    - **Amount:** App fee token amount

#### 6.6.1.7. App fee unset

- **Name:** `AppFeeUnset`
- **Args:**
    - **App ID:** App identifier

#### 6.6.1.8. Governor share changed

- **Name:** `GovernorSharePctChanged`
- **Args:**
    - **Previous governor share:** Previous permyriad of subscription fees that was being allocated to the governor
    - **Current governor share:** Current permyriad of subscription fees that will be allocated to the governor

### 6.6.2. Getters

The following functions are state getters provided by the `Subscriptions`:

#### 6.6.2.1. Is up to date

- **Inputs:**
    - **Subscriber:** Address of subscriber being checked
- **Pre-flight checks:** None
- **Outputs:**
    - **Up-to-date:** Always true

#### 6.6.2.2. Period duration

- **Inputs:** None
- **Pre-flight checks:** None
- **Outputs:**
    - **Duration:** Duration of a subscription period in Court terms

#### 6.6.2.3. Governor share

- **Inputs:** None
- **Pre-flight checks:** None
- **Outputs:**
    - **Governor share:** Permyriad of subscription fees that will be allocated to the governor of the Court (‱ - 1/10,000)

#### 6.6.2.4. Current fee token

- **Inputs:** None
- **Pre-flight checks:** None
- **Outputs:**
    - **Fee token:** ERC20 token used for the subscription fees

#### 6.6.2.5. App fee

- **Inputs:** 
    - **App ID:** App identifier
- **Pre-flight checks:** None
- **Outputs:**
    - **Fee token:** Address of the token to be used for the app fees
    - **Fee amount:** Amount of fee tokens to be paid for the requested app

#### 6.6.2.6. Current period ID

- **Inputs:** None
- **Pre-flight checks:**
    - Ensure that the Court first term has already started
- **Outputs:**
    - **Period ID:** Identification number of the current period

#### 6.6.2.7. Period

- **Inputs:** None
- **Pre-flight checks:**
    - Ensure that the Court first term has already started
- **Outputs:**
    - **Fee token:** Address of the fee token used for the subscription fees
    - **Balance checkpoint:** Court term ID of a period used to fetch the total active balance of the jurors registry
    - **Total active balance:** Total amount of juror tokens active in the Court at the corresponding period checkpoint
    - **Collected fees:** Total amount of subscription fees collected during a period
    - **Accumulated governor fees:** Total amount of fees accumulated for the governor of the Court during a period

#### 6.6.2.8. Owed fees details

- **Inputs:**
    - **Subscriber:** Address of the subscriber being queried
- **Pre-flight checks:**
    - Ensure that the Court first term has already started
- **Outputs:**
    - **Token address:** Address of the token used for the subscription fees
    - **Amount to pay:** Always zero
    - **New last period ID:** Always current period ID

#### 6.6.2.9. Juror share

- **Inputs:**
    - **Juror:** Address of the juror querying the owed shared fees of
    - **Period ID:** Identification number of the period being queried
- **Pre-flight checks:**
    - Ensure that the Court first term has already started
- **Outputs:**
    - **Fee token:** Address of the token used for the subscription fees
    - **Amount:** Amount of share fees owed to the given juror for the requested period

#### 6.6.2.10. Has juror claimed

- **Inputs:**
    - **Juror:** Address of the juror being queried
    - **Period ID:** Identification number of the period being queried
- **Pre-flight checks:**
    - Ensure that the Court first term has already started
- **Outputs:**
    - **Claimed:** True if the owed share fees have already been claimed, false otherwise
