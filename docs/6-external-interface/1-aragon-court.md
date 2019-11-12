## 6.1. AragonCourt

### 6.1.1 Events

No custom events are implemented by `AragonCourt` 

### 6.1.2. Getters

The following functions are state getters provided by `AragonCourt`:

#### 6.1.2.1. Dispute fees

- **Inputs:** None 
- **Pre-flight checks:** None
- **Outputs:**
    **Recipient:** Address where the corresponding dispute fees must be transferred to
    **Fee token:** ERC20 token used for the fees
    **Fee amount:** Total amount of fees that must be allowed to the recipient

#### 6.1.2.2. Subscription fees

- **Inputs:** 
    **Subscriber:** Address of the account paying the subscription fees for
- **Pre-flight checks:** None
- **Outputs:**
    **Recipient:** Address where the corresponding subscriptions fees must be transferred to
    **Fee token:** ERC20 token used for the subscription fees
    **Fee amount:** Total amount of fees that must be allowed to the recipient
