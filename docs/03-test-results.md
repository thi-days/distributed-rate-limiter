# Test Results

Validated locally on 2026-10-21. Formatting, lint, build, and type checking passed, along with 16 unit tests, 3 Redis integration tests, and 3 Compose tests.

## Observed results

| Scenario                                          | Observed result                                                                                                | Tests                                                                                                |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Shared limit across three instances               | Of 15 concurrent requests, 10 returned `200` and 5 returned `429`. All three instances participated.           | [Redis integration](../tests/integration/http.test.ts) and [Compose](../tests/demo/topology.test.ts) |
| Direct access after exhaustion                    | Each of the three APIs returned `429`, confirming that changing instances did not grant another allowance.     | [Compose](../tests/demo/topology.test.ts)                                                            |
| Independent API keys                              | Another key returned `200` after the first key exhausted its limit.                                            | [Redis integration](../tests/integration/http.test.ts) and [Compose](../tests/demo/topology.test.ts) |
| Redis connection failure at startup or during use | Requests returned `200` without rate-limit headers. After recovery, an exhausted counter returned `429` again. | [Redis integration](../tests/integration/http.test.ts)                                               |
| Duplicate API-key headers                         | Requests returned `400`, both directly and through Nginx.                                                      | [Compose](../tests/demo/topology.test.ts)                                                            |

## Reproduce

Follow the [README setup](../README.md#how-to-run-locally), then run:

```bash
npm run check
npm run check:demo
```

The second command requires the demo to be running. It prints observed counts, instance IDs, and outage/recovery responses. It also resets the two demonstration clients’ counters.

## Validation environment

| Component             | Version             |
| --------------------- | ------------------- |
| Host                  | macOS 27.0.1, arm64 |
| Local Node.js         | 24.19.0             |
| API container Node.js | 24.22.0             |
| Redis                 | 7.4.11              |
| Nginx                 | 1.28.3              |

## Limits of this validation

The automated outage tests interrupt their own Redis connections. They do not restart Redis or verify recovery after data loss. The [README](../README.md#testing-a-redis-outage-fail-open) includes a manual container stop/start test.

These checks verify the scenarios above. They do not establish sustained-load performance, a latency target, or production availability.
