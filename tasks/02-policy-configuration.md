# 02 — Define demonstration policies

**Status**: Implemented

## Description

Keep the two demonstration clients in a typed table in `src/config.ts`, independent of Express. Avoid file loading and a configuration schema for this fixed example.

## Acceptance criteria

- `demo-client` allows 10 requests per one-minute window; `demo-client-custom` allows 10.
- Keys are case-sensitive and identify clients without authenticating them.
- Policies stay fixed during a run and are identical across instances.
- Unknown keys return 403 before store access. Invalid keys return 400.
- Use fresh Redis state when changing a policy for an experiment.

## Dependencies

1.

## Expected tests

- HTTP policy selection, independent keys, and unknown/invalid keys without store access.
