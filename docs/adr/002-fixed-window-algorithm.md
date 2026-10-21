# ADR-002: Use a Fixed Window for Rate Limiting

**Status**: accepted

## Context

This API requires a rate-limiting that:

1. Has a configurable request rate per API Key
2. Is easy to explain and reproduce in a small demonstration
3. Works accross multiple instances
4. Introduces a minimal latency to the original implementation

## Decision

1. Use `express-rate-limit` with `rate-limit-redis` to count requests in one-minute windows.
2. Each API key has a configurable request allowance; its window starts on its first request.
3. Delegate atomic counting, expiry, and response headers to the libraries rather than maintain a custom algorithm.

## Alternatives Considered

| Algorithm      | Reason for rejection                                                                       |
| -------------- | ------------------------------------------------------------------------------------------ |
| Token Bucket   | Useful for gradual refill, but custom refill and store code add little value to this demo. |
| Sliding Window | Smoother control over rolling windows; the extra precision is unnecessary for this demo.   |
| Leaky Bucket   | Adds request pacing that this demonstration does not require.                              |

## Consequences

Positive:

- Keeps the demonstration small and easy to explain.
- Allows configurable request rates.
- Reuses the library's shared counter and expiry behavior.

Negative:

- Requests can cluster on both sides of a reset; sliding windows suit stricter rolling limits.
- Distributed implementations require shared state or coordination.
- Does not guarantee a strict maximum number of requests within every rolling time window.
