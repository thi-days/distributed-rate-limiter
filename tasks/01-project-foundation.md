# 01 — Establish the TypeScript development and test foundation

**Status**: Implemented

## Description

Create the smallest maintainable Node.js/TypeScript project foundation with strict typing, linting, unit tests, and a separate Redis integration test entry point.

## Acceptance criteria

- Document a supported Node.js version; add reproducible dependency installation and a lockfile.
- Establish source/test layout, strict TypeScript compilation, build, formatting, lint, type-check, unit-test, and integration-test commands.
- Integration tests clearly require real Redis and fail with an actionable setup message when unavailable; ordinary unit tests need no infrastructure.
- Check startup, process shutdown, and the development commands without introducing another test framework.
- Explain dependency choices and avoid redundant frameworks or tooling.

## Dependencies

None.

## Expected tests

- Clean installation, successful build, lint, type checking, and a passing test-runner smoke test.
- Verify the integration command discovers the intended suite without silently counting zero tests as completed integration coverage.
