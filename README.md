# Distributed Rate Limiter

I built this repository as a System Design and Backend Engineering case study for a common situation: API Rate Limiting. It might be used for situations like limiting an user API consumption according to its subscription tier or avoiding an user from swallowing most of the resources on your server like AI services have been doing (5h limits, weekly limits, and so on).

## The Challenge

The challenge is to design and implement a distributed rate limiter that will enforce the API usage limits regardless the backend server instance it's running - given the scalability is already predicted in this scenario.

### System Requirements

| Requirement               | Target                             |
| ------------------------- | ---------------------------------- |
| Bucket capacity           | 100 tokens/API Key                 |
| Refill rate               | 100 tokens/minute/API Key          |
| Backend instances         | 3+                                 |
| Rate limiting consistency | Atomic enforcement using Redis     |
| Added latency             | P95 < 10ms                         |
| Redis failure handling    | Local Token Bucket fallback        |

Token Bucket allows bursts and replenishes tokens continuously, so this is not a strict maximum of 100 requests in every rolling minute.

## Architecture

![Rate Limiter Architecture Diagram](./docs/diagrams/architecture.png)

### Key Engineering Decisions

| Decision                   | Reason                           |
| -------------------------- | -------------------------------- |
| Redis instead of in-memory | Share state across API instances |
| Token Bucket               | Support controlled bursts        |
| Lua Script                 | Atomic operations in Redis       |
| Docker Compose             | Allow to reproduce locally       |
| k6                         | Load and concurrency testing     |

### Implementation

This implementation has:

1. The API HTTP in Node.js and TypeScript.
2. A middleware to spot the API Key in the request.
3. Local rate limiter as a fallback during Redis outages.
4. Distributed rate limit using Redis.
5. Lua script for atomic operations.
6. Three API instances.
7. Load Balancer through Nginx.

Per-key policies are loaded from a JSON file at startup. The [technical design](./docs/02-technical-design.md) explains the request flow, failure handling, and trade-offs.

See the [implementation plan](./tasks/README.md) for task breakdown and acceptance criteria.

## Experiments

### Experiment 1: Concurrent requests across multiple instances

> **[PLACEHOLDER — INSTRUCTION]** Verify that the architecture enforces the shared limit when requests arrive simultaneously at different instances.

### Experiment 2: Redis unavailable

> **[PLACEHOLDER — INSTRUCTION]** Verify that the API continues serving requests with local limits during a Redis outage and returns to the shared limit after recovery, demonstrating the trade-off between availability and global consistency.

### Experiment 3: Latency overhead

> **[PLACEHOLDER — INSTRUCTION]** Measure the latency added by the rate limiter separately from total HTTP latency, and evaluate the P95 target of less than 10ms.

## How to run locally

```bash
docker compose up --build
```

It can also be tested through:
```bash
curl \
  -H "X-API-Key: customer-123" \
  http://localhost:8080/api/resource
```

And to run the tests locally, you can use:
```bash
npm test
npm run test:integration
npm run test:load
```
