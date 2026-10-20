# Implementation plan

This backlog contains 12 implementation tasks. Implementation status is tracked in the table below. Execute numbered tasks in order; each file lists the prerequisites needed to begin it. Each task should be a focused, reviewable change with its own validation evidence.

## Source of truth and scope

- [PRD](../docs/01-prd.md): FR-01–04, NFR-01–04, and product acceptance criteria.
- [Technical design](../docs/02-technical-design.md): Node.js/TypeScript with Express 5, Redis with Lua, local fallback, three API instances, Docker Compose, Nginx, and k6.
- [ADR-001](../docs/adr/001-redis-vs-in-memory.md): shared Redis state.
- [ADR-002](../docs/adr/002-token-bucket-algorithm.md): configurable Token Buckets and controlled bursts.
- [ADR-003](../docs/adr/003-fail-open-vs-fail-closed.md): local in-memory fallback, with temporarily weaker global enforcement.
- [ADR-004](../docs/adr/004-express-http-boundary.md): Express 5 middleware at the HTTP boundary, with an independent limiter core.

Authentication, registration, billing, dashboards, additional limiting algorithms, alternative failure strategies, and production HA infrastructure are outside this plan. API-key extraction is an identification contract, not authentication.

Policies are static per run; experiments with different configurations use isolated state. Task-specific details belong in their implementation tasks: configuration in task 02, HTTP identification, errors, and headers in task 05, fallback HTTP behavior in task 06, and reference load settings in task 11.

## Ordered backlog

| Order | Task | Depends on | Status |
| --- | --- | --- | --- |
| 01 | [Establish the TypeScript development and test foundation](01-project-foundation.md) | None | Implemented |
| 02 | [Load and validate per-key policies](02-policy-configuration.md) | 01 | Implemented |
| 03 | [Implement the local Token Bucket and reference tests](03-local-token-bucket.md) | 01, 02 | Implemented |
| 04 | [Implement the atomic Redis bucket store and connection lifecycle](04-redis-bucket-store.md) | 02, 03 | Not implemented |
| 05 | [Deliver the minimal HTTP API with Redis rate limiting](05-http-rate-limiting.md) | 01, 02, 04 | Not implemented |
| 06 | [Coordinate fallback and recovery through the HTTP boundary](06-fallback-recovery.md) | 03, 04, 05 | Not implemented |
| 07 | [Expose enforcement and failure evidence](07-observability.md) | 05, 06 | Not implemented |
| 08 | [Deliver the three-instance topology and verify shared enforcement](08-distributed-topology-correctness.md) | 05, 06, 07 | Not implemented |
| 09 | [Verify outages, bounded fallback, and recovery](09-failure-experiments.md) | 08 | Not implemented |
| 10 | [Automate quality and integration checks](10-continuous-integration.md) | 08, 09 | Not implemented |
| 11 | [Run reproducible k6 workloads and evaluate limiter latency](11-load-latency-benchmark.md) | 07, 08, 09 | Not implemented |
| 12 | [Publish reproducible portfolio evidence](12-portfolio-evidence.md) | 10, 11 | Not implemented |

Numeric order is the recommended delivery sequence; dependencies describe the actual constraints. Task 05 delivers HTTP limiting with healthy Redis before task 06 adds fallback and recovery. Task 10 can run after correctness and failure experiments without waiting for the task 11 benchmark.

## Requirement coverage

| Requirement / decision | Implementation tasks | Primary evidence |
| --- | --- | --- |
| FR-01: per API Key | 02–06 | 03–06, 08 |
| FR-02: HTTP 429 | 05, 06 | 05, 06, 08, 09, 11 |
| FR-03: configurable per-key limits | 02–05 | 02–05, 08 |
| FR-04: rate-limit headers | 05, 06 | 05, 06, 08, 09 |
| NFR-01: shared enforcement | 04, 06, 08 | 08, 11 |
| NFR-02: at least three instances | 08 | 08, 09, 11 |
| NFR-03: P95 overhead < 10ms | 04, 07 | 11 |
| NFR-04: availability during infrastructure failure | 03–08 | 06, 09, 11 |
| ADR-001: Redis | 04, 08 | 04, 08 |
| ADR-002: Token Bucket | 02–06 | 03–06, 08, 11 |
| ADR-003: local fallback | 03, 06 | 06, 09, 11 |
| ADR-004: Express HTTP boundary | 05–08 | 05, 06, 08 |

## Completion standard

For each implementation task, run the relevant unit tests, applicable integration tests, lint, and strict type checking. Report failures and environmental blockers explicitly. Use deterministic clocks, isolated Redis namespaces, and controlled synchronization instead of timing-sensitive sleeps where possible. Keep dependencies minimal and explain additions.

Record acceptance evidence and known limitations in the change delivering each task. Do not mark performance or failure claims as achieved before experiments produce reproducible results. If a proposed fix changes requirements or accepted architecture, document and resolve that decision before implementing it.
