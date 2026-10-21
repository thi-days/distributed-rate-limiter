# Distributed Rate Limiter

I built this repository as a System Design and Backend Engineering case study for a common situation: API Rate Limiting.

It's used for situations like limiting an user API consumption according to its subscription tier or avoiding an user from swallowing most of the resources on your server like AI services have been doing (5h limits, weekly limits, and so on).

## The Challenge

The challenge is to design and implement a distributed rate limiter that will enforce the API usage limits regardless the backend server instance it's running - given the scalability is already predicted in this scenario.

### System Requirements

| Requirement               | Target                             |
| ------------------------- | ---------------------------------- |
| Request limit             | 10 requests/minute/API Key         |
| Backend instances         | 3+                                 |
| Rate limiting consistency | Atomic enforcement using Redis     |
| Added latency             | No latency guarantee for this demo |
| Redis failure handling    | Allow requests without limiting    |

Each key has a one-minute window starting with its first request. The counter resets when that window expires.

## Architecture

![Rate Limiter Architecture Diagram](./docs/diagrams/architecture.png)

### Key Engineering Decisions

| Decision                   | Reason                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| Redis instead of in-memory | Share state across API instances ([ADR 1](./docs/adr/001-redis-vs-in-memory.md))         |
| Fixed window               | Simple counting with library support ([ADR 2](./docs/adr/002-fixed-window-algorithm.md)) |
| Rate limiting libraries    | Shared counting and HTTP headers ([ADR 3](./docs/adr/003-fail-open-vs-fail-closed.md))   |
| Express 5                  | Compose the HTTP middleware flow ([ADR 4](./docs/adr/004-express-http-boundary.md))      |
| Docker Compose             | Allow to reproduce locally                                                               |

### Implementation

This implementation has:

1. The HTTP API in Express 5, Node.js, and TypeScript.
2. A middleware to spot the API Key in the request.
3. Requests continue without rate limiting during Redis outages.
4. Distributed rate limit using Redis.
5. `express-rate-limit` with `rate-limit-redis` for atomic shared counting.
6. Three API instances.
7. Load Balancer through Nginx.

Two demonstration clients are defined in [`src/config.ts`](./src/config.ts):

1. `demo-client` allows 10 requests per window.
2. `demo-client-custom` allows 10.

**These keys identify clients, they do not authenticate them.** The [technical design](./docs/02-technical-design.md) explains the request flow, failure handling, and trade-offs.

See the [implementation plan](./tasks/README.md) for task breakdown and acceptance criteria.

## Experiments

### Experiment 1: Concurrent requests across multiple instances

Verify that requests handled by different API instances consume the same allowance, while another API key keeps its own counter.

### Experiment 2: Redis unavailable

Verify that the API continues responding without rate limiting during a Redis connection failure and resumes shared limits enforcement after recovery.

**Trade-off:** the API has no rate-limit protection while Redis is unavailable. A service handling costly requests would benefit from an available Redis deployment and a conservative local fallback, or from rejecting requests when enforcing the limit is essential. **This demo deliberately uses fail-open to keep the implementation small and it is not an overload protection guarantee**.

See [test results](./docs/03-test-results.md) for observed results, links to the tests, and the limits of this validation.

## How to run locally

To run the tests locally, it's required **Docker** with **Docker Compose**. However, Node.js 24 and npm are needed **only for local development and tests**.

### Running the demo

To start Redis, three API instances, and Nginx at `http://localhost:8080`, run:

```bash
docker compose up -d --build
```

Send a request by running:

```bash
curl -i http://localhost:8080/api/resource \
  -H 'X-API-Key: demo-client'
```

For example, the **rate-limit** headers after the first request can look like this:

```http
RateLimit: "10-in-1min"; r=9; t=60
RateLimit-Policy: "10-in-1min"; q=10; w=60; pk=:NjExNDMyYWJjMmFl:
```

`RateLimit` describes the current allowance; `RateLimit-Policy` describes the rule:

| Value          | Meaning                                                                |
| -------------- | ---------------------------------------------------------------------- |
| `"10-in-1min"` | Policy name: 10 requests in a one-minute window.                       |
| `r=9`          | 9 requests remain after this request.                                  |
| `t=60`         | About 60 seconds until the current window resets.                      |
| `q=10`         | Maximum requests per window.                                           |
| `w=60`         | Window length in seconds.                                              |
| `pk=...`       | Opaque identifier for the group sharing this counter; not the API key. |

**The count is shared across instances**. When exhausted, responses return `429` and `Retry-After` tells the client how many seconds to wait. These headers are absent when a store failure bypasses limiting. The format follows the library's [draft-8 headers](https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-ratelimit-headers-08).

Demo clients pre-registered:

| API key              | Requests per one-minute window |
| -------------------- | ------------------------------ |
| `demo-client`        | 10                             |
| `demo-client-custom` | 10                             |

### Manually testing (Happy path)

1. **In the first run** the API returns `200` (only while requests are within the limit).
2. Keep running the same script again and observe the following happening every request:
   1. The `X-Instance-ID` header, will change to the next instance
   2. The `r` header will decrease
   3. The `t` header will decrease until the next minute count
3. The API will return `429` when it is exhausted (`r` equals to zero).

### Testing a Redis outage (Fail-open)

With the demo running, stop Redis:

```bash
docker compose stop redis
```

Send a request:

```bash
curl -i http://localhost:8080/api/resource \
  -H 'X-API-Key: demo-client'
```

The API still returns `200`, but without `RateLimit` and `RateLimit-Policy` headers. **Rate limiting is temporarily disabled.**

Start Redis again:

```bash
docker compose start redis
```

Wait a few seconds for reconnection, then repeat the request. Rate-limit headers should return, and the API will enforce the limit again.

If the counter is still exhausted, expect `429`. Otherwise, expect `200`. After its window expires, the allowance resets.

### Run checks and automated tests

Install development dependencies and perform checks (formatting, lint, TypeScript types, and unit tests):

```bash
npm ci
npm run check
```

> [GitHub Actions](./.github/workflows/ci.yml) runs these checks and the Redis integration tests on every push and pull request.

With the demo running (see [Running the demo](#running-the-demo)), check Redis integration and the complete setup:

```bash
npm run check:demo
```

This runs the integration and Compose tests. Their summaries show the observed instance IDs, accepted and rejected requests, and outage/recovery responses. Assertions fail if the results differ from the expected behavior.

`test:demo` resets the two demo clients’ counters.

### Stop or reset the demo

To stop the demo, run:

```bash
docker compose down
```

To also delete Redis data and reset the counters:

```bash
docker compose down -v
```
