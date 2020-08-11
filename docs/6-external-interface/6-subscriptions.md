## 6.6. Subscriptions

### 6.6.1 Events

The following events are emitted by the `Subscriptions`:

#### 6.6.1.1. Fees paid

- **Name:** `FeesPaid`
- **Args:**
    - **Subscriber:** Address of the subscriber whose subscription has been paid
    - **Periods:** Number of periods paid for the subscriptions
    - **New last periods ID:** Identification number of the latest paid period of the subscriber
    - **Collected fees:** Part of the paid fees that went to the collected fees amount
    - **Governor fees:** Part of the paid fees that went to the governor shares amount

#### 6.6.1.2. Fees donated

- **Name:** `FeesDonated`
- **Args:**
    - **Payer:** Address of the donner
    - **Amount:** Amount of fee tokens that were donated

#### 6.6.1.3. Fees claimed

- **Name:** `FeesClaimed`
- **Args:**
    - **Juror:** Address of the juror whose fees have been claimed
    - **Period ID:** Identification number of the subscription period claimed by the juror
    - **Amount:** Amount of tokens the juror received for the requested period

#### 6.6.1.4. Governor fees transferred

- **Name:** `GovernorFeesTransferred`
- **Args:**
    - **Amount:** Amount of tokens transferred to the governor address

#### 6.6.1.5. Fee token changed

- **Name:** `FeeTokenChanged`
- **Args:**
    - **Previous token:** Previous address of the ERC20 used for the subscriptions fees
    - **Current token:** Current address of the ERC20 used for the subscriptions fees

#### 6.6.1.6. Fee amount changed

- **Name:** `FeeAmountChanged`
- **Args:**
    - **Previous amount:** Previous amount of subscriptions token fees per period

#### 6.6.1.7. Pre payment period changed

- **Name:** `PrePaymentPeriodsChanged`
- **Args:**
    - **Previous pre-payment periods:** Previous number of pre-payment periods
    - **Current pre-payment periods:** Current number of pre-payment periods

#### 6.6.1.8. Governor share changed

- **Name:** `GovernorSharePctChanged`
- **Args:**
    - **Previous governor share:** Previous permyriad of subscription fees that was being allocated to the governor
    - **Current governor share:** Current permyriad of subscription fees that will be allocated to the governor

#### 6.6.1.9. Late payment penalty changed

- **Name:** `LatePaymentPenaltyPctChanged`
- **Args:**
    - **Previous penalty:** Previous permyriad of subscription fees that was applied as penalty for not paying during proper period
    - **Current penalty:** Current permyriad of subscription fees that will be applied as penalty for not paying during proper period

#### 6.6.1.10. Resume penalty changed

- **Name:** `ResumePenaltiesChanged`
- **Args:**
    - **Previous penalty:** Previous number of periods that was being pre-paid when resuming a paused subscription
    - **Current penalty:** Current number of periods that will have to be pre-paid when resuming a paused subscription

### 6.6.2. Getters

The following functions are state getters provided by the `Subscriptions`:

#### 6.6.2.1. Is up to date

- **Inputs:**
    - **Subscriber:** Address of subscriber being checked
- **Pre-flight checks:** None
- **Outputs:**
    - **Up-to-date:** True if subscriber has paid all the fees up to current period, false otherwise

#### 6.6.2.2. Period duration

- **Inputs:** None
- **Pre-flight checks:** None
- **Outputs:**
    - **Duration:** Duration of a subscription period in Court terms

#### 6.6.2.3. Late payment penalty

- **Inputs:** None
- **Pre-flight checks:** None
- **Outputs:**
    - **Late payment penalty:** Permyriad of subscription fees that will be applied as penalty for not paying during proper period (‱ - 1/10,000)

#### 6.6.2.4. Governor share

- **Inputs:** None
- **Pre-flight checks:** None
- **Outputs:**
    - **Governor share:** Permyriad of subscription fees that will be allocated to the governor of the Court (‱ - 1/10,000)

#### 6.6.2.5. Current fee token

- **Inputs:** None
- **Pre-flight checks:** None
- **Outputs:**
    - **Fee token:** ERC20 token used for the subscription fees

#### 6.6.2.6. Current fee amount

- **Inputs:** None
- **Pre-flight checks:** None
- **Outputs:**
    - **Fee token:** Amount of fees to be paid for each subscription period

