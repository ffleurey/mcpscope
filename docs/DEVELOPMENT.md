# Developing mcpscope

This guide is for working on **mcpscope itself**. To *use* a released build, see
[README.md](../README.md) and [TUTORIAL.md](../TUTORIAL.md). The full documentation index lives in the
README's **Documentation** section; agents should also read [AGENTS.md](../AGENTS.md).

mcpscope is centered on persisted LLM sessions. Different session types may steer those sessions
with deterministic steps and context policy, but that determinism still lives inside the same
session model — an implementation choice, not a separate substrate.

## Product surfaces

mcpscope ships as one product with four surfaces over a single backend-owned model:

- Web UI for human inspection and configuration
- backend HTTP API as the canonical integration layer
- packaged CLI for shell-native workflows
- MCP interface for agent-native interaction

They share the same backend-owned session model and canonical hierarchical IDs. The CLI is not a
separate product line; it is another entrypoint into the same distribution.

## Developer setup

Clone the repo, install dependencies, then run mcpscope locally from source:

```bash
npm ci
npm run dev
```

That starts:

- the backend on `http://localhost:3066`
- the Vite frontend on `http://localhost:5173`

In local development the frontend and backend run as separate dev servers. The backend only
serves the built frontend in production-style static mode when `BACKEND_STATIC_DIR` is set (that
is what the packaged `mcpscope serve` command and the Docker image do).

Useful variants:

```bash
npm run dev:backend      # backend only (tsx watch)
npm run dev:frontend     # frontend only (vite)
```

## Development helpers

```bash
npm run seed:dev-config    # seed LM connections, model configs, MCP profiles
npm run seed:dev-sessions  # seed captured session fixtures
npm run seed:dev-data      # both of the above
```

## Build

```bash
npm run build            # build frontend (vite → frontend/dist)
npm run build:backend    # compile backend TypeScript → backend/dist
npm run build:cli        # compile CLI TypeScript → cli/dist
npm run build:all        # all three (what `prepublishOnly` runs)
npm run start:backend    # run the compiled backend
```

The published npm package ships `cli/dist`, `backend/dist`, and `frontend/dist`; `mcpscope serve`
boots the bundled backend and serves the bundled frontend. See [RELEASING.md](RELEASING.md) for
the tag-driven release + GHCR image flow.

## Testing and type checking

See [TESTING.md](TESTING.md) for the canonical list of test, type-check, lint, and format
commands, the test strategy, and how to add regressions.

## Current deliberate limits

- execution control is backend-owned through an in-memory sequential scheduler, but explicit public step-target enqueue is still tracked as follow-up work
- pausing execution is boundary-based: the backend stops after the current turn/step finishes; the hard **Stop** abort cancels the in-flight model request
- analysis-session deterministic workflow steps ship inside the normal session model; broader generalization and cleanup remain future work
- production-ready session-analysis *modes* (guided + "skill") are planned but not yet shipped; the benchmark + LLM rubric evaluation are the current quality story (see [BENCHMARK.md](../BENCHMARK.md))

Runtime-model limits and parent rules: [DATA-MODEL.md](DATA-MODEL.md); architectural gaps: [ARCHITECTURE.md](ARCHITECTURE.md).

## `SHORTCUT:` comments — no shortcuts on top of shortcuts

Deliberate, marked technical debt is allowed; unmarked or compounding debt is not. A
`// SHORTCUT: …` comment records a shortcut taken to move fast once — what was skipped, and what
paying it back looks like. The contract: the debt is repaid **before or as part of the next
change to the code it marks**, and the comment is removed with it. Never stack a second shortcut
on top of an existing one. This keeps the debt visible exactly where it bites, instead of in a
tracker nobody reads. Shortcuts at the architecture level (cross-module seams) are recorded in
[ARCHITECTURE.md](ARCHITECTURE.md) rather than in code comments.

## Repository notes

- `backend-data/` is local runtime state and live integration output; only its README is tracked.
- User-facing guides live at the repository root (README, TUTORIAL, EXAMPLE, CLI, MCP, BENCHMARK, COMPANIONS, CONFIG); internal/contributor docs live under `docs/`.
