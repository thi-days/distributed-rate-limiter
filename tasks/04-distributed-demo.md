# 04 — Deliver the three-instance demonstration

**Status**: Implemented

## Description

Run three copies of the API behind Nginx with one shared Redis using Docker Compose.

## Acceptance criteria

- All APIs use the same policy table and Redis namespace, with distinct `X-Instance-ID` labels.
- Expose Nginx on 8080 and individual APIs on 3001–3003 for inspection.
- Preserve status codes and limiter headers through Nginx; reject duplicate API-key fields joined by the proxy.
- Do not require Redis readiness before HTTP can serve; allow time for HTTP shutdown before stopping a container.
- Document start, stop, state reset, and a Redis outage/recovery experiment.

## Dependencies

3.

## Expected tests

- Concurrent requests across three isolated servers share one allowance; another key stays independent.
- Print observed instance IDs and request counts alongside assertions, making live demonstrations easy to follow.
- Compose build and smoke checks through Nginx and each API, including duplicate fields and 429 responses.
