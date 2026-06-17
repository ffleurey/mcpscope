# mcpscope

Local-first **runtime analysis and debugging tool** for MCP server development and multi-turn LLM workflows. Built to inspect how models reason, choose tools, and consume context, with trace export, deterministic replay, and auditable token attribution.

mcpscope is centered on persisted LLM sessions.

Different session types may steer those sessions with deterministic steps and context policy, but
that determinism still lives inside the same session model. It is an implementation choice, not a
separate substrate.

## Documentation map

### Technical reference

- [ARCHITECTURE.md](ARCHITECTURE.md) - system design, persistence model, streaming model, replay model, and API surface
- [DATA-MODEL.md](DATA-MODEL.md) - canonical runtime tree, part taxonomy, and canonical IDs
- [DATABASE-SCHEMA.md](DATABASE-SCHEMA.md) - SQLite tables, foreign keys, singleton defaults, and ER diagram
- [backlog/completed/SESSION-ANALYSIS.md](backlog/completed/SESSION-ANALYSIS.md) - shipped `session_analysis` workflow and evidence-loading contract
- [MCP.md](MCP.md) - MCP interface reference: transport, tool surface, and structured results
- [CLI.md](CLI.md) - CLI command reference: commands, flags, output format, exit codes
- [TESTING.md](TESTING.md) - deterministic replay strategy, runtime tests, and live integration captures
- [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md) - frontend design system: brand, tokens, shared primitives, patterns, and the live Design System Reference (read before any frontend visual change)

### Usage and use cases

- [TUTORIAL.md](TUTORIAL.md) - packaged user/tester tutorial for running released mcpscope in Docker
- [USECASE-home-assistant-statistics.md](USECASE-home-assistant-statistics.md) - first concrete reference scenario and evaluation target
- [FRONTEND-TEST.md](FRONTEND-TEST.md) - optional manual UI checks with agent-browser

### Project workflow

- [README.md](README.md) - repository/developer entrypoint for working on mcpscope itself
- [RELEASING.md](RELEASING.md) - release workflow and GHCR image publishing
- [backlog/README.md](backlog/README.md) - backlog workflow, state folders, and promotion rules
- [backend-data/README.md](backend-data/README.md) - local runtime data and live-test artifact policy
- [`research/`](research/) - archived payload studies and superseded design research kept for context

## Audience

This file is for developers working on mcpscope itself.

If you want to use a released mcpscope build to evaluate an MCP server, start with:

- [TUTORIAL.md](TUTORIAL.md) for the Docker/user workflow
- [USECASE-home-assistant-statistics.md](USECASE-home-assistant-statistics.md) for the first concrete evaluation target
- [RELEASING.md](RELEASING.md) for GHCR image usage and tags

## Product surfaces

mcpscope currently ships as one product with four main surfaces:

- Web UI for human inspection and configuration
- backend HTTP API as the canonical integration layer
- packaged CLI for shell-native workflows
- MCP interface for agent-native interaction

Those surfaces share the same backend-owned session model and canonical hierarchical IDs. The CLI is not a separate product or package line; it is another entrypoint into the same distribution.

## Current deliberate limits

- execution control is now backend-owned through an in-memory sequential scheduler, but explicit public step-target enqueue is still tracked as follow-up work
- pausing execution is boundary-based: the backend stops after the current turn/step finishes; it does not interrupt an in-flight LM Studio or MCP request
- runtime state persists on the SQLite runtime tables (`sessions`, `steps`, `turns`, `rounds`, `parts`, `raw_exchanges`, `artifacts`); container ownership is recorded on `sessions` columns rather than a separate container table
- session parent rules remain intentionally narrow: a `primary` session may optionally have a `benchmark` parent, and a `session_analysis` session requires a `session` parent
- analysis-session deterministic workflow steps are shipped inside the normal session model; broader generalization and cleanup remain future work
- benchmark support is currently limited to the minimal container model, not a fuller benchmark product surface

## Developer setup

Clone the repo, install dependencies, then run mcpscope locally from source:

```bash
npm ci
npm run dev
```

That starts:

- the backend on `http://localhost:3030`
- the Vite frontend on `http://localhost:5173`

In local development, the frontend and backend run as separate dev servers. The backend only serves the built frontend in production-style static mode when `BACKEND_STATIC_DIR` is set.

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

## Packaged user workflow

The released/product workflow is Docker.

Use these docs instead of the developer setup in this file:

- [TUTORIAL.md](TUTORIAL.md) for the step-by-step Docker path
- [USECASE-home-assistant-statistics.md](USECASE-home-assistant-statistics.md) for the first concrete use case
- [RELEASING.md](RELEASING.md) for GHCR image details

## Build

```bash
npm run build            # build frontend (vite)
npm run build:backend    # compile backend TypeScript
npm run build:cli        # compile CLI TypeScript
npm run start:backend    # run compiled backend
```

## Testing and type checking

See [TESTING.md](TESTING.md) for the canonical list of test, type-check, lint, and format commands, the test strategy, and how to add regressions.

## Repository notes

- `backend-data/` is local runtime state and live integration output; only its README is tracked.
- `research/` contains reference material and archived investigations, not active implementation specs.
- `backlog/` is a lightweight historical board and workflow state area, not up-to-date project documentation. Only use a specific backlog file when task instructions explicitly point to it.
