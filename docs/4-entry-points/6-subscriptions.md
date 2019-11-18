## 4.6. Subscriptions

The `Subscriptions` module is in charge of handling the subscription fees paid by the users to use the Court. 
This module is where fees are paid, stored, and redistributed to the corresponding parties: jurors and the governor.

### 4.6.1. Constructor

- **Actor:** Deployer account
- **Inputs:**
    - **Controller:** Address of the `Controller` contract that centralizes all the modules being used
    - **Period duration:** Duration of a subscription period in Court terms
    - **Fee token:** Initial ERC20-compatible token to be set as the subscriptions fee token
    - **Fee amount:** Initial fee token amount to be set as the subscription fees per period
    - **Pre-payment periods:** Initial number of periods that can be paid in advance including the current period
    - **Late payments penalty permyriad:** Initial ‱ of the subscriptions fees to be charged for each period being payed late (1/10,000)
    - **Governor share permyriad:** Initial ‱ of the subscriptions fees that will be saved for the governor (1/10,000)
    - **Resume pre-paid periods:** Initial number of periods that must be pre-paid to resume a previously paused subscription
- **Authentication:** Open
- **Pre-flight checks:**
    - Ensure that the controller address is a contract
    - Ensure that the period duration is greater than zero
    - Ensure that the fee token amount is greater than zero
    - Ensure that the fee token address is a contract
    - Ensure that the new pre-payment periods is greater than zero
    - Ensure that the new pre-payment periods is greater than or equal to the number of resume pre-paid periods
    - Ensure that the new governor share permyriad is not above 10,000‱
    - Ensure that the new number of resume pre-paid periods is lower than or equal to the maximum number of pre-payments allowed
- **State transitions:**
    - Save the controller address
    - Save the period duration
    - Save the subscriptions fee token amount
    - Save the subscriptions fee token address 
    - Save the number of pre-payment periods
    - Save the late payments penalty permyriad
    - Save the governor share permyriad
    - Save the number of resume pre-paid periods

### 4.6.2. Pay fees

- **Actor:** Users of the Court
- **Inputs:**
    - **From:** Address of the subscriber whose subscription is being paid
    - **Periods:** Number of periods to be paid in total since the last paid period
- **Authentication:** Open. Implicitly, only accounts that have open an ERC20 allowance with an amount equivalent to the fees corresponding to requested number of periods can call this function
- **Pre-flight checks:**
    - Ensure that the number of periods is greater than zero
    - Ensure that the number of paying periods does not exceed the pre-payments limit 
- **State transitions:**
    - Create or update the subscriber's state depending on whether the subscriber has already paid a subscription before or not
    - Update the total amount of collected fees during the current period
    - Update the total amount of collected governor shares
    - Pull the corresponding amount of fee tokens for the requested number of periods from the sender to be deposited in the `Subscriptions` module, revert if the ERC20-transfer wasn't successful

### 4.6.3. Pause

- **Actor:** Users of the Court
- **Inputs:** None
- **Authentication:** Open. Implicitly, only accounts that have already been subscribed before can call this function
- **Pre-flight checks:**
    - Ensure that the sender was already subscribed
- **State transitions:**
    - Update the subscriber's state marking it as paused 

### 4.6.4. Resume

- **Actor:** Users of the Court
- **Inputs:** None
- **Authentication:** Open. Implicitly, only accounts that have paused their subscriptions can call this function
- **Pre-flight checks:**
    - Ensure that the sender was already subscribed
    - Ensure that the subscriber was paused 
    - Ensure that the number of paying periods covers the resume pre-paid periods and the previous delayed ones
- **State transitions:**
    - Update the subscriber's state  
    - Update the total amount of collected fees during the current period
    - Update the total amount of collected governor shares
    - Pull the corresponding amount of fee tokens for the owed number of periods from the sender to be deposited in the `Subscriptions` module, revert if the ERC20-transfer wasn't successful

### 4.6.5. Donate

- **Actor:** External entity willing to contribute to the Court deposits to be distributed among the participating jurors
- **Inputs:**
    - **Amount:** Amount of fee tokens willing to donate to the Court
- **Authentication:** Open. Implicitly, only accounts that have open an ERC20 allowance with the requested amount can call this function
- **Pre-flight checks:**
    - Ensure that the amount to donate is greater than zero
- **State transitions:**
    - Update the total amount of collected fees during the current period
    - Pull the corresponding amount of fee tokens from the sender to be deposited in the `Subscriptions` module, revert if the ERC20-transfer wasn't successful

### 4.6.6. Claim fees

- **Actor:** Jurors of the Court
- **Inputs:**
    - **Period ID:** Period identification number
