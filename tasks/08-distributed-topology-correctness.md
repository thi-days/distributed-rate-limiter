# 08 — Deliver the three-instance topology and verify shared enforcement

## Description

Run Redis, three API instances, and Nginx with the root Docker Compose file, making the architecture easy to reproduce locally. Demonstrate that one key has one shared budget across all three instances. Failure experiments belong to task 09; sustained load and latency measurement belong to task 11.

## Acceptance criteria

- Build the API image; all instances load the same startup policy JSON and share Redis while exposing distinct instance identifiers.
- Nginx preserves API-key validation behavior, limiter headers, status codes, and response bodies.
- Document start/stop/reset commands and ports. Health handling must keep fallback-capable APIs reachable during Redis outages.
- Provide test access to individual instances and isolated disposable state. Different policy experiments start with isolated state; no deployment/migration mechanism is required.
- Exercise synchronized traffic directly across instances and through Nginx, proving participation by all three.
- Assert the shared burst allowance with controlled time or account for refill during the requests.
- Verify isolated keys, distinct policies, depletion/refill, and response metadata without depending on response ordering.
- Use isolated state so repeated runs do not affect one another. Policy-update scenarios are outside scope.

## Dependencies

05, 06, 07.

## Expected tests

- Validate Compose/Nginx configuration and run a clean-start smoke test.
- Traffic reaches all three instances through Nginx; 429 and response headers are preserved.
- APIs remain reachable when starting without Redis.
- Fresh burst, shared depletion, refill, and concurrent last-token contention.
- Multiple registered keys and unequal policies; unknown keys create no state.
- Repeated runs show no multiplication of the healthy Redis budget by instance count.
