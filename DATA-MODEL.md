# Runtime Model

This document defines the compact canonical runtime tree used by mcpscope.

It is intentionally small. It is the **canonical mcpscope model** used by persistence, API, UI inspect workflows, and future CLI work.

mcpscope is centered on LLM sessions. Different session types may steer those sessions with
deterministic steps, but they still use the same session tree and persistence model.

For the backing SQLite storage layout, foreign keys, and singleton defaults tables, see [DATABASE-SCHEMA.md](DATABASE-SCHEMA.md).

## Current implementation vs future work

**Implemented today:**

- `SessionContainer` — the domain-level ownership abstraction for sessions
- `Session` — the execution container (also a `SessionContainer`); runs its loop via `execute()` / `advance()` / `canContinue()`
- `Step` — the abstract execution unit; concrete units of work include `Turn` for LLM interaction plus shipped deterministic analysis workflow steps
- `Turn` — the LLM-specific step subtype; owns `Round`, `Part`, and `RawExchange` records, and may optionally belong to one non-turn step for workflow grouping
- the runtime tree described below for persisted sessions (unchanged from user perspective)
- one session contains one setup and zero or more turns
- hierarchical IDs for session/setup/turn/round/part runtime nodes
- session ownership modeled through `SessionContainer`; a session may belong to another session or to a `Benchmark` container
- `Benchmark` — a minimal `SessionContainer` for grouping sessions; full benchmark domain design is future work
- generic persistence for containers, sessions, and steps (`session_containers`, `v2_sessions`, `v2_steps`, `v2_turns`)
- existing child-session behavior still works through the new model

**Not implemented yet:**

- full benchmark-domain product work beyond minimal container support
- broader workflow automation for session sequencing beyond the shipped analysis-session workflow

**Current deliberate limits:**

- normal runtime persistence lives on `session_containers` plus the `v2_*` runtime tables
- session parent rules remain intentionally limited to `session` and `benchmark`
- the current classification rules still follow the existing session-focused parent model rather than a broader container graph

The canonical vocabulary is now `SessionContainer`, `Session`, `Step`, and `Turn`.

The key distinction is:

- `Session` is still the canonical LLM session container
- `Step` is the execution unit inside that session
- `Turn` is the LLM-interaction step subtype
- deterministic steps can steer the session without moving the workflow outside the session model

Current ownership rule:

- non-turn steps may own zero or more turns
- a turn may belong to at most one non-turn step
- containment is intentionally limited to one level

## Canonical tree

The runtime is a tree:

- `Session`
  - one `Setup`
    - setup `Part[]`
  - `Turn[]` (each Turn is a `Step`)
    - `Round[]`
      - round `Part[]`

This is the main mental model for mcpscope.

This runtime tree is the model for **what happens inside a session**.

Sessions may be nested: a session may belong to a parent `Session` (e.g. analysis child sessions) or to a `Benchmark` container.

## Node meanings

- **SessionContainer** — the domain-level ownership container; a Session is itself a SessionContainer
- **Benchmark** — a minimal SessionContainer that is not itself a Session (groups related sessions)
- **Session** — one persisted execution container; runs its execution loop via `execute()` / `advance()` / `canContinue()`
- **Setup** — session-level prelude shared by the whole session
- **Turn** — one full user request lifecycle; the LLM-specific Step subtype
- **Round** — one model iteration inside a turn
- **Part** — one committed semantic content node inside setup or a round

## Object properties

These tables describe the canonical properties of each node in the runtime tree.

### Session

| Property | Type | Meaning |
|---|---|---|
| `id` | `string` | Canonical session ID |
| `title` | `string` | Human-readable session title |
| `model` | `object` | Model metadata needed to understand the run |
| `mcp?` | `object` | MCP profile / strategy metadata when present |
| `context_window` | `object` | Total available context and current usage |
| `setup` | `Setup` | Session-level setup node |
| `turns` | `Turn[]` | Ordered turns in the session |

The table above describes the currently implemented runtime-session shape.

Current implementations may also expose metadata around the session tree such as session type and parent reference, but those fields are not part of the canonical setup/turn/round/part tree itself. See:

- `backlog/candidates/session-types-and-parent-links.md`

### Setup

| Property | Type | Meaning |
|---|---|---|
| `id` | `string` | Canonical setup ID |
| `parts` | `Part[]` | Ordered setup parts: `system_prompt`, `mcp_instructions`, `tool_definitions` |

### Turn

| Property | Type | Meaning |
|---|---|---|
| `id` | `string` | Canonical turn ID |
| `number` | `integer` | Stable turn sequence number within the session |
| `owner_step_id?` | `string` | Owning non-turn step when the turn is grouped under a workflow step |
| `status?` | `string` | Turn lifecycle status when exposed |
| `rounds` | `Round[]` | Ordered rounds in the turn |

### Round

| Property | Type | Meaning |
|---|---|---|
| `id` | `string` | Canonical round ID |
| `number` | `integer` | Stable round sequence number within the turn |
| `status?` | `string` | Round lifecycle status when exposed |
| `parts` | `Part[]` | Ordered parts in the round |

