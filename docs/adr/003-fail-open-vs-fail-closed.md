# ADR-003: Fail Open vs Fail Closed

**Status**: accepted

## Context

The API relies on Redis to enforce distributed rate limits and Redis outages must not make the entire API unavailable.
However, **completely bypassing rate limiting could expose
backend services to excessive traffic**.

## Decision

We will adopt a fail-open strategy **with local in-memory rate limiting as a fallback**.

When Redis becomes unavailable, each API instance will temporarily enforce its own Token Bucket.

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
- Recovery requires switching back to distributed state.
- Local fallback cannot replace upstream DDoS protection.
