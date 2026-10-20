# 03 — Implement the local Token Bucket and reference tests

**Status**: Not implemented

## Description

Implement the small, I/O-independent Token Bucket calculation and a typed decision usable by the local and Redis paths. Use it in a bounded process-local map for registered keys. Fallback coordination belongs to task 06.

## Acceptance criteria

- Refill by elapsed time, preserve fractional tokens, and cap at capacity. An allowed request consumes one token; a denial consumes none.
- Persist recalculated balance/time on denials too. Backward time must not grant tokens or move the previous timestamp backward.
- Return the decision, fractional balance, and time until one token; HTTP remaining tokens are rounded down.
- Support a full initial balance for Redis and 25% rounded up for local fallback.
- Allocate only for registered keys, initially `ceil(capacity * 0.25)`. Keep the normal maximum capacity and refill rate.
- Keep at most one bucket per configured key until shutdown, with no eviction or per-bucket timers.
- Use an injectable monotonic clock. Retain balances across outages and account for elapsed time, including healthy periods, on reuse.
- Concurrent calls in the same process must not double-spend tokens.

## Dependencies

01, 02.

## Expected tests

- Default burst of 100, first denial, partial refill, and one new token after 600ms.
- Capacity cap, changed policy values, repeated same-time calls, backward time, and local initialization for capacities 100/10/1.
- Reuse the same reference cases to verify both stores.
- Reference cases, independent keys, local exhaustion, and concurrent last-token consumption.
- Repeated outages do not grant a new initial balance; long idle periods can replenish to full capacity.
- Unknown keys allocate nothing; process restart begins with the configured local initial balance.
