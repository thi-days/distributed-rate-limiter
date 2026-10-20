# Technical Design: Distributed Rate Limiter

## 1. Overview

This document describes the technical design of a distributed rate limiter for a SaaS API.

The solution must enforce rate limits per API Key across multiple backend instances while maintaining low latency and availability.

## 2. Architecture

![Architecture](./diagrams/architecture.png)

Each API instance uses a shared Redis store to enforce rate limits.

If Redis becomes unavailable, instances temporarily enforce
rate limits using local in-memory state.

## 3. Technical Decisions

| Decision                | Choice                   | ADR                                              |
| ----------------------- | ------------------------ | ------------------------------------------------ |
| Distributed state       | Redis                    | [ADR-001](./adr/001-redis-vs-in-memory.md)       |
| Rate limiting algorithm | Token Bucket             | [ADR-002](./adr/002-token-bucket-algorithm.md)   |
| Failure strategy        | Local in-memory fallback | [ADR-003](./adr/003-fail-open-vs-fail-closed.md) |

## 4. Request Flow

1. Client sends a request containing an API Key in `X-API-Key`.
2. Load Balancer forwards the request to an API instance.
3. Rate Limiter resolves the registered API Key's policy and checks its token bucket in Redis.
4. Redis atomically calculates and updates available tokens.
5. If a token is available, the request continues.
6. Otherwise, the API responds with HTTP 429.
7. If Redis is unavailable, local rate limiting is used.

## 5. Implementation

### Technology Stack

- Node.js + TypeScript
- Redis
- Lua scripts for atomic operations
- Docker Compose
- Nginx as Load Balancer
- k6 for load testing

### Rate Limiting Configuration

- Bucket capacity: 100 tokens
- Refill rate: 100 tokens/minute
- Token cost: 1 per request
- Bucket identification: API Key

A startup JSON file defines registered keys, defaults, and per-key overrides, without adding authentication. Policies are fixed per run; live updates and migration are outside scope. Different policy experiments use isolated state.

### Token Bucket Behavior

For each request, refill by elapsed time up to capacity, then consume one token or reject. Preserve fractional refill, including on denials.

This permits bursts, not a strict rolling-minute cap: a full default bucket accepts 100 simultaneous requests, rejects the next, and earns one token after 600ms.

### Redis State

Each API Key has its own bucket:

- `tokens`: remaining available tokens.
- `last_refill`: timestamp of the last refill calculation.

Bucket updates must be atomic. One Lua operation refills, consumes, and saves the bucket, avoiding concurrent requests spending the same token. Redis server time gives instances a common refill clock. Idle buckets expire only after enough time to refill completely.

### HTTP Behavior

Missing or malformed keys return HTTP 400; unregistered keys return HTTP 403 before store access. Allowed requests return HTTP 200. Exhausted buckets return HTTP 429 with `Retry-After`, rounded up to seconds until one token is available.

Responses report capacity and remaining tokens through `RateLimit-Policy` and `RateLimit`, following [Internet-Draft 11](https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-ratelimit-headers-11), not a published RFC. `GET /health` bypasses limiting to keep fallback-capable APIs reachable.

## 6. Failure Handling

When Redis becomes unavailable:

- The application switches to local Token Bucket limiting.
- Each instance maintains independent rate limits.
- Global rate limiting consistency is temporarily lost.
- Redis connectivity is periodically rechecked, once per second by default.
- Distributed limiting resumes when Redis recovers, without merging local consumption.

Local buckets start with 25% of capacity, rounded up, and retain the normal refill rate and maximum capacity. With the default policy, each instance starts with 25 tokens. This reduces the initial outage burst but does not impose a global cap.

Local state is kept per registered key across outages until the process exits. Re-entering fallback reuses that state with elapsed refill rather than granting a fresh allocation.

Redis attempts default to a configurable 20ms timeout. Only connection failures/timeouts activate fallback, not denials or programming/configuration errors. Uncertain consumption is not retried: it may already have happened. Recovery uses Redis state; lost buckets start full.

## 7. Testing Strategy

| Test                     | Expected Result               |
| ------------------------ | ----------------------------- |
| Requests within limit    | HTTP 200                      |
| Requests exceeding limit | HTTP 429                      |
| Concurrent requests      | Atomic token consumption      |
| Multiple API instances   | Shared rate limit enforced    |
| Redis unavailable        | Local fallback activated      |
| Redis recovery           | Distributed limiting restored |
| Load testing             | P95 overhead below 10ms       |

The experiments demonstrate shared enforcement, outage protection/recovery, and latency. Measure limiter duration separately from HTTP latency, recording the environment, load, and repeated results. A generator that cannot sustain the load cannot establish a pass.

## 8. Trade-offs

### Benefits

- Consistent rate limiting across multiple instances.
- Low-latency token management.
- Controlled bursts.
- Partial availability during Redis outages.

### Limitations

- Additional infrastructure dependency.
- Network overhead for Redis operations.
- Global limits are not guaranteed during fallback.
- Redis failover may affect rate limit state consistency.
- Local fallback and process restarts can grant additional budget.
- Policy updates during traffic and production Redis HA are outside this case study.
