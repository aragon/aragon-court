## 5.5. Subscriptions

The following objects are the data-structures used by the `Subscriptions`:

### 5.5.1. Period

The period object includes the following fields:

- **Fee token:** Fee token corresponding to a certain subscription period
- **Fee amount:** Amount of fees paid for a certain subscription period
- **Claimed fees:** List of jurors that have claimed fees during a period, indexed by juror address
- **Collected fees:** Total amount of subscription fees collected during a period
- **Balance checkpoint:** Term identification number of a period used to fetch the total active balance of the jurors registry
- **Total active balance:** Total amount of juror tokens active in the Court at the corresponding period checkpoint

### 5.5.2. Subscriber

The subscriber object includes the following fields:

- **Subscribed:** Whether or not a user has been subscribed to the Court
- **Paused:** Whether or not a user has paused the Court subscriptions
- **Last payment period ID:** Identification number of the last period paid by a subscriber
- **Previous delayed periods:** Number of delayed periods before pausing

