# 03 — Integrate library rate limiting with the HTTP API

**Status**: Implemented

## Description

Use `express-rate-limit`, `rate-limit-redis`, and the native Redis client directly. Keep application construction separate from executable startup.

## Acceptance criteria

- Validate one `X-API-Key`, select its policy, and apply shared fixed-window counting before `GET /api/resource`.
- Return 200 for allowed requests and 429 with the library's headers and `Retry-After` when exhausted.
- Keep `GET /health` outside limiting; use a small JSON error response for HTTP failures.
- Allow requests without limiter headers when the store fails. Log failures without exposing keys or credentials.
- Disable offline request queues, bound command waiting, and let the client reconnect automatically.
- Restore counting after both startup and runtime outages, without adding local fallback or recovery probes.
- On shutdown, drain HTTP requests for at most ten seconds, then close Redis. Imports must not start the service.

## Dependencies

2.

## Expected tests

- Invalid/unknown keys, policy selection, allowance, denial, headers, health bypass, and fail-open logging.
- Process shutdown, active-request draining, and repeated signals.
- Real Redis tests for shared limits and startup/runtime outage recovery.
