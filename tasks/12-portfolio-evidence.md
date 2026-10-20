# 12 — Publish reproducible portfolio evidence

## Description

Present the implementation, engineering decisions, and experimental evidence as a concise case study.

## Acceptance criteria

- Keep README setup/examples short and accurate; use the technical design for architecture and the ADRs for rationale.
- Record actual environment, workload, correctness/failure observations, and limiter latency in `docs/03-test-results.md`, with links to reproducible evidence.
- Explain shared-budget atomicity, controlled bursts, and the availability/global-fairness trade-off, including 25% local initialization and recovery without reconciliation.
- State relevant limits: independent fallback budgets, restart/state-loss effects, static policies, and local benchmark portability. Do not invent results.
- Keep progress tracking in tasks and link to the source documents for specifications.

## Dependencies

10, 11.

## Expected tests

- Reproduce setup, request examples, concurrency, outage/recovery, and benchmark commands.
- Check links, diagram consistency, and that reported numbers match captured evidence.
- Review requirement coverage and document unmet targets in the task delivery.
