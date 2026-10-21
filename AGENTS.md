# Agent Instructions

## Project

Distributed Rate Limiter built with Node.js and TypeScript.

This is a small portfolio case study demonstrating shared rate limiting across multiple API instances. Keep the implementation easy to understand and reproduce, with explicit decisions, tests, and limitations.

## Source of Truth

- Product requirements: docs/01-prd.md
- Technical design: docs/02-technical-design.md
- Architecture decisions: docs/adr/

## Coding Standards

- Use TypeScript with strict typing.
- Name variables for what their values mean at that point in the logic. Prefer clear, concise names; use longer names only when needed to avoid ambiguity.
- Document every interface field with JSDoc explaining its purpose, including units and relevant semantics.
- Follow existing project conventions.
- Separate logical blocks within functions with blank lines; keep closely related statements together and avoid unnecessary spacing.
- Introduce dependencies only when they provide clear value.

## Simplicity and abstractions

- Use the most direct, idiomatic implementation that meets the current requirements.
- Separating responsibilities does not require additional files, interfaces, factories, or layers.
- Prefer native framework and language APIs. Do not create wrappers that merely rename or reorganize those APIs.
- Introduce abstractions only to solve a concrete need in the current code. Do not anticipate future reuse, extensibility, or requirements.
- Testability should guide dependency separation without turning application setup into custom infrastructure.
- Before adding an abstraction, check whether a direct function or an existing API solves the problem with fewer concepts.
- Readability refactors must reduce the concepts needed to follow the flow. Distributing complexity across files is not sufficient.
- Distinguish required behavior from implementation choices; do not treat a self-imposed design as an architectural requirement.
- Keep application construction separate from server startup and process signal handling. Importing application modules must not start the service or register process handlers.
- Keep policy configuration independent of Express. Integrate the rate-limiting libraries directly and use typed context for data passed between middleware.
- Preserve behavior during refactoring and update tests and run instructions when module paths or entry points change.

## Git workflow

- Create one commit per task.
- Keep commits focused and descriptive.
- Run relevant tests before considering work complete.
- Never push directly to main.

## Development Rules

- Implement only the assigned task.
- Respect the documented architecture decisions.
- Write automated tests for new behavior.
- Do not silently change requirements or architecture.
- Report ambiguities before implementing assumptions that affect business behavior.
- Do not commit or push without approval.

## Documentation Rules

- Keep portfolio documents focused on the solution, without progress notes such as "still pending"; track implementation status in tasks.
- Preserve the original structure, storytelling, and voice. Make only necessary additions and corrections instead of rewriting entire documents.
- Update ADRs directly where needed; do not append "Contract Clarification" sections or similar addenda.
- Document the current solution and decisions, preserving relevant alternatives, trade-offs, and limitations. Keep progress in tasks and obtain approval before adding historical or revision notes to portfolio documents.

## Test readability

- Organize tests by the responsibility under test, following source module paths where useful. Keep process lifecycle tests separate from HTTP middleware tests.
- Give each test a specific behavior and a clear setup, action, and assertion sequence. Avoid scenarios that combine unrelated behaviors and cumulative counters.
- Name parameterized cases individually so failures identify the input and expected behavior.
- Keep dependencies and relevant inputs visible in each test. Share only repetitive infrastructure setup; do not build a custom test runtime or hide behavior behind fixture defaults.
- Apply the same naming, spacing, and simplicity standards to tests as to production code. Register cleanup when acquiring servers, clients, or child processes.

## Validation

- Run unit tests.
- Run integration tests when applicable.
- Run lint and type checking.
- Report test failures.

## Delivery

- Summarize implementation changes.
- Document tests performed.
- Identify known limitations.