- **Authentication:** Open. Implicitly, only jurors that have certain amount of ANJ tokens activated during the requested period can call this function
- **Pre-flight checks:**
    - Ensure that the requested period has already ended
    - Ensure that the sender has not claimed their fees for the requested period before
    - Ensure that the corresponding shares of the sender are greater than zero for the requested period
- **State transitions:**
    - Mark the sender has already claim their fees for the requested period
    - Transfer the corresponding portion of collected fees to the sender, revert if the ERC20-transfer wasn't successful

### 4.6.7. Transfer governor fees

- **Actor:** External entity in charge of maintaining the Court protocol
- **Inputs:** None
- **Authentication:** Open
- **Pre-flight checks:**
    - Ensure that the total amount of collected governor shares is greater than zero
- **State transitions:**
    - Reset the total amount of collected governor shares to zero
    - Transfer the governor shares to the config governor address, revert if the ERC20-transfer wasn't successful

### 4.6.8. Ensure period balance details

- **Actor:** External entity incentivized in updating the parameters to determine the jurors share fees for each period
- **Inputs:**
    - **Period ID:** Period identification number
- **Authentication:** Open
- **Pre-flight checks:**
    - Ensure that all the terms corresponding to the requested period were already been initialized for the Court
- **State transitions:**
    - Pick a random term checkpoint included in the requested period using the next period's start term randomness, and save the total ANJ active balance in the `JurorsRegistry` at that term for the requested period

### 4.6.9. Set fee amount

- **Actor:** External entity in charge of maintaining the Court protocol
- **Inputs:**
    - **Amount:** New fee token amount to set as the subscription fees per period
- **Authentication:** Only config governor
- **Pre-flight checks:**
    - Ensure that the fee token amount is greater than zero
- **State transitions:**
    - Update the subscriptions fee token amount

### 4.6.10. Set fee token

- **Actor:** External entity in charge of maintaining the Court protocol
- **Inputs:**
    - **Address:** Address of the new ERC20-compatible token to be set as the subscriptions fee token
    - **Amount:** New fee token amount to be set as the subscription fees per period
- **Authentication:** Only config governor
- **Pre-flight checks:**
    - Ensure that the fee token amount is greater than zero
    - Ensure that the fee token address is a contract
- **State transitions:**
    - If there were any share fees accumulated for the governor, transfer them and reset the governor share fees accumulator
    - Update the subscriptions fee token address and amount

### 4.6.11. Set pre payment periods

- **Actor:** External entity in charge of maintaining the Court protocol
- **Inputs:**
    - **New pre-payment periods:** New number of periods that can be paid in advance including the current period
- **Authentication:** Only config governor
- **Pre-flight checks:**
    - Ensure that the new pre-payment periods is greater than zero
    - Ensure that the new pre-payment periods is greater than or equal to the number of resume pre-paid periods
- **State transitions:**
    - Update the number of pre-payment periods

### 4.6.12. Set late payment penalty permyriad

- **Actor:** External entity in charge of maintaining the Court protocol
- **Inputs:**
    - **New late payments penalty permyriad:** New ‱ of the subscriptions fees to be charged for each period being payed late (1/10,000)
- **Authentication:** Only config governor
- **Pre-flight checks:** None
- **State transitions:**
    - Update the late payments penalty permyriad

### 4.6.13. Set governor share permyriad

- **Actor:** External entity in charge of maintaining the Court protocol
- **Inputs:**
    - **New governor share permyriad:** New ‱ of the subscriptions fees that will be saved for the governor (1/10,000)
- **Authentication:** Only config governor
- **Pre-flight checks:**
    - Ensure that the new governor share permyriad is not above 10,000‱
- **State transitions:**
    - Update the governor share permyriad

### 4.6.14. Set resume pre paid periods

- **Actor:** External entity in charge of maintaining the Court protocol
- **Inputs:**
    - **New resume pre-paid periods:** New number of periods that must be pre-paid to resume a previously paused subscription
- **Authentication:** Only config governor
- **Pre-flight checks:**
    - Ensure that the new number of resume pre-paid periods is lower than or equal to the maximum number of pre-payments allowed
- **State transitions:**
    - Update the number of resume pre-paid periods

### 4.6.15. Recover funds

- **Actor:** External entity in charge of maintaining the Court protocol
- **Inputs:**
    - **Token:** Address of the ERC20-compatible token to be recovered from the `Subscriptions` module
    - **Recipient:** Address that will receive the funds of the `Subscriptions` module
- **Authentication:** Only funds governor
- **Pre-flight checks:**
    - Ensure that the balance of the `Subscriptions` module is greater than zero
- **State transitions:**
    - Transfer the whole balance of the `Subscriptions` module to the recipient address, revert if the ERC20-transfer wasn't successful

