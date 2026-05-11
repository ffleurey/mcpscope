# Refactoring status

## Result

The first major refactor is complete: the project has been moved from a fragile frontend-owned runtime toward a backend-first architecture that is testable and replayable.

## What changed

- runtime orchestration moved into the backend
- token and context metadata are now attached to canonical backend entities
- streamed reasoning/tool/content capture replaced coarse round-level reconstruction
- raw LM Studio, MCP, and prompt-probe exchanges are persisted for diagnostics
- full backend traces can be exported and replayed locally

## What was intentionally retired

- frontend-only runtime ownership
- IndexedDB as the primary runtime source of truth
- side-car token/context structures that drift from the displayed history
- reliance on hand-written local fixtures for most end-to-end regressions

## Remaining refactor target

The main remaining refactor is on the frontend side:

- remove duplicated runtime logic
- consume backend transcript/context/trace APIs directly
- keep the UI focused on presentation and workflow

This file now serves as a closure note for the backend refactor rather than an active implementation plan.
