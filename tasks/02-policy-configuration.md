# 02 — Load and validate per-key policies

**Status**: Implemented

## Description

Load a small startup JSON configuration and resolve one effective policy per registered API Key. No configuration service or live update mechanism is needed.

## Acceptance criteria

- Read `RATE_LIMIT_CONFIG_PATH`. Required `defaults` contains `capacity` and `refillPerMinute`; `clients` is a nonempty list of objects with `apiKey` and optional overrides of those two fields.
- Use defaults of 100/100 for the demonstration. Each override replaces only its supplied field; request cost stays 1.
- Validate positive safe-integer policy values, distinct client keys matching the nonempty, whitespace-free token format in task 05, valid JSON/schema, and positive Redis timeout/probe settings. Fail startup clearly without logging keys or credentials.
- Both stores receive the same effective policy. Unregistered keys are rejected before store access.
- Policies remain fixed during each run. Tests with changed policies use isolated state.

## Dependencies

01.

## Expected tests

- Defaults, independent overrides, two clients with different policies, and unknown-key lookup.
- Unreadable/malformed configuration, invalid values/types, duplicate clients, and redacted startup errors.
