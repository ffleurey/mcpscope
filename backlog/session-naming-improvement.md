# Session naming improvement

This task now covers the **remaining advanced naming work** after the shipped `fix/session-title-preservation` fix.

## Status

The release-safe naming fix is already done:

- explicit titles are no longer overwritten by first-turn auto-titling
- unnamed sessions may still be auto-titled from the first prompt

That completed work lives in:

- `backlog/done/fix-session-title-preservation.md`

## Problem

The runtime still has no durable notion of whether a title is:

- user-owned
- auto-generated
- still just a placeholder

And the CLI still has no explicit rename command.

So while the release blocker is fixed, the broader naming model is still underspecified and incomplete.

## Goal

Make naming fully intentional and durable:

1. persist title ownership/source in the runtime model
2. add an explicit CLI rename workflow
3. keep backend, CLI, and UI semantics aligned

## Desired behavior

### 1. Persist title ownership/source

The runtime should distinguish between:

- title chosen by the user
- title derived automatically
- default placeholder title

The important product rule remains:

> **Automatic titling must never overwrite an explicit user title.**

### 2. Add a CLI rename command

Add an explicit CLI command to rename an existing session.

Recommended command:

- `mcpscope rename <session-id> <title>`

Minimum expectations:

- calls the existing backend rename endpoint
- prints the updated title in text mode
- supports `--json`
- fails clearly for missing sessions or invalid input

### 3. Keep UI and backend semantics aligned

Manual rename from the UI should follow the same backend-owned rules as CLI rename.

## API and model implications

The current backend can already rename a session manually through:

- `PATCH /api/sessions/:sessionId`

But the runtime still does not persist whether the current title is:

- user-owned
- auto-generated
- placeholder

This task should settle that explicitly.

## Likely design direction

The cleanest solution is to persist title ownership/source in the session model.

Possible shape:

- `titleSource = user | auto | placeholder`

Equivalent naming is fine, but the behavior must support these transitions:

1. session created with explicit title → `user`
2. session created without explicit title → `placeholder`
3. first prompt auto-titles an unnamed session → `auto`
4. manual rename from UI or CLI → `user`

Then runtime behavior can safely decide when automatic title replacement is still allowed.

## Scope

### Backend

- define and persist whatever state is needed to distinguish explicit vs automatic titles
- keep manual rename working through `PATCH /api/sessions/:sessionId`
- add deterministic tests for:
  - manual rename survives later turns
  - title-source transitions behave as intended
  - auto-title eligibility follows the persisted title source rather than a string heuristic
  - UI/CLI rename paths produce the same durable semantics

### CLI

- add `mcpscope rename <session-id> <title>`
- support text and JSON output
- surface backend rename errors clearly

### UI

- existing UI rename behavior should stay aligned with the new backend semantics
- no major UI redesign is required

## Important design notes

- title changes must be intentional and predictable
- backend behavior should be the source of truth, not CLI-only or UI-only rules
- the release-safe preservation fix is already shipped and should stay out of scope here
- this task is now mainly about durable title ownership and intentional rename semantics

## Expected result

After this task:

- title ownership/source is explicit in the runtime model
- user-renamed sessions keep that title
- automatic titling, if retained, applies only to sessions eligible for automatic replacement
- the CLI has a first-class rename command