### Part

| Property | Type | Meaning |
|---|---|---|
| `id` | `string` | Canonical part ID |
| `type` | `string` | Canonical part type |
| `token_count` | `integer \| null` | Tokens attributed to the part |
| `context_state` | `string` | Whether the part remains in model-visible context |
| `content?` | `object` | Content payload when the selected mode includes it and the part type carries content |
| `tool_name?` | `string` | Tool name for `tool_call` parts |
| `tool_payload?` | `object` | Tool request / response payloads for direct `tool_call` full lookups |

### Nested property objects

#### `Session.model`

| Property | Type | Meaning |
|---|---|---|
| `name` | `string` | Display name of the model profile |
| `key` | `string` | Stable model identifier |

#### `Session.mcp`

| Property | Type | Meaning |
|---|---|---|
| `name` | `string` | Display name of the MCP profile |
| `strategy?` | `string` | MCP-related strategy or mode when exposed |

#### `Session.context_window`

| Property | Type | Meaning |
|---|---|---|
| `available` | `integer \| null` | Total context window available |
| `used` | `integer \| null` | Current effective usage |

#### `Part.content`

| Property | Type | Meaning |
|---|---|---|
| `text?` | `string` | Full text when included |
| `json?` | `object \| array` | Structured content when relevant |

#### `Part.tool_payload`

| Property | Type | Meaning |
|---|---|---|
| `call?` | `object` | Tool call payload |
| `result?` | `object \| array` | Tool result payload |

## Field presence rules

Use omission and `null` differently:

- **omit** a property when it does not apply to that node type
- **omit** a property when it is pruned by `summary` mode
- use **`null`** only when a property applies but its value is genuinely unknown or unavailable

Examples:

- `tool_name` is omitted on non-`tool_call` parts
- `content` is omitted in `summary` mode
- `tool_payload` is omitted except for direct `tool_call` full lookups
- `token_count` may be `null` if token attribution is not available yet
- `context_window.used` may be `null` if it cannot be computed yet

## Part types

The canonical part types are:

- `system_prompt`
- `mcp_instructions`
- `tool_definitions`
- `user_prompt`
- `reasoning`
- `tool_call`
- `assistant_answer`

Rules:

- `tool_call` is one logical public node that groups the tool call and its tool result payloads
- `diagnostic_note` is excluded from the canonical runtime tree
- setup parts stay distinct as `system_prompt`, `mcp_instructions`, and `tool_definitions`

## Normalization boundary

mcpscope should use one canonical model internally and externally.

Provider-specific transport structures are normalized into this model at the integration boundary.

What this means:

- LM Studio chunks, deltas, and segments are transport-layer concepts, not mcpscope model types
- MCP wire payloads are transport-layer concepts, not mcpscope model types
- the only meaningful semantic grouping called out here is that tool-call and tool-result transport/persistence details are represented as one canonical `tool_call` node

## Canonical IDs

IDs follow the same tree.

Current target shape:

- `AB12` — session
- `AB12.S` — setup
- `AB12.S.1-SP` — setup part
- `AB12.2` — turn
- `AB12.2.1` — round
- `AB12.2.1.3-U` — round part

Part suffixes encode the public part type:

- `SP` — `system_prompt`
- `MI` — `mcp_instructions`
- `TD` — `tool_definitions`
- `U` — `user_prompt`
- `R` — `reasoning`
- `T` — `tool_call`
- `A` — `assistant_answer`

Session IDs should stay short, stable, and human-readable.

## Numbering rule

Turns, rounds, and parts use simple sequence numbers within their parent.

The exact base still needs to be fixed once for the whole public model, but the rule is:

- one consistent numbering convention everywhere
- stable
- predictable
- never renumbered

## Lookup model rules

- canonical IDs address canonical runtime-tree nodes
- session lookup returns the full session tree
- turn lookup returns the selected turn subtree
- round lookup returns the selected round subtree
- part lookup returns the selected part
- summary and full mode use the same structure
- full mode adds allowed content; it does not invent a different object model
- the tables above describe the canonical properties expected on those nodes

## Session classification and parent model

mcpscope persists typed sessions with a parent-link model. This is already implemented:

- each session has a `session_type`: `primary` or `session_analysis`
- some session types carry a `parent_kind` and `parent_id`
- the allowed parent kinds depend on the session type and are enforced at the application-validation layer

Implemented rules:

- `primary` → optional `benchmark` parent
- `session_analysis` → mandatory `session` parent

The backend runtime session-creation flow — including the analysis-launch flow — uses one unified validated `createSession(...)` path. Session type and parent metadata are validated before persistence and never patched afterward in that flow.

Important boundary:

- this is metadata **about sessions**
- it does not change the canonical setup/turn/round/part tree inside the session

What remains future work:

- richer parent object support (e.g. turn-level parents)
- broader workflow/runtime generalization beyond the shipped analysis-session workflow
- benchmark-oriented workflow extension beyond the current minimal model
