# Distributed Rate Limiter

I built this repostiory as a System Design and Backend Engineering case study for a common situation: API Rate Limiting. It might be used for situations like limiting an user API consumption according to its subscription tier or avoiding an user from swallowing most of the resources on your server like AI services have been doing (5h limits, weekly limits, and so on).

## The Challenge

The challenge is to design and implement a distributed rate limiter that will enforce the API usage limits regardless the backend server instance it's running - given the scalability is already predicted in this scenario.

### System Requirements

| Requirement               | Target                             |
| ------------------------- | ---------------------------------- |
| Maximum requests          | 100 requests/minute/API Key        |
| Backend instances         | 3+                                 |
| Rate limiting consistency | Atomic enforcement using Redis     |
| Added latency             | P95 < 10ms                         |
| Redis failure handling    | Configurable fail-open/fail-closed |

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

This implementation have:

1. The API HTTP in Node.js and TypeScript.
2. A middleware to spot the API Key in the request.
3. Local rate limiter (to compare).
4. Distributed rate limite using Redis.
5. Lua script for atomic operations.
6. Three API instances.
7. Load Balancer through Nginx.

## Experiments

### Experiment 1: Concurrent requests across multiple instances

Objetivo: verificar se a arquitetura consegue respeitar o limite compartilhado quando as requisições chegam simultaneamente a instâncias diferentes.

### Experiment 2: Redis unavailable

Objetivo: comparar o comportamento das estratégias fail-open e fail-closed.

### Experiment 3: Latency overhead

Objetivo: medir a latência adicional introduzida pela consulta ao Redis.
Depois de executar os testes, você adicionaria os resultados obtidos, com números e gráficos.

## How to run locally

```bash
docker compose -f infra/docker-compose.yml up --build
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
