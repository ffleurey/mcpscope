# mcpscope Agent Guide

mcpscope is a backend-centered runtime analysis tool for MCP and multi-turn LLM workflows. Optimize for correctness, inspectability, and parity across the backend API, CLI, MCP interface, and thin Svelte frontend.

## Fast Start

Read only what the task needs:

- [README.md](README.md) for the repo map and dev commands
- [ARCHITECTURE.md](ARCHITECTURE.md) for runtime flow, persistence, execution, and adapters
- [DATA-MODEL.md](DATA-MODEL.md) for sessions, turns, rounds, parts, and canonical IDs
- [TESTING.md](TESTING.md) for regression strategy and test selection
- [CLI.md](CLI.md) and [MCP.md](MCP.md) for command and tool behavior

The docs above are references, not pre-read requirements. Keep context lean and open only the specific files needed for the task at hand.

## Project Shape

- The backend owns canonical runtime state, persistence, and shared operation semantics.
- SQLite is the canonical store.
- The frontend is a thin client over backend state.
- The CLI is a remote adapter over the backend API.
- The MCP interface executes backend operations directly and does not use loopback HTTP.
- Shared CLI/MCP behavior comes from the backend operation catalog in [backend/src/operations/](backend/src/operations/).

## Working Style

- Do not treat [backlog/](backlog/) as up-to-date documentation or a template source.
- Only consult a specific backlog file when the task instructions explicitly name it.
- Use the assigned task brief and the canonical docs it names as the source of truth for the work.
- Treat the existence of other docs as useful background, not as a reason to preload them.
- Keep the first change narrow and local to the owning backend abstraction.
- Prefer backend-owned semantics over adapter-specific behavior.
- Keep machine-readable result shapes in `snake_case`.
- Treat [backend-data/](backend-data/) as local runtime and test-artifact state only.

## Engineering Standards

- Avoid adding new libraries, new architecture, or accidental complexity unless the task explicitly requires it.
- Prefer simplification, generalization, maintainability, and testability over quick fixes.
- Leave the codebase in better shape after each task than it was before.
- Use existing patterns and root-cause fixes before inventing new ones.

## Validation

Choose the smallest check that matches the change:

- `npm test` for deterministic backend and replay regressions
- `npm run check:backend` for backend TypeScript changes
- `npm run check:cli` for CLI changes
- `npm run check` for frontend changes
- `npm run test:integration` only when the change needs live LM Studio or MCP validation

## High-Value References

- [backend/src/operations/catalog.ts](backend/src/operations/catalog.ts) for shared command and tool semantics
- [backend/src/mcp/server.ts](backend/src/mcp/server.ts) for MCP adapter behavior
- [backend/src/app.test.ts](backend/src/app.test.ts) for backend/app regression patterns
- [backend/src/testing/replayHarness.ts](backend/src/testing/replayHarness.ts) for trace replay tests
