# 05 — Automate quality checks

**Status**: Implemented

## Description

Run the existing local checks in [GitHub Actions](../.github/workflows/ci.yml) on pushes and pull requests, without adding another test toolchain or a benchmark platform. The job uses Node.js 24 from `.nvmrc`, a ten-minute timeout, and a health-checked Redis service that GitHub removes when the job ends, including after failures.

## Acceptance criteria

- On Node.js 24, run `npm ci` and `npm run check` (formatting, lint, type checking, build, and unit tests).
- Provide Redis for integration tests and report failures without skipping required infrastructure.
- Use bounded job timeouts and clean up infrastructure after failures.

## Dependencies

4.

## Expected tests

- Execute the workflow with a clean checkout and confirm failed assertions fail the job.

## Validation

- A clean source copy in Linux with Node.js 24 passed `npm ci`, `npm run check` (16 unit tests), and `npm run test:integration` (3 tests).
- An intentionally incorrect assertion in the isolated copy returned exit code 1; the original test was preserved.
- The process shutdown test queues both signals before the child resumes, avoiding a race where the second signal arrives after shutdown.
- The GitHub-hosted workflow has not been run; its first execution requires pushing these changes.
