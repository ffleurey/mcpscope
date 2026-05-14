# backend-data

Local backend runtime data and live-test captures.

This folder is intentionally **not** a source tree. It is the working data area for the backend and for integration-test artifacts generated on a developer machine.

## Structure

- `mcpscope.db` - local SQLite database used by the backend
- `mcpscope.db-shm` / `mcpscope.db-wal` - SQLite side files when WAL mode is active
- `test-artifacts/` - JSON captures written by the live integration tests

Only this README is tracked in git. The database files and JSON artifacts are local outputs.

## How it is used

### Backend runtime

The backend stores its local state here by default. That includes sessions, turns, rounds, parts, raw exchanges, and profile snapshots.

### Live integration captures

`npm run test:integration` writes selected captures into `test-artifacts/`.

These files are not the main regression layer by themselves. Their purpose is:

1. verify the live LM Studio + MCP path
2. preserve representative raw outputs from real runs
3. provide traces that can be promoted into deterministic replay tests

We intentionally keep **trace** captures, not redundant transcript/context side files, because the trace already contains transcript and context.

## Current artifact inventory

| File | Source test | Purpose |
| --- | --- | --- |
| `lmstudio-models.json` | LM Studio integration | Captured result of listing available LM Studio models. |
| `lmstudio-simple-completion.json` | LM Studio integration | Captured non-streamed sanity-check completion and usage payload. |
| `mcp-initialize.json` | MCP integration | Captured MCP session initialization response. |
| `mcp-tools-list.json` | MCP integration | Captured MCP tool catalog from the local server. |
| `runtime-create-session.json` | Runtime integration: model-only | Captured session creation response before executing a backend turn. |
| `runtime-model-only-turn.json` | Runtime integration: model-only | Captured result of a complete backend turn without MCP tools. |
| `runtime-trace.json` | Runtime integration: model-only | Full exported trace for the model-only scenario. |
| `runtime-tool-turn.json` | Runtime integration: tool-enabled | Captured result of a single tool-enabled backend turn. |
| `runtime-tool-trace.json` | Runtime integration: tool-enabled | Full exported trace for the tool-enabled scenario. |
| `runtime-temperature-turn-1.json` | Runtime integration: temperature multi-turn | First turn of the outdoor-temperature analysis scenario. |
| `runtime-temperature-turn-2.json` | Runtime integration: temperature multi-turn | Second turn of the outdoor-temperature analysis scenario. |
| `runtime-temperature-trace.json` | Runtime integration: temperature multi-turn | Full exported trace for the two-turn temperature scenario. |
| `runtime-temperature-stress-turn.json` | Runtime integration: temperature stress | Captured result of the higher-cap stress turn with many tool calls. |
| `runtime-temperature-stress-trace.json` | Runtime integration: temperature stress | Full exported trace for the stress scenario. |

## Cleanup rule

If an artifact file is no longer produced by the current integration tests, remove it instead of letting stale captures accumulate.
