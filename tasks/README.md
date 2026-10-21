# Implementation plan

This backlog keeps the case study focused on a small API with shared rate limits. Tasks describe the current delivery, not a custom limiter framework.

## Source of truth and scope

- [PRD](../docs/01-prd.md): per-key limits, response headers, multiple instances, and availability during Redis failures.
- [Technical design](../docs/02-technical-design.md): Express, library-managed fixed windows, Redis, three instances, and Nginx.
- [ADRs](../docs/adr/): shared Redis, fixed windows, fail-open, and the HTTP boundary.

No custom Token Bucket, local fallback, recovery probes, JSON policy registry, or guaranteed latency target is required. Authentication, billing, production Redis availability, and strict protection during outages remain outside scope.

## Ordered backlog

| Order | Task                                                         | Depends on | Status      |
| ----- | ------------------------------------------------------------ | ---------- | ----------- |
| 01    | [Development and test foundation](01-project-foundation.md)  | None       | Implemented |
| 02    | [Demonstration policies](02-policy-configuration.md)         | 01         | Implemented |
| 03    | [Library integration and HTTP API](03-http-rate-limiting.md) | 02         | Implemented |
| 04    | [Three-instance demonstration](04-distributed-demo.md)       | 03         | Implemented |
| 05    | [Automated quality checks](05-continuous-integration.md)     | 04         | Implemented |
| 06    | [Portfolio evidence](06-portfolio-evidence.md)               | 04         | Implemented |

## Requirement coverage

| Requirement / decision                  | Primary evidence                                      |
| --------------------------------------- | ----------------------------------------------------- |
| Per-key limits and HTTP 429             | HTTP unit tests and Redis integration tests           |
| Different policies and response headers | HTTP unit tests and Redis integration tests           |
| One allowance across three instances    | Concurrent Redis integration test and Compose demo    |
| API availability during Redis failures  | Startup/runtime outage and recovery integration tests |
| Reproducible execution                  | README commands and test results                      |

## Completion standard

Run unit tests, applicable Redis integration tests, formatting checks, lint, and type checking. Keep tests focused on the application's integration and response behavior. Use isolated Redis keys and clean up test connections. Do not duplicate the libraries' algorithm test suites.

Document measured results and limitations honestly. Performance measurements are optional and must identify their environment; local timings are not a production guarantee. Changes to the failure strategy or counting behavior must update the source documents and ADRs.
