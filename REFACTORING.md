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

## Frontend follow-through

The frontend follow-through that this refactor pointed toward has now been completed at the structural level:

- the active frontend was moved under `frontend/`
- the backend-driven UI path is the active path
- the old browser-owned runtime, IndexedDB chat path, and duplicate MCP browser runtime were removed

## Planning status

This file is **not** the active implementation roadmap.

Use `PLAN.md` for the remaining step-by-step work:

- token counting hardening
- context-bar trust verification
- next product increments on top of the backend-driven MVP

This file remains a closure note for the completed backend-first refactor.
