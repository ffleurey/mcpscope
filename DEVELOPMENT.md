# Developing mcpscope

This guide is for working on **mcpscope itself**. To *use* a released build, see
[README.md](README.md) and [TUTORIAL.md](TUTORIAL.md). The full documentation index lives in the
README's **Documentation map**; agents should also read [AGENTS.md](AGENTS.md).

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

- the backend on `http://localhost:3030`
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
- runtime state persists on the SQLite runtime tables (`sessions`, `steps`, `turns`, `rounds`, `parts`, `raw_exchanges`, `artifacts`); container ownership is recorded on `sessions` columns rather than a separate container table
- session parent rules remain intentionally narrow: a `primary` session may optionally have a `benchmark` parent, and a `session_analysis` session requires a `session` parent
- analysis-session deterministic workflow steps ship inside the normal session model; broader generalization and cleanup remain future work
- production-ready session-analysis *modes* (guided + "skill") are post-V1; the benchmark + LLM rubric evaluation are the shipped quality story (see [BENCHMARK.md](BENCHMARK.md))

## Repository notes

- `backend-data/` is local runtime state and live integration output; only its README is tracked.
- `backlog/research/` contains reference material and archived investigations, not active implementation specs.
- `backlog/` is a lightweight historical board and workflow state area, not up-to-date project documentation. Only use a specific backlog file when task instructions explicitly point to it.
