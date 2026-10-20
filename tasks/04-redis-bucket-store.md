# 04 — Implement the atomic Redis bucket store and connection lifecycle

**Status**: Not implemented

## Description

Deliver an application-ready Redis store: one Lua operation reads, refills, consumes, and persists the shared bucket, and a typed adapter handles results, bounded waits, and connection lifecycle. Fallback coordination belongs to task 06.

## Acceptance criteria

- Store `tokens` and `last_refill`; a missing bucket starts full. Address each client bucket in a documented shared namespace.
- Use Redis `TIME` for shared refill and match task 03 reference cases, including fractional refill on denials.
- Return the decision and balance together; do not read/modify/write the bucket separately in application code.
- Refresh idle TTL on every decision to the empty-bucket refill interval rounded up: `ceil(capacity * 60000 / refillPerMinute)` milliseconds.
- Return a typed decision; a valid denial is not a dependency failure.
- Default the configurable attempt timeout to 20ms, including connection waiting. Disable offline consumption queues and automatic retry after uncertain consumption.
- Connection failures/timeouts can activate fallback. Configuration, credential, script, or malformed-result errors remain explicit errors.
- Reuse connections and close them at shutdown. If script caching is used, handle cache loss without retrying an uncertain write.

## Dependencies

02, 03.

## Expected tests

- Real Redis tests for refill, denial, key isolation, persisted fractional state, and idle expiry.
- Concurrent callers cannot consume more tokens than available; control or account for elapsed refill.
- Verify returned metadata and token bounds. Do not expose a client-controlled production clock for testing.
- Unit tests for decoded decisions, timeout, failure classification, and no automatic uncertain-write retry.
- Real Redis checks for normal calls, connection loss/recovery, and shutdown; cache loss only if caching is implemented.
