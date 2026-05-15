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

- `AB12` -> session
- `AB12.3` -> turn
- `AB12.3.3` -> round
- `AB12.3.3.1` -> part

The exact formatting of each segment can be refined, but the important properties are:

- stable
- human-readable
- easy to copy
- unambiguous
- enough to determine object type from segment count

## ID format decision

The current preferred format is:

- **session ID**: short random 4-character uppercase alphanumeric token
- **turn ID**: `SESSION.<turnNumber>`
- **round ID**: `SESSION.<turnNumber>.<roundNumber>`
- **part ID**: `SESSION.<turnNumber>.<roundNumber>.<partNumber>`

Example:

- `I8TS`
- `I8TS.3`
- `I8TS.3.3`
- `I8TS.3.3.1`

### Session ID charset

The allowed session ID characters should be:

- uppercase letters
- digits

with the following characters excluded to avoid ambiguity:

- `0`
- `O`
- `1`
- `I`

### Session ID creation rules

- on session creation, generate a random 4-character ID by default
- check whether it already exists
- if it exists, generate another one
- fail after **3 attempts**

This only applies at session creation time.

The UI may also allow the user to provide the session ID explicitly. If the user or a future agent provides an ID, the system should:

- validate it immediately
- fail immediately if it already exists
- not silently rewrite it

### Numbering inside a session

Turn, round, and part numbers should be sequence numbers within their parent.

The current direction is to use **0-based numbering** for those sequence numbers. This keeps the mapping simple if internal indexing is already zero-based, and it is still understandable for developers and coding agents.

The important rule is not whether the numbers start at 0 or 1, but that they are:

- stable
- predictable
- not renumbered later

## Rationale

### Why a short random session ID

The session ID should be short because:

- users may need to read, say, or type it
- coding agents may refer to it repeatedly in prompts and commands
- this is a local tool, so the total number of sessions is expected to stay relatively small

For that reason, the current direction is to prefer a **short 4-character ID** over a longer identifier, and simply check for collisions when creating a session.

If a collision happens, the backend should generate a new candidate until it finds a free one, up to the defined retry limit.

This keeps the ID compact without giving up correctness.

### Why sequence numbers inside a session

Turns, rounds, and parts should use simple sequence numbers within their parent.

This gives:

- stable ordering
- easy human understanding
- easy parsing
- easy navigation in UI and CLI

It also means the canonical ID stays compact and readable.

### Why the session ID should be separate from the session name

The session ID should not try to replace user naming.

Users and coding agents should remain free to give sessions meaningful names for their own workflow, while the canonical ID provides a short, stable reference for lookup and collaboration.

This is an important benefit of the design:

- **name** = meaningful label for humans or agents
- **ID** = short stable reference for the system

### Parallel parts

Parallel execution inside a round does not prevent this numbering scheme from working.

Part numbers should represent the stable persisted order of parts inside the round. Even if multiple operations happened concurrently, each part still gets a single immutable sequence number.

If we later need richer concurrency information, that should be represented in additional fields, not in the ID format itself.

## Object model returned by lookup

The lookup API should return only the meaningful structured content needed by the UI and future CLI. It should not expose low-level LM Studio transport details or other raw technical exchange data.

The relevant part kinds to expose are:

- **setup**
- **user_prompt**
- **reasoning**
- **tool_call**
- **assistant_answer**

Expected payload by part kind:

- **setup** -> setup-specific summary plus token sizes
- **user_prompt** -> text content and token size
- **reasoning** -> text content and token size
- **tool_call** -> tool name, tool call payload, tool response payload, token size
- **assistant_answer** -> text content and token size

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

Invalid ID format and not-found IDs should return clear error codes and JSON error payloads.

## Summary mode

The lookup operation should support a summary mode so callers can navigate cheaply before fetching details.

Summary mode should return:

- the target object's key metadata
- the list of child IDs or child summaries needed to navigate deeper
- for nested parts, summary information without full text or full tool payloads

Examples:

- session summary -> turn IDs
- turn summary -> round IDs
- round summary -> part IDs
- part summary -> part type, name/tool name as relevant, token size, preview metadata only

