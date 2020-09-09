## 5.5. Subscriptions

The following objects are the data-structures used by the `Subscriptions`:

### 5.5.1. Period

The period object includes the following fields:

- **Fee token:** Address of the fee token corresponding to a certain subscription period
- **Claimed fees:** List of jurors that have claimed fees during a period, indexed by juror address
- **Collected fees:** Total amount of subscription fees collected during a period
- **Balance checkpoint:** Term identification number of a period used to fetch the total active balance of the jurors registry
- **Total active balance:** Total amount of juror tokens active in the Court at the corresponding period checkpoint
- **Accumulated governor fees:** Total amount of fees accumulated for the governor of the Court during a period

