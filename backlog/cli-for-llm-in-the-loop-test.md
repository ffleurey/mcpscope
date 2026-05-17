# CLI for LLM-in-the-Loop Testing — v2 inspect command

This file now tracks the **next active CLI increment**.

The completed first increment is recorded in:

- [backlog/done/cli-v1-sessions-list.md](done/cli-v1-sessions-list.md)

## Goal

Build the next read-only CLI increment on top of the shipped CLI skeleton so an agent can inspect any existing session object from its ID without loading the UI.

## Foundation

This increment builds on two completed prerequisites:

1. hierarchical IDs and lookup groundwork:
   - [backlog/done/hierachical-ids-system-and-api.md](done/hierachical-ids-system-and-api.md)
2. CLI skeleton + `sessions list`:
   - [backlog/done/cli-v1-sessions-list.md](done/cli-v1-sessions-list.md)

The CLI remains:

- an in-repo entrypoint exposed as **`mcpscope`**
- backend-driven
- installed and versioned with the backend
- rooted in the top-level `cli/` folder

## Current API surface for this increment

This increment should use the existing API surface only:

- `GET /api/sessions`
- `GET /api/lookup/:id`

No backend API work should be needed for this step.

## Active scope

Implement one universal read-only inspect command for:

- a session
- a turn
- a round
- a part

using the existing lookup API.

## Proposed command set for v2

1. `mcpscope inspect <id>`

Expected API mapping:

- `mcpscope sessions list`:
  - finds available session IDs using `GET /api/sessions`
- `mcpscope inspect <id>`:
  - direct targeted lookup via `GET /api/lookup/:id`
  - should work for session / turn / round / part IDs
  - should support both summary and full lookup modes

## Output expectations

Keep the CLI summary-first and script-friendly.

At minimum:

- text output should stay compact and useful for humans/agents
- JSON output should remain stable and clean
- structured modes must not mix text with JSON on stdout

The existing conventions from v1 should carry forward:

- `--url`
- `MCPSCOPE_URL`

Output format flags (boolean, opt-in):

- `--json`: output JSON instead of text (default: text)
- `--short`: return summary only, no content (default: full content)

## What should not be included yet

Still out of scope for this increment:

- session creation
- turn execution
- replay
- compare
- async job control
- cancellation
- broad configuration management

## Notes on API intent

The API should now be treated as consolidated:

- `/trace` is the canonical **full session** payload
- `/lookup/:id` is the canonical **targeted object inspection** payload
- removed standalone `/transcript` and `/context` session endpoints should not be reintroduced

For this increment specifically, `inspect <id>` should be enough after `sessions list`. We do not need separate read-only fetch commands for sessions, turns, rounds, or parts.

## Increment plan

### 1. Targeted inspect command

- implement `mcpscope inspect <id>`
- support session / turn / round / part IDs
- use lookup as the primary targeted inspection API
- `--json` flag for JSON output (default: text)
- `--short` flag for summary mode (default: full content)

### 2. Final consistency pass

- keep help text, command naming, and examples aligned
- confirm no accidental backend/API drift was introduced
- keep the repo green
