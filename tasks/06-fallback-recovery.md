# 06 — Coordinate fallback and recovery through the HTTP boundary

## Description

Wire Redis and the local store into a fallback path using connection status and periodic recovery checks. Integrate this flow into the HTTP application and verify its response contract during fallback and after recovery.

## Acceptance criteria

- Use Redis normally; connection failures/timeouts use local limits, including when Redis is unavailable at startup. Redis denials never receive a second local chance.
- While using fallback, check recovery once per second by default, with bounded waits and no overlapping probes; settings are configurable.
- On recovery, use surviving Redis state without merging local consumption. Missing Redis buckets start full; retain local state for later outages.
- After an uncertain Redis outcome, make at most one local decision for that request. Do not retry consumption or change a completed response.
- Avoid stale recovery results reversing current connectivity decisions; use only the guard needed for this flow. Stop recovery work on shutdown.
- Wire fallback into the HTTP application from task 05. Apply the same 200/429, error-body, RateLimit-Policy, RateLimit, and Retry-After semantics using the local decision; allowed requests reach the handler and denied requests do not.
- Invalid/unknown keys and health requests do not consume local tokens. Health stays 200 during outages while the process can serve; internal errors expose no sensitive details.

## Dependencies

03, 04, 05.

## Expected tests

- Healthy Redis, startup/runtime outage, local exhaustion, recovery, and repeated failures.
- Concurrent failures/recovery checks do not duplicate consumption, probes, or initial local allocations.
- A delayed result cannot alter a completed request or undo a newer connectivity decision.
- HTTP success, denial, refill, key isolation, policy overrides, and handler invocation counts during fallback.
- Exact limit/remaining headers, retry rounding, and 429 body during fallback; unchanged HTTP semantics after recovery.
- Invalid/unknown keys and health bypass local consumption; health remains reachable during outages and shutdown stops recovery work.