This allows an agent to discover nested IDs without loading the full session tree.

### Summary vs full mode

**Summary mode** should include enough information to navigate and understand structure without loading the full content.

For sub-parts, that means including relevant summary fields such as:

- part type
- part label/name
- tool name when the part is a tool call
- token size

but **not**:

- full reasoning text
- full user prompt text
- full assistant answer text
- full tool request/response payloads

**Full mode** should include the full content relevant to the target object:

- full text for prompt / reasoning / assistant answer
- full payloads for tool calls and tool responses
- the structured data needed by the UI and future CLI

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
- start in Inspect mode first

The initial UI affordance can be simple:

- show the ID as a tag in Inspect mode
- clicking the tag copies the ID

To exercise the new API directly from the frontend, Inspect mode should also expose buttons that:

- fetch the selected object by ID in **summary** mode
- fetch the selected object by ID in **full** mode
- show the returned JSON in the existing JSON dialog

This gives us a simple way to validate the API from the UI before the CLI exists, and may later replace some existing Inspect-mode actions.

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
- add Inspect-mode buttons to fetch by ID in summary/full mode

## Non-goals

- full CLI implementation
- auth concerns
- final command naming for the CLI
- broad backend API redesign beyond the few additions needed for generic lookup

## Plan

1. Finalize the exact session ID charset, numbering rules, collision handling, and validation rules.
2. Implement session ID generation and explicit-ID validation at session creation time.
3. Implement backend parsing and generic resolution for hierarchical IDs.
4. Implement JSON lookup response shapes for summary and full modes.
5. Add basic automated tests for:
   - session creation ID generation / collision handling
   - lookup by ID at session level
   - lookup by ID at turn level
   - lookup by ID at round level
   - lookup by ID at part level
6. Expose IDs in the UI Inspect mode.
7. Add copy-on-click ID tags in Inspect mode.
8. Add Inspect-mode buttons to fetch summary/full JSON via the new API and show the results in the existing JSON dialog.
9. Do manual UI smoke testing of the full workflow before starting CLI implementation.

## Testing approach

Keep the first automated coverage simple and focused.

### Automated tests

- session creation with random ID generation
- collision handling and retry behavior
- explicit provided ID validation
- generic lookup by hierarchical ID for:
  - session
  - turn
  - round
  - part

### Manual UI smoke tests

- ID tags are visible in Inspect mode
- clicking an ID copies it
- summary fetch button returns the expected JSON shape
- full fetch button returns the expected JSON shape
- the JSON dialog allows the API to be inspected end to end from the frontend

## Status update

### Done

- canonical hierarchical IDs are implemented for sessions, turns, rounds, and parts
- explicit session IDs are supported and validated
- `GET /api/lookup/:id?mode=summary|full` is implemented
- IDs are shown in the UI and can be copied in Inspect mode
- Inspect mode can fetch lookup JSON for session, turn, round, and part IDs
- automated backend regression coverage now uses a real exported multi-turn trace with tool calls
- lookup regression tests now assert summary/full payloads for session, turn, round, and part
- setup/system-prompt content is now blocked from leaking through direct part lookup payloads
- round lookup no longer exposes low-level `requestPayloadJson` / `responseTraceJson` blobs

### Remaining QA / adjustment work

- manual UI smoke testing is still needed for the Inspect-mode lookup buttons and JSON dialog payloads
- we should verify that turn/round/part lookups in the UI never show session-prelude/setup content unless a setup part is explicitly requested
- lookup payloads still need a field-by-field audit across every node type (session / turn / round / part) and for every exposed event/content kind to confirm we return exactly the intended structured data
- summary-mode payloads should be reviewed once more in the UI to ensure they stay lightweight and do not include full text or full tool payloads
- full-mode payloads still need additional QA to confirm they include the right fields for each node type without leaking extra conversation state
- the placement and visibility of the Inspect-mode lookup buttons in the UI still need follow-up work
- frontend-specific automated coverage for the Inspect-mode lookup actions is still missing

## Dependency

This task should be completed before implementing `mcpscope-cli`.
