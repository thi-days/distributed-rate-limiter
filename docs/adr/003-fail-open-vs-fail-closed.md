# ADR-003: Fail Open vs Fail Closed

**Status**: accepted

## Context

The API relies on Redis to enforce distributed rate limits and Redis outages must not make the entire API unavailable.
However, **completely bypassing rate limiting could expose
backend services to excessive traffic**.

## Decision

Use `express-rate-limit` with `passOnStoreError: true`: allow valid clients' requests when the Redis store reports an error. A normal denial still returns 429.

There is no local fallback. The API remains available, but it has no rate-limit protection during store failures. This also applies to store configuration errors, so failure logs matter.

The native Redis client reconnects automatically. When Redis returns, shared counting resumes without counting requests served during the outage. Lost counters start fresh.

For costly backend operations, an available Redis deployment and conservative local limits can reduce the risk of overload; rejecting requests can be appropriate when a strict budget matters more than availability. Those measures add infrastructure or failure coordination. They are deliberately excluded to keep this demonstration small.

## Alternatives Considered

| Algorithm      | Reason for rejection                                                                           |
| -------------- | ---------------------------------------------------------------------------------------------- |
| Fail Closed    | It would make the API unavailable to legitimate clients during Redis outages.                  |
| Local fallback | Provides partial protection, but adds separate budgets and recovery behavior beyond this demo. |

## Consequences

Positive:

- Improves API availability even during Redis outages.
- Avoids a second limiter and custom recovery coordination.
- Does not require a secondary external data store.

Negative:

- All rate-limit protection is lost during store failures.
- Excess traffic can overload the backend during an outage.
- Requests made during the outage are not counted after recovery; lost counters start fresh.
- This limiter does not replace upstream DDoS protection.
