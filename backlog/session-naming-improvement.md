# Session naming improvement

This task tightens session-title behavior so **user-provided titles stay stable** and the CLI can rename sessions intentionally.

## Problem

Today, session titles can be changed automatically after creation.

Current behavior:

- `mcpscope create "My title"` sends the requested title and the session is created with that title
- but when the **first turn** completes, backend turn-finalization logic replaces the session title with the first prompt text
- that happens for both:
  - model-only turns
  - tool-enabled turns

This creates a bad UX for scripted and agent-driven workflows:

- the user explicitly names a session
- the title later changes behind their back
- the CLI has no direct rename command to correct or manage titles intentionally

## Goal

Make session naming predictable and user-controlled:

1. if the user has explicitly named the session, that title must **not** be overwritten by automatic first-prompt titling
2. sessions that were never explicitly named may still use an automatic title if we still want that behavior
3. the CLI should expose an explicit rename command

## Desired behavior

### 1. Preserve explicit titles

If a session title was set intentionally by the user, it should remain stable until the user changes it.

Examples of explicit naming:

- `mcpscope create "my evaluation"`
- Web UI creation with a provided title
- Web UI manual rename
- future CLI rename command

Once a session is explicitly named:

- first prompt submission must not overwrite the title
- later prompts must not overwrite the title

### 2. Keep auto-titling only for unnamed sessions

If the product still wants an automatic first-prompt title, that behavior should apply only to sessions that are still effectively **untitled**.

That means the implementation needs a clear distinction between:

- title chosen by the user
- title derived automatically
- default placeholder title such as `New session`

The important product rule is:

> **Automatic titling must never overwrite an explicit user title.**

### 3. Add a CLI rename command

Add an explicit CLI command to rename an existing session.

Recommended command:

- `mcpscope rename <session-id> <title>`

Minimum expectations:

- calls the existing backend rename endpoint
- prints the updated title in text mode
- supports `--json`
- fails clearly for missing sessions or invalid input

## API and model implications

The current backend can rename a session manually through:

- `PATCH /api/sessions/:sessionId`

But the runtime currently has no durable notion of whether the current title is:

- user-owned
- auto-generated
- still a placeholder

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

Then runtime turn-finalization logic can safely auto-title only when the current title is still eligible for auto-replacement.

If the implementation can achieve the same behavior without a new persisted field, that is acceptable only if the rules remain explicit and robust.

## Scope

### Backend

- stop automatic first-prompt titling from overwriting explicit user titles
- define and persist whatever state is needed to distinguish explicit vs automatic titles
- keep manual rename working through `PATCH /api/sessions/:sessionId`
- add deterministic tests for:
  - explicit create title survives first turn
  - default/untitled session can still be auto-titled if that behavior remains enabled
  - manual rename survives later turns
  - model-only and tool-enabled first turns behave consistently

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
- this is not just a CLI issue; it is a runtime/session-lifecycle behavior issue
- the rule must hold for all turn-entry paths, not just one code path

## Expected result

After this task:

- CLI-created sessions keep the title the user gave them
- user-renamed sessions keep that title
- automatic titling, if retained, applies only to sessions that were never explicitly named
- the CLI has a first-class rename command
