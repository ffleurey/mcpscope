Several places in the UI already let us inspect JSON configuration or payloads:

- round request / response / raw exchange payloads
- reasoning, tool call, and tool result payloads
- model details and other config-style JSON

The current issue is not discoverability, it is readability:

- no syntax highlighting
- no good line-wrapping behavior for long values

This is a good feature to tackle next, and we should use it as a consolidation pass rather than adding another one-off viewer.

## Product direction

- keep JSON inspection in dialogs, not inline in the main trace layout
- keep one canonical JSON viewer for all structured JSON in the app
- make the JSON dialog clearly better for reading without changing what data is shown
- keep the UI consistent with the markdown preview dialog and other modal surfaces

## Current state

We already have a shared `JsonDialog.svelte`, and it is used in the right places, but it is still very basic:

- it stringifies JSON and renders it in a plain `<pre>`
- it does not highlight syntax
- it does not support wrapping controls
- dialog chrome is duplicated conceptually across `JsonDialog.svelte` and `MarkdownPreviewDialog.svelte`
- dialog state/open helpers are repeated in a few parent components

So the right move is **not** to introduce a new JSON viewer path. The right move is to upgrade the existing shared path and use the refactor to tighten the dialog architecture.

## Architecture goal

We should end up with:

1. **One shared dialog shell**
   - a reusable dialog frame component for backdrop, header, title, close button, sizing, and scroll behavior
   - used by both the markdown preview dialog and the JSON dialog

2. **One shared JSON viewer**
   - a single component responsible for formatting, highlighting, and wrapping JSON
   - embedded inside the JSON dialog
   - reused everywhere we inspect structured JSON

3. **No ad-hoc JSON presentation**
   - no separate JSON modal variants
   - no inline copy-pasted JSON formatting blocks
   - every structured JSON payload goes through the same viewer

## Implementation plan

### 1. Extract the shared dialog shell

- create a small dialog shell component that owns:
  - native `<dialog>` lifecycle
  - backdrop click handling
  - Escape-to-close handling
  - header/title/close button layout
  - body scroll container
- migrate `JsonDialog.svelte` and `MarkdownPreviewDialog.svelte` to use that shell
- keep sizing configurable enough for markdown and JSON, but avoid a highly abstract API

This gives us a single source of truth for modal behavior and visual styling.

### 2. Add a dedicated JSON formatting/highlighting utility

- create a small utility such as `jsonHighlight.ts`
- reuse the existing `highlight.js` dependency rather than adding a new viewer library
- register the JSON language and expose a helper that:
  - converts `unknown` data to `JSON.stringify(data, null, 2)`
  - applies JSON syntax highlighting safely
  - falls back to escaped plain text if highlighting fails

This keeps the feature lightweight and aligned with the existing markdown syntax-highlighting approach.

### 3. Upgrade `JsonDialog` into the canonical viewer

- keep `JsonDialog.svelte` as the public entry point for JSON inspection
- replace the plain `<pre>{formatted}</pre>` body with highlighted output
- support two display modes:
  - **wrapped** for readability
  - **unwrapped** for strict structural inspection
- add a simple header toggle such as `Wrap` / `No wrap`
- choose a sensible default:
  - likely **wrapped by default** for human-readable inspection
  - but keep the toggle one click away for deeply nested payloads

The important point is that the behavior lives in one place, not in each caller.

### 4. Keep all existing JSON entry points on the same path

Audit and keep these call sites on the shared `JsonDialog` path:

- `SessionTurnBlock.svelte`
  - round JSON
  - request payload JSON
  - response trace JSON
  - raw exchanges JSON
- `CompactRoundContent.svelte`
  - reasoning JSON
  - tool call JSON
  - tool result JSON
- `TracePartBlock.svelte`
  - generic part payload JSON
- `ModelConfigs.svelte`
  - model details JSON

If we find any additional structured JSON surfaces while implementing, they should also route through the same component instead of inventing a new variant.

### 5. Make the styling consistent with the rest of the UI

- reuse the same modal chrome as markdown preview
- keep monospace JSON body styling inside the viewer itself
- use the existing color system for punctuation / keys / strings / numbers / booleans / null
- support horizontal and vertical scrolling when wrapping is off
- support `pre-wrap` plus `overflow-wrap: anywhere` when wrapping is on

The visual goal is “clearly code-like, but still easy to read in the product UI”.

### 6. Avoid over-refactoring dialog state

There is some repeated `showDialog / dialogTitle / dialogData / openDialog()` state in parent components.

We should only extract that state if the refactor is obviously cleaner. The priority is:

- shared shell
- shared JSON viewer
- all JSON on one path

If the local state remains small and readable, it is fine to leave it duplicated for now.

### 7. Validation

- verify every current JSON entry point still opens the shared JSON dialog
- verify highlighted output for:
  - objects
  - arrays
  - nested values
  - strings with escaped characters
  - booleans and `null`
- verify wrapping can be toggled without breaking layout
- verify large payloads still scroll correctly
- verify markdown preview still works after moving both dialogs onto the same shell

## Non-goals

- do not replace raw text blocks in the main chat UI with rendered JSON
- do not add an embedded JSON editor
- do not add schema-aware rendering in this pass
- do not add a separate dialog just for one JSON source

## Suggested execution order

1. extract shared dialog shell
2. add JSON highlight utility
3. refactor `JsonDialog` to use both
4. confirm all existing JSON call sites still use `JsonDialog`
5. tune wrap/highlight styling
6. run the normal frontend validation pass
