# mcpscope Agent Guide

This guide is for agents working on **mcpscope's own code**. If you are an agent (or configuring
one) **using mcpscope to test an MCP server**, you want [MCP.md](MCP.md) and
[EXAMPLE.md](EXAMPLE.md) instead — mcpscope speaks MCP itself.

mcpscope is a backend-centered runtime analysis tool for MCP and multi-turn LLM workflows. Optimize for correctness, inspectability, and parity across the backend API, CLI, MCP interface, and thin Svelte frontend.

## Fast Start

Read only what the task needs:

- [README.md](README.md) for the product overview and the **Documentation** index of every doc — start there if the right file isn't listed below; [DEVELOPMENT.md](docs/DEVELOPMENT.md) for run-from-source and dev commands
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) for runtime flow, persistence, execution, and adapters
- [DATA-MODEL.md](docs/DATA-MODEL.md) for sessions, turns, rounds, parts, and canonical IDs
- [DATABASE-SCHEMA.md](docs/DATABASE-SCHEMA.md) for the SQLite tables behind that model
- [TESTING.md](docs/TESTING.md) for regression strategy and test selection
- [CLI.md](CLI.md) and [MCP.md](MCP.md) for command and tool behavior
- [BENCHMARK.md](BENCHMARK.md) for the benchmark suite/case/run feature, deterministic metrics, and LLM rubric evaluation — the latter is implemented **as a `benchmark_evaluation` analysis workflow** (one judge session per run-session), so it shares the analysis subsystem rather than being a separate engine; treat the two as one mechanism when changing either
- [PROVIDERS.md](docs/PROVIDERS.md) when touching reasoning, token counting, or context-window handling across LM Studio / Ollama / OpenRouter
- [DESIGN-SYSTEM.md](docs/DESIGN-SYSTEM.md) **before any frontend visual change** — tokens, shared primitives, and patterns. Reuse the primitives; keep `DESIGN-SYSTEM.md`, `frontend/src/app.css`, and the live Design System Reference (`DesignReference.svelte`) in sync.

The docs above are references, not pre-read requirements. Keep context lean and open only the specific files needed for the task at hand.

## Project Shape

- The backend owns canonical runtime state, persistence, and shared operation semantics.
- SQLite is the canonical store.
- The frontend is a thin client over backend state.
- The CLI is a remote adapter over the backend API.
- The MCP interface executes backend operations directly and does not use loopback HTTP.
- **CLI/MCP parity is a hard principle: the CLI and the MCP interface expose exactly the
  same agent-facing capabilities — the same functions through two technical interfaces,
  function-for-function.** Both derive from the shared backend operation catalog in
  [backend/src/operations/](backend/src/operations/): every catalog operation becomes a
  `mcpscope <id>` CLI command and a `mcpscope_<id>` MCP tool. Never add an agent-facing
  capability to only one of them. Add new agent-facing capabilities as catalog operations
  (snake_case ids and result shapes); `cli/src/commands/commandCatalog.test.ts` and
  `backend/src/mcp/mcp.test.ts` enforce the mirror. (The Svelte frontend is a separate
  surface and may use its own camelCase HTTP routes; it is not bound by this parity rule.)

## Working Style

- Use the issue or request at hand, and the canonical docs it names, as the source of truth for the work.
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

### `SHORTCUT:` comments — no shortcuts on top of shortcuts

A `// SHORTCUT: …` comment marks a deliberate debt taken to move fast once: it names what was
skipped and what paying it back looks like. The rule is that the debt is repaid **before or as
part of the next change to the code it marks** — never build on top of one. For an agent this is
a blocking precondition: if your change touches code carrying a `SHORTCUT:`, resolve the shortcut
first (and remove the comment) or stop and flag it; do not add a second shortcut alongside it.
Architecture-level shortcuts are documented in [ARCHITECTURE.md](docs/ARCHITECTURE.md) instead of
code comments.

## Validation

Choose the smallest check that matches the change; **before opening a PR run the full gate (`npm run verify`)**. See [TESTING.md](docs/TESTING.md) for the canonical command list and exactly what the gate runs.

## High-Value References

- [backend/src/operations/catalog.ts](backend/src/operations/catalog.ts) for shared command and tool semantics
- [backend/src/mcp/server.ts](backend/src/mcp/server.ts) for MCP adapter behavior
- [backend/src/app.test.ts](backend/src/app.test.ts) for backend/app regression patterns
- [backend/src/testing/replayHarness.ts](backend/src/testing/replayHarness.ts) for trace replay tests
