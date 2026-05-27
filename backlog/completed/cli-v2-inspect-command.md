# CLI v2 — `inspect <id>`

This increment added the first universal read-only inspection command to the in-repo `mcpscope` CLI.

## Delivered

- `mcpscope inspect <id>` implemented
- works for hierarchical IDs pointing to:
  - session
  - setup
  - turn
  - round
  - part
- uses the existing targeted inspection API:
  - `GET /api/lookup/:id`
- supports:
  - `--json`
  - `--short`
- keeps existing backend URL resolution:
  - `--url`
  - `MCPSCOPE_URL`
  - fallback default `http://localhost:3030`

## Behavior

- default output is human-readable text
- `--json` passes through the raw lookup payload
- `--short` requests summary-mode lookup
- default mode is full lookup for non-JSON text inspection

The CLI now has two working user-facing commands:

- `mcpscope sessions list`
- `mcpscope inspect <id>`

## Result

After this increment, an agent can:

1. list sessions to discover IDs
2. inspect any session object directly from its hierarchical ID

without using the UI and without requiring new backend endpoints.

## Follow-up

The next active increment should focus on session creation and initialization UX.
