# 10 — Automate quality and integration checks

**Status**: Not implemented

## Description

Automate the established checks in CI so reviewers can verify correctness without relying solely on portfolio screenshots or manual runs.

## Acceptance criteria

- Clean checkout runs reproducible installation, lint, strict type checking, build, and unit tests.
- Run real Redis integration tests and the three-instance correctness/failure suites in isolated infrastructure with bounded job timeouts.
- Always clean up containers/fault injection and retain diagnostic output on failure; do not hide failing tests with skips or unconditional success.
- Keep full load/latency benchmarks separately invokable in a documented suitable environment; shared-runner timing is not authoritative evidence for the 10ms target.
- Document local equivalents of CI commands and required runtime versions.

## Dependencies

08, 09. Extend the existing checks from 01; do not introduce a second test toolchain.

## Expected tests

- Execute the workflow or equivalent clean-environment commands successfully.
- Confirm failed assertions and unavailable required infrastructure produce a failed check and useful diagnostics.
- Verify teardown runs after failure and no secrets appear in retained artifacts.
