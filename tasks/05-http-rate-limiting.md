# 05 — Deliver the minimal HTTP API with Redis rate limiting

## Description

Create the demonstration resource, client identification, and lifecycle. Apply the Redis limiter once per resource request and translate its decision into the HTTP response. Deliver the healthy Redis path here; task 06 adds fallback and verifies the same HTTP contract during outages.

## Acceptance criteria

- `GET /api/resource` returns 200 with `{"message":"ok"}`. Read exactly one nonempty, case-sensitive `X-API-Key` token without whitespace; no authentication is introduced.
- Missing/malformed/duplicate keys return 400; well-formed unregistered keys return 403, before store access.
- Use a small JSON error envelope `{"error":{"code":"..."}}`: `INVALID_API_KEY`, `UNKNOWN_API_KEY`, `RATE_LIMIT_EXCEEDED`, or `INTERNAL_ERROR`. Internal errors return 500 without sensitive details.
- `GET /health` bypasses key validation/limiting and stays 200 during Redis outages while the process can serve.
- Support a configurable port, safe instance identification for experiments, and graceful shutdown.
- Allowed requests reach the handler; exhausted buckets return 429 without invoking it.
- On resource 200/429, emit `RateLimit-Policy: "token-bucket";q=C` and `RateLimit: "token-bucket";r=N`, where C is capacity and N is post-decision balance rounded down.
- Use pinned Internet-Draft 11, not a published RFC. Omit optional window/reset/partition parameters rather than implying a strict-window policy.
- On 429 only, include `Retry-After` until one token, rounded up to seconds with minimum 1. Use the error envelope above; no limiter headers are needed without a valid decision.

## Dependencies

01, 02, 04.

## Expected tests

- Resource response, single/duplicate/invalid/unknown keys, case-sensitive lookup, and error envelopes.
- Health bypass during outages, instance identification, and clean shutdown.
- Success, first denial, refill, key isolation, policy overrides, and handler invocation counts.
- Exact limit/remaining headers, retry rounding, and 429 body using Redis.
- Invalid/unknown keys and health requests do not consume tokens; internal errors do not leak details.
