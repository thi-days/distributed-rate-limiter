# 05 — Deliver the minimal HTTP API with Redis rate limiting

**Status**: Not implemented

## Description

Create the Express 5 demonstration resource, client identification, and lifecycle following ADR-004. Add Express and matching TypeScript types with locked dependencies in this task; retain the existing build and Node.js test toolchain. Apply the Redis limiter once per resource request and translate its decision into the HTTP response. Deliver the healthy Redis path here; task 06 adds fallback and verifies the same HTTP contract during outages.

## Acceptance criteria

- Separate application construction from server startup and signal handling. Inject limiter dependencies for tests; keep policy/store/algorithm modules free of Express types and use no generic rate-limiting package.
- Scope key validation, policy lookup, and limiting to the resource route, in that order. Call `next()` exactly once on allowance; return after sending a denial. Health requests bypass the entire chain.
- Count API-key fields case-insensitively using `req.rawHeaders` before reading the parsed value; do not rely solely on `req.get()` or normalized headers to detect duplicates. Key values remain case-sensitive. Validate the value delivered by Node's HTTP parser without introducing a new key grammar.
- Return/await asynchronous middleware promises so Express 5 forwards rejection to a final four-argument JSON error handler. Handle synchronous throws too; delegate when headers are already sent and never send a second response or retry consumption.
- Leave `trust proxy` disabled. Bucket identity comes exclusively from the API key, independent of IP and forwarded headers.
- `GET /api/resource` returns 200 with `{"message":"ok"}`. Read exactly one nonempty, case-sensitive `X-API-Key` token without whitespace; no authentication is introduced.
- Missing/malformed/duplicate keys return 400; well-formed unregistered keys return 403, before store access.
- Use a small JSON error envelope `{"error":{"code":"..."}}`: `INVALID_API_KEY`, `UNKNOWN_API_KEY`, `RATE_LIMIT_EXCEEDED`, or `INTERNAL_ERROR`. Internal errors return 500 without sensitive details.
- `GET /health` bypasses key validation/limiting and stays 200 during Redis outages while the process can serve.
- Support a configurable port and safe instance identification for experiments. Retain the HTTP server handle; on SIGTERM/SIGINT, stop accepting requests, drain active work within a documented bounded deadline, and close Redis after draining; force-close remaining connections at the deadline. Shutdown is idempotent. Importing the application must not listen or register process handlers.
- Allowed requests reach the handler; exhausted buckets return 429 without invoking it.
- On resource 200/429, emit `RateLimit-Policy: "token-bucket";q=C` and `RateLimit: "token-bucket";r=N`, where C is capacity and N is post-decision balance rounded down.
- Use pinned Internet-Draft 11, not a published RFC. Omit optional window/reset/partition parameters rather than implying a strict-window policy.
- On 429 only, include `Retry-After` until one token, rounded up to seconds with minimum 1. Use the error envelope above; no limiter headers are needed without a valid decision.

## Dependencies

01, 02, 04.

## Expected tests

- Resource response, single/duplicate/invalid/unknown keys, case-sensitive lookup, and error envelopes. Send actual duplicate fields, including mixed-case names, with a Node HTTP client rather than a helper that merges them.
- Use the existing Node.js test runner and native HTTP clients against ephemeral-port servers; close servers and clients in teardown. No additional test framework is needed.
- Middleware ordering, exactly one decision per resource request, no handler on denial, and no store access on validation failure.
- Synchronous throws and asynchronous rejections reach the JSON error handler without unhandled rejections or duplicate responses; exercise errors after headers are sent without attempting another JSON response.
- Forwarded-header changes do not change bucket identity. Application imports have no startup side effects; shutdown drains active work, enforces its deadline, and tolerates repeated signals.
- Health bypass during outages, instance identification, and clean shutdown.
- Success, first denial, refill, key isolation, policy overrides, and handler invocation counts.
- Exact limit/remaining headers, retry rounding, and 429 body using Redis.
- Invalid/unknown keys and health requests do not consume tokens; internal errors do not leak details.
