# ADR-001: Redis vs in memory cache

**Status**: accepted

## Context

The solution must:

1. Not introduce a significant latency
2. Enforce shared rate-limits accross multiple instances
3. Support concurrent requests

## Decision

1. We will use a Redis instance **shared accross all instances**.
2. An external Redis approach was chosen instead of locally in-memory because **the rate-limit should be consistent** regardless instance the request is being processed.
3. `rate-limit-redis` performs atomic counting and expiry so concurrent requests across instances share one allowance.

## Alternatives Considered

| Alternative  | Reason for rejection                                 |
| ------------ | ---------------------------------------------------- |
| In Memory    | The rate-limit data is not synced accross instances  |
| Database     | Introduces more latency and complexity.              |
| File Storage | Adds more latency and makes hard to keep consistency |

## Consequences

Positive:

- Allow horizontal scaling
- Ensure consistency across multiple instances
- Uses the library's atomic counter updates

Negative:

- Adds a network operation and local measurements depend on the environment
- Requires additional infra dependency
- Failures affect API availability or rate-limit enforcement (it depends on the decision made)
- Its deployment affects overall availability and consistency guarantees
