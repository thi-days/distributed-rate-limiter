# 07 — Expose enforcement and failure evidence

**Status**: Not implemented

## Description

Add only the evidence needed to explain the experiments: decisions, store mode, transitions, and limiter duration. No observability platform is required.

## Acceptance criteria

- Record allowed/denied counts, distributed/fallback mode, mode changes, and instance identity.
- Instrument the limiter middleware independently of Express response-finish events; handler execution and response transmission must not extend limiter duration.
- Time the limiter with a monotonic clock, from policy lookup through decision/header preparation. Include dependency waiting; exclude the resource handler and HTTP transport.
- Make duration samples and summaries available to the benchmark without logging raw keys/credentials or adding per-key metric labels.
- Avoid repeated transition logs on every request. Recording evidence must not change the decision.

## Dependencies

05, 06.

## Expected tests

- Controlled-clock tests for duration units/boundaries and counters.
- Transition events, redaction, and unchanged allow/deny results with recording enabled.
