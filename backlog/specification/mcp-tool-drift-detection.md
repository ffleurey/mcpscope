If an MCP server is updated after a session was created, the tool definitions in use for that session may no longer match the live server. Continuing the conversation in this state means the model is working with a different tool set than what the server actually exposes — this makes the session misleading for debugging purposes.

## Goal

Warn the user when the MCP tool definitions for a session no longer match the currently available server definitions. We do not need to prevent use, only to make the mismatch visible.

## When to check

Check when a session is loaded in the chat view (i.e. when the user opens a session). This is the natural "resume" point.

In the future, this could be made configurable so the check also runs at the start of each turn. For now, on load is sufficient and avoids round-tripping to the MCP server on every message.

## What to compare

- tool names
- tool parameter names and types
- tool descriptions

Pure implementation changes (same signature, different behaviour) are not detectable here and are out of scope. We only compare the definition — name, parameters, description — not the behaviour.

## Behaviour

When the session's tool definitions differ from the live server:

- show a clear warning banner or dialog on session load
- state that the session tool definitions are stale relative to the current server
- explain that this means the session may not accurately represent the current MCP server state
- offer:
  - **Continue anyway**: dismiss the warning and proceed
  - **Start new session**: shortcut to the new session screen with the same MCP profile pre-selected

We do not automatically update the session's tool definitions — the existing session should remain as-is so its trace stays coherent.

## What to store

The session already records the tool definition snapshot used during initialization (via the `tool-definitions` part in the trace). The comparison just needs to fetch the current tool list from the MCP server and diff it against that snapshot.

## Trigger for the check

The check requires a live MCP server round-trip. It should only run when:

- the session has a MCP profile configured
- the MCP server URL is available and reachable

If the MCP server is unreachable, skip the check silently — an unreachable server is a separate issue surfaced by the general error handling feature.

## Scope

- detection and warning only, no automatic recovery
- comparison is name + parameters + descriptions — no semantic diff
- check on session load only (with a note that per-turn checking is a future option)
- does not apply to sessions without an MCP profile

## Notes

- this feature depends on the general error handling consolidation being in place first
- the tool definitions are already stored in the session trace as a `tool-definitions` part record
- the MCP test infrastructure (`testMcpProfile`) already fetches available tools — the same mechanism can be reused for the comparison
