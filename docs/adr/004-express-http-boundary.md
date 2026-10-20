# ADR-004: Express HTTP Boundary

**Status**: accepted

## Context

The demonstration API needs two endpoints, API-key identification, rate-limit response metadata, and consistent error handling. The case study centers on distributed enforcement, so HTTP framework concerns should remain separate from the algorithm and store implementations.

## Decision

Use Express 5 with TypeScript for the HTTP boundary. Compose route-scoped identification, policy lookup, and limiter middleware before the resource handler; register health separately and a JSON error handler last. Keep policy, Token Bucket, Redis, and fallback logic independent of Express.

Construct the application separately from listening and process lifecycle management. Use the existing Node.js test runner and native HTTP clients for boundary tests. Add Express and matching types in task 05 without introducing another build or test toolchain.

Inspect raw header occurrences for duplicate API-key fields before reading normalized values. Use API keys as bucket identity and leave `trust proxy` disabled, including behind Nginx. Preserve the same HTTP contract through the proxy.

## Alternatives Considered

| Option              | Reason for rejection                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------ |
| Native Node.js HTTP | Requires manual routing and middleware composition for the HTTP boundary.                  |
| NestJS              | Adds module and dependency-injection structure beyond the needs of this demonstration API. |

## Consequences

Positive:

- Makes request ordering and HTTP response handling explicit through middleware.
- Keeps the distributed limiter reusable outside Express.
- Preserves the existing TypeScript build and Node.js tests.

Negative:

- Adds a runtime dependency and its TypeScript types.
- Requires explicit duplicate-header validation, asynchronous error propagation, and middleware ordering tests.
- Server draining and dependency cleanup remain application responsibilities.

## References

- [Express error handling](https://expressjs.com/en/guide/error-handling/)
- [Express health checks and graceful shutdown](https://expressjs.com/en/advanced/healthcheck-graceful-shutdown/)
- [Express behind proxies](https://expressjs.com/en/guide/behind-proxies/)
- [Node.js 24 raw headers](https://nodejs.org/docs/latest-v24.x/api/http.html#messagerawheaders)
