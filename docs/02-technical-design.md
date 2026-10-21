# Technical Design: Distributed Rate Limiter

## 1. Overview

This document describes the technical design of a distributed rate limiter for a SaaS API.

The solution must enforce rate limits per API Key across multiple backend instances while maintaining low latency and availability.

## 2. Architecture

![Architecture](./diagrams/architecture.png)

Each API instance uses a shared Redis store to enforce rate limits.

If Redis becomes unavailable, instances allow requests without rate limiting. This keeps the demonstration API available but leaves it unprotected against excessive traffic during the outage.

## 3. Technical Decisions

| Decision                | Choice                          | ADR                                              |
| ----------------------- | ------------------------------- | ------------------------------------------------ |
| Distributed state       | Redis                           | [ADR-001](./adr/001-redis-vs-in-memory.md)       |
| Rate limiting algorithm | Fixed window                    | [ADR-002](./adr/002-fixed-window-algorithm.md)   |
| Failure strategy        | Allow requests without limiting | [ADR-003](./adr/003-fail-open-vs-fail-closed.md) |
| HTTP framework          | Express 5                       | [ADR-004](./adr/004-express-http-boundary.md)    |

## 4. Request Flow

1. Client sends a request containing an API Key in `X-API-Key`.
2. Load Balancer forwards the request to an API instance.
3. Rate Limiter resolves the registered API Key's policy and checks its shared request count in Redis.
4. The library atomically increments the key's Redis counter.
5. If the request count is within the configured limit, the request continues.
6. Otherwise, the API responds with HTTP 429.
7. If the Redis store reports an error, the request continues without rate limiting.

## 5. Implementation

### Technology Stack

- Node.js + TypeScript
- Express 5 for the HTTP boundary
- Redis
- `express-rate-limit` and `rate-limit-redis` for shared counters and HTTP responses
- Docker Compose
- Nginx as Load Balancer

### Rate Limiting Configuration

- Default client: 10 requests per one-minute window.
- Custom client: 10 requests per one-minute window.
- Identification: API Key, without authentication.

A small typed table in `src/config.ts` defines the two demonstration clients. Policies stay fixed during a run. Different policy experiments use fresh Redis state; live configuration updates are outside scope.

### Fixed Window Behavior

Each key's window starts on its first request and expires after one minute. The library counts requests and returns 429 after the allowance is used. Requests do not earn capacity gradually. Requests near both sides of a reset can exceed the nominal limit over a rolling minute; a sliding window is more suitable when that boundary burst is unacceptable.

### Redis State

`rate-limit-redis` owns the atomic counting scripts and expiry. Keys use the namespace `rate-limiter:window:<sha256(API Key)>`, keeping raw keys out of Redis names. All instances use the same namespace and policy table.

The native Redis client reconnects automatically. Offline request queues are disabled and commands have a 100ms timeout, so requests do not wait indefinitely for the limiter. A timed-out request may already have incremented Redis; it still proceeds under fail-open. This demo does not promise exact accounting across network failures.

### HTTP Behavior

Express 5 validates the API key, looks up its policy, and runs the library middleware before the resource handler. Configuration remains independent of Express. Constructing the app does not start the server or open Redis connections.

Count duplicate `X-API-Key` fields in Node's raw headers before using the parsed value. Keys remain case-sensitive, and `trust proxy` stays disabled. Nginx rejects comma-separated key values to catch duplicate fields joined by the proxy.

Missing or malformed keys return 400; unregistered keys return 403 before store access. Allowed requests return 200. Exhausted limits return 429 with `Retry-After`. `express-rate-limit` supplies `RateLimit` and `RateLimit-Policy` using its `draft-8` format. These headers are absent when the store fails, because there is no reliable count.

`GET /health` bypasses the limiter and reports whether HTTP is serving, not whether rate limiting is available. Internal HTTP errors return a small JSON 500 response without details. SIGTERM/SIGINT stop accepting requests, allow up to ten seconds for active work, then close Redis.

## 6. Failure Handling

`passOnStoreError: true` allows requests when the store reports an error. This includes more than connection failures; a store configuration error can also bypass limiting. Error logs omit underlying error details, keys, and credentials. Node-redis handles reconnection, and the store scripts are reloaded when the connection becomes ready, including after an outage at startup.

During an outage there is **no rate-limit protection**, either shared or local. After recovery, the surviving Redis counter applies again. Lost counters start fresh; requests served without Redis are not reconciled afterward.

For a service handling expensive work, an available Redis deployment plus conservative local limits can reduce exposure during failures. If a hard budget must be respected, rejecting requests while the limit cannot be checked may be the better choice. The right choice depends on the cost of excess traffic versus rejected requests. This demonstration chooses simple fail-open and leaves those additional protections outside scope.

## 7. Testing Strategy

| Test                     | Expected Result                    |
| ------------------------ | ---------------------------------- |
| Requests within limit    | HTTP 200                           |
| Requests exceeding limit | HTTP 429                           |
| Concurrent requests      | Atomic shared counting             |
| Multiple API instances   | Shared rate limit enforced         |
| Redis unavailable        | Requests allowed without limiting  |
| Redis recovery           | Distributed limiting restored      |
| Local execution          | Reproducible setup and experiments |

The experiments demonstrate shared enforcement, independent keys, outages, and recovery. Test the application integration rather than reimplementing the library's algorithm tests. Local latency measurements must identify their environment and are not a production guarantee.

## 8. Trade-offs

### Benefits

- Consistent rate limiting across multiple instances.
- Atomic shared counting.
- Small implementation using established libraries.
- API availability during Redis outages.

### Limitations

- Additional infrastructure dependency.
- Network overhead for Redis operations.
- No rate limiting during Redis store failures.
- Redis failover may affect rate limit state consistency.
- Window boundaries and lost Redis counters can allow additional traffic.
- Policy updates during traffic and production Redis HA are outside this case study.
