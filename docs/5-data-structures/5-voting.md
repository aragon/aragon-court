## 5.4. Voting

The following objects are the data-structures used by the `Voting`:

### 5.4.1. Juror

The juror object includes the following fields:

- **Winning outcome:** Outcome winner of a vote instance
- **Max allowed outcome:** Highest outcome allowed for the vote instance
- **Cast votes:** List of cast votes indexed by voters addresses
- **Outcomes tally:** Tally for each of the possible outcomes

### 5.4.2. Cast vote

The cast vote object includes the following fields:

- **Commitment:** Hash of the outcome casted by the voter
- **Outcome:** Outcome submitted by the voter
