# 09 — Verify outages, bounded fallback, and recovery

**Status**: Not implemented

## Description

Run scoped Redis failure experiments to show availability, partial local protection, and restoration of shared enforcement.

## Acceptance criteria

- Cover unreachable Redis at startup, failure during traffic, timeout, and recovery.
- Show successful fallback requests and local 429s after exhaustion. Normal refill continues; the 25% initial balance is not a total outage cap.
- Verify recovery with retained and lost Redis state, and local-state retention across repeated outages.
- Record transition behavior and uncertain outcomes without claiming global consistency. Always restore disposable infrastructure after fault injection.

## Dependencies

08.

## Expected tests

- Default local initial balance of 25 per fresh instance; controlled-time exhaustion and refill.
- Bounded dependency waiting, recovery to shared enforcement, no uncertain-write retry, and no new local allocation on every failure.
- Post-recovery concurrency check and cleanup after a failed assertion.
