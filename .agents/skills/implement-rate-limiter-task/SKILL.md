---
name: implement-rate-limiter-task
description: Implement a task from tasks/ in the Distributed Rate Limiter case study, using its acceptance criteria and expected tests as the definition of done. Use when asked to implement a numbered project task.
---

# Implement a Rate Limiter Task

Deliver the requested task as a focused, verifiable change.

1. Identify the task file supplied by the user. If none is specified, ask which task to implement.
2. Read `AGENTS.md`, the task, `docs/01-prd.md`, `docs/02-technical-design.md`, and relevant decisions in `docs/adr/`. Resolve paths from the repository root. Inspect the existing implementation, tests, working tree, and task dependencies before editing.
3. Use the task's acceptance criteria and expected tests as the definition of done. Implement only that scope, following the repository's conventions. Report ambiguities affecting business behavior before implementing assumptions; surface missing dependencies rather than silently expanding into other tasks.
4. Add automated tests for the required behavior. Run `npm run test:unit`, `npm run lint`, and `npm run typecheck`; run `npm run test:integration` when applicable. Fix failures caused by the changes and distinguish existing failures or unavailable infrastructure from passing checks.
5. Report the files changed, behavior delivered, validation commands and results, and remaining concerns or unmet criteria. Follow `AGENTS.md` for documentation and commit boundaries; implementation alone does not authorize a commit or push.
