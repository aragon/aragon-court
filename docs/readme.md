# Aragon Court v1 - Technical spec

The following documents attempt to be a high-level description of the inner workings on the Aragon Court v1 implementation. It doesn't go deep to the point of being an exhaustive spec detailing all authentication checks and state transitions but provides a description that a developer could use to re-implement it or deeply understand the codebase.

This document was written to ease the job of security auditors looking at the codebase, and it was written after the implementation had been frozen.

The core of the document is organized around the external entry points to the system across the different modules.

## Table of Contents

1. [Mechanism](./1-mechanism)
2. [Architecture](./2-architecture)
3. [Trust assumptions](./3-trust-assumptions)
4. [Entry points](./4-entry-points)
5. [Data structures](./5-data-structures)
6. [Additional documentation](./6-additional-documentation)
