# Aragon Court v1 - Technical spec

The following documents attempt to be a high-level description of the inner implementation details of Aragon Court v1. It doesn't go deep to the point of being an exhaustive spec detailing all authentication checks and state transitions, but aims to provide enough description for a developer to deeply understand the existing codebase or guide a re-implementation.

This document was written to ease the job of security auditors looking at the codebase and was written after the v1 implementation had been frozen.

The core of the document is organized around the external entry points to the system across the different modules.

## Table of Contents

1. [Mechanism](./1-mechanism)
2. [Architecture](./2-architecture)
3. [Crypto-economic considerations](./3-cryptoeconomic-considerations)
4. [Entry points](./4-entry-points)
5. [Data structures](./5-data-structures)
6. [External interface](./6-external-interface)
7. [Additional documentation](./7-additional-documentation)
8. [Testing guide](./8-testing-guide)
