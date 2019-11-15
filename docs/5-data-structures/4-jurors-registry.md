## 5.3. Jurors Registry

The following objects are the data-structures used by the `JurorsRegistry`:

### 5.3.1. Juror

The juror object includes the following fields:

- **ID:** Identification number of each juror
- **Locked balance:** Maximum amount of tokens that can be slashed based on the juror's drafts
- **Active balance:** Tokens activated for the Court that can be locked in case the juror is drafted
- **Available balance:** Available tokens that can be withdrawn at any time
- **Withdrawals lock term ID**: Term identification number until which juror's withdrawals will be locked
- **Deactivation request**: Pending deactivation request of a juror

### 5.3.2. Deactivation request

The deactivation request object includes the following fields:

- **Amount:** Amount requested for deactivation
- **Available termId:** ID of the term when jurors can withdraw their requested deactivation tokens
