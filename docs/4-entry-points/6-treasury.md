## 4.6. Treasury

The `Treasury` module is in charge of handling the token assets related to the disputes process. 
The ANJ of the jurors and the subscription fees of the users are the only assets excluded from the `Treasury`. 
Except from those, the rest of the fees, deposits, and collaterals required to back the different adjudication rounds of a dispute, are stored in the `Treasury`.  

### 4.6.1. Constructor

- **Actor:** Deployer account
- **Inputs:**
    - **Controller:** Address of the `Controller` contract that centralizes all the modules being used
- **Authentication:** Open
- **Pre-flight checks:**
    - Ensure that the controller address is a contract
- **State transitions:**
    - Save the controller address

### 4.6.2. Assign

- **Actor:** `Court` module
- **Inputs:**
    - **Token:** Address of the ERC20-compatible token to be withdrawn
    - **Recipient:** Address that will receive the funds being withdrawn
    - **Amount:** Amount of tokens to be transferred to the recipient
- **Authentication:** Only `Court` module
- **Pre-flight checks:**
    - Ensure that the requested amount is greater than zero
- **State transitions:**
    - Increase the token balance of the recipient based on the requested amount

### 4.6.3. Withdraw

- **Actor:** External entity owning a certain amount of tokens of the `Treasury` module
- **Inputs:**
    - **Token:** Address of the ERC20-compatible token to be withdrawn
    - **Recipient:** Address that will receive the funds being withdrawn
    - **Amount:** Amount of tokens to be transferred to the recipient
- **Authentication:** Open. Implicitly, only addresses that have some balance assigned in the `Treasury` module
- **Pre-flight checks:**
    - Ensure that the token balance of the caller is greater than zero
    - Ensure that the token balance of the caller is greater than or equal to the requested amount
- **State transitions:**
    - Reduce the token balance of the caller based on the requested amount
    - Transfer the requested token amount to the recipient address, revert if the ERC20-transfer wasn't successful

### 4.6.4. Withdraw all

- **Actor:** External entity incentivized in transfer the funds of a certain address
- **Inputs:**
    - **Token:** Address of the ERC20-compatible token to be withdrawn
    - **Recipient:** Address whose funds will be transferred
- **Authentication:** Open
- **Pre-flight checks:**
    - Ensure that the token balance of the recipient address is greater than zero
- **State transitions:**
    - Set the token balance of the recipient to zero
    - Transfer the whole balance of the recipient address to it, revert if the ERC20-transfer wasn't successful

### 4.6.5. Recover funds

- **Actor:** External entity in charge of maintaining the Court protocol
- **Inputs:**
    - **Token:** Address of the ERC20-compatible token to be recovered from the `Treasury` module
    - **Recipient:** Address that will receive the funds of the `Treasury` module
- **Authentication:** Only funds governor
- **Pre-flight checks:**
    - Ensure that the balance of the `Treasury` module is greater than zero
- **State transitions:**
    - Transfer the whole balance of the `Treasury` module to the recipient address, revert if the ERC20-transfer wasn't successful
