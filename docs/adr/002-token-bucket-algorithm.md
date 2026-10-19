# ADR-002: Use Token Bucket for Rate Limiting

**Status**: accepted

## Context

This API requires a rate-limiting that:

1. Has a configurable request rate per API Key
2. Allows occasional traffic bursts
3. Works accross multiple instances
4. Introduces a minimal latency to the original implementation

## Decision

1. We will use the Token Bucket to enforce the request limit.
2. Each API key will have a bucket with a configurable capacity and refill rate.
3. The Token Bucket was chosen because it does both allow controlled bursts and enforce the limit.

## Alternatives Considered

| Algorithm      | Reason for rejection                                                               |
| -------------- | ---------------------------------------------------------------------------------- |
| Fixed Window   | Allows large bursts around window boundaries.                                      |
| Sliding Window | Better control over rolling windows, but not necessary for our burst requirements. |
| Leaky Bucket   | Smoothing traffic is less important than allowing controlled bursts.               |

## Consequences

Positive:

- Supports controlled traffic bursts.
- Allows configurable request rates.
- Requires relatively little state per API Key.

Negative:

- Requires careful handling of concurrent updates.
- Distributed implementations require shared state or coordination.
- Does not guarantee a strict maximum number of requests within every rolling time window.
