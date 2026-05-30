When session creation fails during initialization, the UI currently leaves behind a dead session entry that has to be deleted manually.

## Goal

Make session creation atomic from the user's point of view: either the session initializes successfully and is usable, or it is not kept at all.

## Behaviour

- when the user creates a session, validate and initialize it before considering it created
- if initialization succeeds, keep the session normally
- if initialization fails, surface the error clearly and do **not** leave a dead session in the database or UI
- if a session record must be created before initialization completes, it should be deleted automatically on failure

## Why this matters

- dead sessions are confusing for users
- they create cleanup work by hand
- they are especially harmful for the planned CLI and shared UI/CLI session model, where agents need to trust that listed sessions are real and usable

## Scope

- fix failed session initialization cleanup in the UI flow
- ensure the session list only shows usable sessions
- use the same rule for future CLI session creation: failed initialization must not leave a half-created session behind

## Notes

- this is separate from general error reporting, but closely related
- likely failure cases include unreachable LM Studio, unreachable MCP server, or invalid model/session configuration
