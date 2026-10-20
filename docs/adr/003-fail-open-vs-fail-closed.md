# ADR-003: Fail Open vs Fail Closed

**Status**: accepted

## Context

The API relies on Redis to enforce distributed rate limits and Redis outages must not make the entire API unavailable.
However, **completely bypassing rate limiting could expose
backend services to excessive traffic**.

## Decision

We will adopt a fail-open strategy **with local in-memory rate limiting as a fallback**.

When Redis has a connection failure or timeout, each API instance temporarily enforces its own Token Bucket. A valid Redis denial does not trigger fallback.

Local buckets begin with 25% of capacity, rounded up, while keeping normal refill and maximum capacity. State is retained across outages until the process exits, avoiding a fresh allocation on every connection failure.

When Redis recovers, shared limiting resumes without merging local consumption. The trade-off favors availability and partial protection over global consistency during the outage.

## Alternatives Considered

| Algorithm      | Reason for rejection                                                          |
| -------------- | ----------------------------------------------------------------------------- |
| Fail Closed    | It would make the API unavailable to legitimate clients during Redis outages. |
| Pure Fail Open | It removes traffic protection during infrastructure failures.                 |

## Consequences

Positive:

- Improves API availability even during Redis outages.
- Maintains partial protection against excessive traffic.
- Does not require a secondary external data store.

Negative:

- Global rate limiting is not guaranteed during fallback.
- Different instances may allow different request volumes.
- Recovery uses surviving Redis state; lost buckets restart full, potentially granting extra budget.
- Local fallback cannot replace upstream DDoS protection.