#### 6.6.2.7. Pre payment periods

- **Inputs:** None
- **Pre-flight checks:** None
- **Outputs:**
    - **Pre payment periods:** Number of periods that can be paid in advance including the current period. Paying in advance has some drawbacks:

#### 6.6.2.8. Resume pre paid periods

- **Inputs:** None
- **Pre-flight checks:** None
- **Outputs:**
    - **Resume pre paid periods:** Number of periods a subscriber must pre-pay in order to resume his activity after pausing

#### 6.6.2.9. Accumulated governor fees

- **Inputs:** None
- **Pre-flight checks:** None
- **Outputs:**
    - **Governor fees:** Total amount of fees accumulated for the governor of the Court

#### 6.6.2.10. Current period ID

- **Inputs:** None
- **Pre-flight checks:**
    - Ensure that the Court first term has already started
- **Outputs:**
    - **Period ID:** Identification number of the current period

#### 6.6.2.11. Current period

- **Inputs:** None
- **Pre-flight checks:**
    - Ensure that the Court first term has already started
- **Outputs:**
    - **Fee token:** Fee token corresponding to a certain subscription period
    - **Fee amount:** Amount of fees paid for a certain subscription period
    - **Balance checkpoint:** Court term ID of a period used to fetch the total active balance of the jurors registry
    - **Total active balance:** Total amount of juror tokens active in the Court at the corresponding period checkpoint
    - **Collected fees:** Total amount of subscription fees collected during a period

#### 6.6.2.12. Period balance details

- **Inputs:**
    - **Period ID:** Identification number of the period being queried
- **Pre-flight checks:**
    - Ensure that the Court first term has already started
    - Ensure that the requested period ID is valid
- **Outputs:**
    - **Period balance checkpoint:** Court term ID used to fetch the total active balance of the jurors registry
    - **Total active balance:** Total amount of juror tokens active in the Court at the corresponding used checkpoint

#### 6.6.2.13. Subscriber

- **Inputs:**
    - **Subscriber:** Address of the subscriber being queried
- **Pre-flight checks:** None
- **Outputs:**
    - **Subscribed:** True if the given subscriber has already been subscribed to the Court, false otherwise
    - **Paused:** True if the given subscriber has paused the Court subscriptions, false otherwise
    - **Last payment period ID:** Identification number of the last period paid by the given subscriber
    - **Previous delayed periods:** Number of delayed periods the subscriber had before pausing

#### 6.6.2.14. Delayed periods

- **Inputs:**
    - **Subscriber:** Address of the subscriber being queried
- **Pre-flight checks:**
    - Ensure that the Court first term has already started
- **Outputs:**
    - **Periods:** Number of overdue payments for the requested subscriber

#### 6.6.2.15. Pay fees details

- **Inputs:**
    - **Subscriber:** Address of the subscriber being queried
    - **Periods:** Number of periods that would be paid
- **Pre-flight checks:**
    - Ensure that the Court first term has already started
- **Outputs:**
    - **Token address:** Address of the token used for the subscription fees
    - **Amount to pay:** Amount of subscription fee tokens to be paid for all the owed periods
    - **New last period ID:** Identification number of the resulting last paid period

#### 6.6.2.16. Owed fees details

- **Inputs:**
    - **Subscriber:** Address of the subscriber being queried
- **Pre-flight checks:**
    - Ensure that the Court first term has already started
- **Outputs:**
    - **Token address:** Address of the token used for the subscription fees
    - **Amount to pay:** Amount of subscription fee tokens to be paid
    - **New last period ID:** Identification number of the resulting last paid period

#### 6.6.2.17. Juror share

- **Inputs:**
    - **Juror:** Address of the juror querying the owed shared fees of
    - **Period ID:** Identification number of the period being queried
- **Pre-flight checks:**
    - Ensure that the Court first term has already started
- **Outputs:**
    - **Fee token:** Address of the token used for the subscription fees
    - **Amount:** Amount of share fees owed to the given juror for the requested period

#### 6.6.2.18. Has juror claimed

- **Inputs:**
    - **Juror:** Address of the juror being queried
    - **Period ID:** Identification number of the period being queried
- **Pre-flight checks:**
    - Ensure that the Court first term has already started
- **Outputs:**
    - **Claimed:** True if the owed share fees have already been claimed, false otherwise
