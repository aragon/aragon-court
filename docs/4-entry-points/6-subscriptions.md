# 4.6. Subscriptions

The `Subscriptions` module is in charge of handling the subscription fees paid by the users to use Aragon Court.
This module is where the subscription fees are paid, stored, and redistributed to the corresponding parties: jurors and the governor.

In the beginning, when v1.0 of Aragon Court was deployed, the subscription fees were simply flat recurring fees per organization.
The intention of this subscription fee model was to address the issue that the value provided by Aragon Court is realized for organizations 
on an ongoing basis, but the need to actually escalate disputes to Aragon Court should be relatively rare. Similar to insurance, paying for 
coverage on an ongoing basis helps to create more stable costs for users, and more predictable revenue for service providers. 
However, the flat subscription model doesn’t scale based on usage, risk, or value provided. The result is that it is difficult to appropriately 
price a flat subscription fee, as it may be almost negligible for a large organization like the Aragon Network, but if it is set higher than 
it will price out a much longer tail of organizations.

That said, a new mechanism based on transaction fees was [proposed](https://forum.aragon.org/t/request-for-comment-proposal-to-adjust-the-court-subscription-fee-mechanism/2163) instead.
The idea is for organizations to pay fees in advance based on their on-going actions in case these could be disputed, similar to an insurance 
mechanism. For example, a Voting app can be integrated with Aragon Court using transaction fees so its votes can be challenged in court. Thus, 
the idea is to allow Aragon Court to define transaction fees for each different Aragon app to make sure that:
- The more an organization’s members use this integration, the more they pay to Aragon Court
- It abstracts the need to worry about fees from the organization perspective, users will pay for the fees as they interact with the organization
- It enables the organization to fund itself based on people interacting with it

Additionally, the new transaction fees mechanism carries the concept of a trusted model. Users of Aragon Court won't be enforced on-chain to pay 
this type of fee, but it is guaranteed that relevant information is exposed to jurors so these can decide how to organize themselves when 
the corresponding transaction fees are paid. 

Apart from the subscription fees described above, a donations model is also supported in this module. It allows users to donate funds to the 
jurors of Aragon Court. This was mostly used during the [precedence campaign](https://aragon.org/blog/precedence-campaign-primer), but it is 
still available for future potential usages.


### 4.6.1. Constructor

- **Actor:** Deployer account
- **Inputs:**
    - **Controller:** Address of the `Controller` contract that centralizes all the modules being used
    - **Period duration:** Duration of a subscription period in Court terms
    - **Fee token:** Initial ERC20-compatible token to be set as the subscriptions fee token
    - **Governor share permyriad:** Initial ‱ of the subscriptions fees that will be saved for the governor (1/10,000)
- **Authentication:** Open
- **Pre-flight checks:**
    - Ensure that the controller address is a contract
    - Ensure that the period duration is greater than zero
    - Ensure that the fee token address is a contract
    - Ensure that the new governor share permyriad is not above 10,000‱
- **State transitions:**
    - Save the controller address
    - Save the period duration
    - Save the subscriptions fee token address
    - Save the governor share permyriad

### 4.6.2. Pay app fees

- **Actor:** Users of the Court
- **Inputs:**
    - **App ID:** Identification number of the app whose fees are being paid
    - **Data:** Optional data to be logged
- **Authentication:** Open. Implicitly, only accounts that have open an ERC20 allowance with an amount equivalent to the fees corresponding to requested number of periods can call this function
- **Pre-flight checks:**
    - Ensure that the fees are set for the requested app
- **State transitions:**
    - Update the total amount of collected fees during the current period
    - Update the total amount of collected governor shares during the current period
    - Pull the corresponding amount of fee tokens for the requested number of periods from the sender to be deposited in the `Subscriptions` module, revert if the ERC20-transfer wasn't successful

### 4.6.3. Donate

- **Actor:** External entity willing to contribute to the Court deposits to be distributed among the participating jurors
- **Inputs:**
    - **Amount:** Amount of fee tokens willing to donate to the Court
- **Authentication:** Open. Implicitly, only accounts that have open an ERC20 allowance with the requested amount can call this function
- **Pre-flight checks:**
    - Ensure that the amount to donate is greater than zero
- **State transitions:**
    - Update the total amount of collected fees during the current period
    - Pull the corresponding amount of fee tokens from the sender to be deposited in the `Subscriptions` module, revert if the ERC20-transfer wasn't successful

### 4.6.4. Claim fees

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

### 4.6.5. Transfer governor fees for current period

- **Actor:** External entity in charge of maintaining the Court protocol
- **Inputs:** None
- **Authentication:** Open
- **Pre-flight checks:**
    - Ensure that the total amount of collected governor shares is greater than zero
- **State transitions:**
    - Reset the total amount of collected governor shares to zero
    - Transfer the governor shares to the config governor address, revert if the ERC20-transfer wasn't successful

### 4.6.6. Transfer governor fees

- **Actor:** External entity in charge of maintaining the Court protocol
- **Inputs:**
    - **Period ID:** Period identification number
- **Authentication:** Check the given period is a past period
- **Pre-flight checks:**
    - Ensure that the total amount of collected governor shares is greater than zero
- **State transitions:**
    - Reset the total amount of collected governor shares to zero
    - Transfer the governor shares to the config governor address, revert if the ERC20-transfer wasn't successful

### 4.6.7. Ensure period balance details

- **Actor:** External entity incentivized in updating the parameters to determine the jurors share fees for each period
- **Inputs:**
    - **Period ID:** Period identification number
- **Authentication:** Open
- **Pre-flight checks:**
    - Ensure that all the terms corresponding to the requested period were already been initialized for the Court
- **State transitions:**
    - Pick a random term checkpoint included in the requested period using the next period's start term randomness, and save the total ANJ active balance in the `JurorsRegistry` at that term for the requested period

### 4.6.8. Set fee token

- **Actor:** External entity in charge of maintaining the Court protocol
- **Inputs:**
    - **Address:** Address of the new ERC20-compatible token to be set as the subscriptions fee token
- **Authentication:** Only config governor
- **Pre-flight checks:**
    - Ensure that the fee token address is a contract
- **State transitions:**
    - Update the subscriptions fee token address

### 4.6.8. Set app fee

- **Actor:** External entity in charge of maintaining the Court protocol
- **Inputs:**
    - **App ID:** App identifier
    - **Token:** Fee token address
    - **Amount:** New fee token amount to be set for the requested app
- **Authentication:** Only config governor
- **Pre-flight checks:**
    - Ensure that the fee token amount is greater than zero
    - Ensure that the fee token address is the same as the one defined in the subscription module
- **State transitions:**
    - Update the app fee amounts for the requested app

### 4.6.9. Set apps fees

- **Actor:** External entity in charge of maintaining the Court protocol
- **Inputs:**
    - **App IDs:** List of app identifiers
    - **Tokens:** List of fee token address
    - **Amounts:** List of new fee token amounts to be set for the requested apps
- **Authentication:** Only config governor
- **Pre-flight checks:**
    - Ensure that all the fee token amounts are greater than zero
    - Ensure that the list of fee token addresses is empty
- **State transitions:**
    - Update the app fee amounts for all the requested apps

### 4.6.10. Unset app fee

- **Actor:** External entity in charge of maintaining the Court protocol
- **Inputs:**
    - **App ID:** App identifier
- **Authentication:** Only config governor
- **Pre-flight checks:**
    - Ensure that the requested app has a fee set
- **State transitions:**
    - Remove the fee for the requested app

### 4.6.11. Unset apps fees

- **Actor:** External entity in charge of maintaining the Court protocol
- **Inputs:**
    - **App IDs:** List of app identifiers
- **Authentication:** Only config governor
- **Pre-flight checks:**
    - Ensure that all the requested apps have a fee set
- **State transitions:**
    - Remove the fees for the requested apps

### 4.6.12. Set governor share permyriad

- **Actor:** External entity in charge of maintaining the Court protocol
- **Inputs:**
    - **New governor share permyriad:** New ‱ of the subscriptions fees that will be saved for the governor (1/10,000)
- **Authentication:** Only config governor
- **Pre-flight checks:**
    - Ensure that the new governor share permyriad is not above 10,000‱
- **State transitions:**
    - Update the governor share permyriad

### 4.6.13. Recover funds

- **Actor:** External entity in charge of maintaining the Court protocol
- **Inputs:**
    - **Token:** Address of the ERC20-compatible token to be recovered from the `Subscriptions` module
    - **Recipient:** Address that will receive the funds of the `Subscriptions` module
- **Authentication:** Only funds governor
- **Pre-flight checks:**
    - Ensure that the balance of the `Subscriptions` module is greater than zero
- **State transitions:**
    - Transfer the whole balance of the `Subscriptions` module to the recipient address, revert if the ERC20-transfer wasn't successful

