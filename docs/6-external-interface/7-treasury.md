## 6.7. Treasury

### 6.7.1 Events

The following events are emitted by the `Treasury`:

#### 6.7.1.1. Assign

- **Name:** `Assign`
- **Args:**
    - **Token:** Address of the ERC20 token assigned
    - **From:** Address of the account that has deposited the tokens
    - **To:** Address of the account that has received the tokens
    - **Amount:** Number of tokens assigned to the recipient account

#### 6.7.1.2. Withdraw

- **Name:** `Withdraw`
- **Args:**
    - **Token:** Address of the ERC20 token withdrawn
    - **From:** Address of the account that has withdrawn the tokens
    - **To:** Address of the account that has received the tokens
    - **Amount:** Number of tokens withdrawn to the recipient account

### 6.7.2. Getters

The following functions are state getters provided by the `Treasury`:

#### 6.7.2.1. Balance of

- **Inputs:**
    - **Token:** Address of the ERC20 token querying a holder's the balance of
    - **Holder:** Address of account querying the balance of
- **Pre-flight checks:** None
- **Outputs:**
    - **Balance:** Amount of tokens the holder owns
