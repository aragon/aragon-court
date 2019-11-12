## 5.3. Disputes Manager

The following objects are the data-structures used by the `DisputesManager`:

### 5.3.1. Dispute

The dispute object includes the following fields:

- **Subject:** Arbitrable instance associated to a dispute
- **Possible rulings:** Number of possible rulings jurors can vote for each dispute
- **Final ruling:** Winning ruling of a dispute
- **Dispute state:** State of a dispute: pre-draft, adjudicating, or ruled
- **Adjudication rounds:** List of adjudication rounds for each dispute

### 5.3.2. Adjudication round

The adjudication round object includes the following fields:

- **Draft term ID:** Term from which the jurors of a round can be drafted
- **Jurors number:** Number of jurors drafted for a round
- **Settled penalties:** Whether or not penalties have been settled for a round
- **Juror fees:** Total amount of fees to be distributed between the winning jurors of a round
- **Jurors:** List of jurors drafted for a round
- **Jurors states:** List of states for each drafted juror indexed by address
- **Delayed terms:** Number of terms a round was delayed based on its requested draft term id
- **Selected jurors:** Number of jurors selected for a round, to allow drafts to be batched
- **Coherent jurors:** Number of drafted jurors that voted in favor of the dispute final ruling
- **Settled jurors:** Number of jurors whose rewards were already settled
- **Collected tokens:** Total amount of tokens collected from losing jurors
- **Appeal:** Appeal-related information of a round

### 5.3.3. Juror state

The juror state object includes the following fields:

- **Weight:** Weight computed for a juror on a round
- **Rewarded:** Whether or not a drafted juror was rewarded

### 5.3.4. Appeal

The appeal object includes the following fields:

- **Maker:** Address of the appealer
- **Appealed ruling:** Ruling appealing in favor of
- **Taker:** Address of the one confirming an appeal
- **Opposed ruling:** Ruling opposed to an appeal
- **Settled:** Whether or not an appeal has been settled
