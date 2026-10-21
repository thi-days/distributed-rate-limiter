# 06 — Publish concise portfolio evidence

**Status**: Implemented

## Description

Keep the existing case-study structure while explaining what the small demonstration proves and what it leaves out.

## Acceptance criteria

- README explains the shared limit, library choices, commands, and two experiments.
- Technical design and ADRs describe fixed windows and fail-open consistently.
- State clearly that Redis failures leave the API without rate-limit protection; explain when local fallback, available Redis, or rejecting requests would be appropriate.
- Document window-boundary bursts, lost counters, and requests not counted during outages.
- Record actual validation in `docs/03-test-results.md` without claiming production protection or an unmeasured latency target.

## Dependencies

4.

## Expected tests

- Reproduce documented setup and requests; check links and consistency with the current implementation.
