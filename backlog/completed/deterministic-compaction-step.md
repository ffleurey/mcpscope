# Deterministic compaction step

This task implemented the first real deterministic `Step` on top of the new session execution model.

It was intentionally simple in business logic. The point of the task was not to invent a sophisticated compaction strategy. The point was to prove that deterministic work can exist as a first-class, inspectable runtime object across backend persistence, trace APIs, CLI, MCP, and UI.

## Why this task existed

The execution-model refactor introduced the canonical vocabulary:

- `SessionContainer`
- `Session`
- `Step`
- `Turn`

But compaction was still effectively a hidden post-turn mutation.

That meant the project had the new `Step` abstraction in theory without yet using it for real product behavior. The first follow-up should therefore be a deterministic step that is easy to reason about and easy to validate end to end.

Compaction was the right first candidate because:

- it already existed as deterministic behavior
- it already changed runtime state in a meaningful way
- it is operationally important to inspect when debugging context behavior
- it is simpler than broader workflow-style deterministic steps

## Goal

Make post-turn compaction a real deterministic `Step` that:

1. is persisted in the canonical runtime model
2. has its own hierarchical ID
3. appears in trace/session structures as a first-class step
4. is inspectable through backend lookup, CLI, MCP, and UI
5. exposes evidence about what was removed from context

## Scope delivered

### 1. Compaction persisted as a real step

Compaction now writes a generic `v2_steps` row with a stable compaction step ID such as `SESSION.C1`.

The persisted step records:

- strategy
- source turn reference
- stripped part IDs
- stripped part count
- context token totals before and after compaction
- tokens removed

Turn ordinal allocation was also corrected so non-turn steps can be interleaved safely with turns.

### 2. Trace contract extended with generic steps

The canonical trace bundle now includes `steps` alongside existing `turns`, `rounds`, `parts`, and `rawExchanges`.

This preserved backward compatibility for existing turn-oriented consumers while exposing the more general execution structure needed by the refactor.

### 3. Hierarchical inspect support added for steps

Hierarchical lookup now supports deterministic step IDs such as:

- `SESSION.C1`

Session inspection includes ordered `steps`, and direct step inspection returns the step payload itself.

For compaction steps, inspect now exposes:

- the stripped part IDs in summary and full mode
- per-part stripped evidence in full mode
- baseline removal reasons for the current `strip-reasoning` strategy

### 4. CLI, MCP, and UI parity landed

The CLI and MCP inspect surfaces now show compaction as a first-class step instead of as hidden turn metadata.

The frontend session view renders compaction steps as explicit siblings after their source turns.

This makes the runtime tree visible in the product rather than only in persistence.

### 5. Redundant diagnostic child parts were removed

An early version of the implementation represented compaction with both:

- a `Step`
- a synthetic `diagnostic-note` child part

That extra part turned out to be redundant because the step itself already carried the canonical structured evidence.

The final implementation removed that synthetic child part entirely and added cleanup so legacy compaction diagnostic parts are no longer shown.

## Non-goals

This task did not attempt to:

- generalize all UI/session rendering around arbitrary future step types
- design richer deterministic workflow steps beyond compaction
- redesign benchmark/session parent semantics
- broaden compaction strategy behavior beyond the existing `strip-reasoning` logic

## Validation

The work was validated with focused checks across the touched surfaces, including:

- `npm run check:backend`
- `npm run check:cli`
- `npm run check`
- `npm test -- backend/src/sessionMetadata.test.ts`
- `npm test -- backend/src/app.test.ts -t "deterministic compaction steps|lookup payloads|trace bundle"`

Additional manual verification was performed against real sessions through both CLI and MCP inspection.

## Result

mcpscope now has a concrete proof that the `Step` abstraction is not just preparatory architecture.

Compaction is the first shipped deterministic step that is:

- persisted canonically
- inspectable with stable IDs
- visible across UI, CLI, and MCP
- able to show exactly which context parts were removed and why

That makes the execution-model refactor materially real and establishes the baseline for future deterministic workflow steps.