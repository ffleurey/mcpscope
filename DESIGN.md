# Current design

## Core principle

The backend is the canonical source of truth for runtime state.

The frontend should display and operate on backend state, not maintain its own parallel interpretation of the conversation.

## Canonical entities

The runtime is modeled through connected backend records:

- `Session`
- `Turn`
- `Round`
- `Part`
- `RawExchangeRecord`

That model is designed so the following stay connected:

- what the user sees in transcript history
- what the model sees in later context
- what tokens were attributed to each meaningful block
- what raw LM and MCP traffic produced those blocks

## Transcript vs context

The system intentionally separates two views of the same run:

### Transcript

The transcript preserves the full user-visible history, including reasoning blocks and tool activity needed for analysis.

### Context

The context view contains only what should be sent back to the model on later turns. Reasoning is removed from this view after the turn completes.

This distinction is central to the product: we want rich diagnostics without polluting later prompt state.

## Streamed capture

True reasoning/tool/content ordering is taken from streamed LM Studio events, not guessed from a final merged completion.

The runtime captures:

- reasoning deltas
- content deltas
- tool-call deltas
- final usage payloads

These are persisted as ordered parts so multi-block reasoning inside a single tool-enabled turn remains inspectable.

## Token accounting

The design goal is not to force fake exactness where the upstream API does not provide it. The rules are:

- use exact probe and prompt-delta data whenever derivable
- persist probe requests and responses so accounting is auditable
- use proportional allocation only when the API exposes a grouped total rather than per-segment totals

## Trace export

The trace endpoint exports the complete backend representation of a run:

- session
- turns
- rounds
- parts
- raw exchanges
- transcript
- context

This is a product feature, not a testing hack. A captured run should be usable for debugging, support, analysis, and deterministic replay.

## Replay strategy

Replay happens at the backend runtime seam:

- feed recorded user turns
- replay recorded LM behavior
- replay recorded MCP behavior
- compare the resulting backend trace to the original

That keeps local regressions close to real runtime behavior without depending on live nondeterministic services.

## Current architectural direction

Backend design is now in a good enough state to build on. The next design task is to simplify the frontend around these backend surfaces rather than adding more logic on the client side.
