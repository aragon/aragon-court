# Aragon Court subgraph configuration

### Blacklisted modules

Handling different versions of a contract is not easy. 
Since Aragon Court's architecture supports deprecating existing modules or introducing new ones to the system, making sure we handle emitted events while being backwards compatible is not an easy task.

Since there are some cases where the trade off is not optimal, we decided to introduce the concept of blacklisted modules. This allows us to specify which are the modules of Aragon Court that we want to exclude from the system.
The blacklisted modules are defined as a [list of addresses](./blacklisted-modules.js) that will be taken into account at deployment time to make sure we exclude them from the list of contracts whose events are being tracked.
