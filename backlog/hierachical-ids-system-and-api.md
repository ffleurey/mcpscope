# Hierachical IDs System and API

mcpscope should introduce a canonical hierarchical ID system for sessions, turns, rounds, and parts, together with a generic JSON API operation that resolves any such ID.

This is a foundational task for human/agent collaboration and a prerequisite for the CLI work.

## Goal

Create a shared reference system that works consistently across:

- backend
- Web UI
- future `mcpscope-cli`

The same ID should let a human and a coding agent talk about the same object without ambiguity.

## Core idea

The ID format should be hierarchical and encode ancestry directly.

Target shape:

- `SSS` -> session
- `SSS.T` -> turn
- `SSS.T.R` -> round
- `SSS.T.R.P` -> part

The exact formatting of each segment can be refined, but the important properties are:

- stable
- human-readable
- easy to copy
- unambiguous
- enough to determine object type from segment count

## Required backend capability

Add one generic lookup operation that accepts a hierarchical ID and returns the object represented by that ID.

Examples:

- session ID -> return that session
- turn ID -> return that turn
- round ID -> return that round
- part ID -> return that part

The backend should parse the ID, infer the target type, resolve the object, and return a JSON response that includes:

- `id`
- `type`
- parent IDs as relevant
- object data

## Summary mode

The lookup operation should support a summary mode so callers can navigate cheaply before fetching details.

Summary mode should return:

- the target object's key metadata
- the list of child IDs or child summaries needed to navigate deeper

Examples:

- session summary -> turn IDs
- turn summary -> round IDs
- round summary -> part IDs
- part summary -> metadata/preview only

This allows an agent to discover nested IDs without loading the full session tree.

## API shape

This API should be **JSON-only**.

The backend should not try to produce CLI-friendly text formatting. That is a client concern.

The Web UI and future CLI should both consume structured JSON and render it differently:

- UI -> visual rendering
- CLI -> text or JSON output depending on mode

## UI work

The UI should adopt the ID system before the CLI exists.

Required UI outcomes:

- show IDs for sessions, turns, rounds, and parts
- make IDs easy to copy
- make the hierarchy visible enough that humans can reference objects confidently

This is valuable even before the CLI is implemented because it improves human-to-human and human-to-agent collaboration.

## Why do this before the CLI

This task de-risks the CLI by validating:

- the ID model
- lookup semantics
- persistence and stability
- how useful IDs are in actual UI workflows
- whether summary-mode navigation is sufficient

If this is in place first, the CLI can be mostly a thin client over already proven backend and UI concepts.

## Scope

- define the canonical hierarchical ID format
- make IDs stable and available across the model
- add generic hierarchical lookup by ID
- support summary mode and full mode
- return JSON only
- expose IDs in the UI
- support easy copy of IDs in the UI

## Non-goals

- full CLI implementation
- auth concerns
- final command naming for the CLI
- broad backend API redesign beyond the few additions needed for generic lookup

## Plan

1. Define the exact ID format and rules.
2. Implement backend parsing and resolution for hierarchical IDs.
3. Implement JSON lookup response shape for summary and full modes.
4. Add tests for session / turn / round / part lookup.
5. Expose IDs in the UI.
6. Add copy-friendly UI affordances.
7. Validate the workflow in the UI before starting CLI implementation.

## Dependency

This task should be completed before implementing `mcpscope-cli`.
