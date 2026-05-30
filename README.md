# mcpscope

Local-first **runtime analysis and debugging tool** for MCP server development and multi-turn LLM workflows. Built to inspect how models reason, choose tools, and consume context, with trace export, deterministic replay, and auditable token attribution.

## Documentation map

- [README.md](README.md) - repository/developer entrypoint for working on mcpscope itself
- [TUTORIAL.md](TUTORIAL.md) - packaged user/tester tutorial for running released mcpscope in Docker
- [CLI.md](CLI.md) - CLI command reference: commands, flags, output format, exit codes
- [MCP.md](MCP.md) - MCP interface reference: transport, tool surface, and structured results
- [ARCHITECTURE.md](ARCHITECTURE.md) - system design, persistence model, streaming model, replay model, and API surface
- [DATA-MODEL.md](DATA-MODEL.md) - compact canonical runtime tree, public part taxonomy, and canonical IDs
- [DATABASE-SCHEMA.md](DATABASE-SCHEMA.md) - current SQLite tables, foreign keys, singleton defaults, and Mermaid ER diagram
- [backlog/README.md](backlog/README.md) - backlog workflow, state folders, and promotion rules
- [backlog/ROADMAP.md](backlog/ROADMAP.md) - current product direction and backlog posture
- [TESTING.md](TESTING.md) - deterministic replay strategy, runtime tests, and live integration captures
- [FRONTEND-TEST.md](FRONTEND-TEST.md) - optional manual browser-based UI checks with agent-browser
- [RELEASING.md](RELEASING.md) - release workflow and GHCR image publishing
- [USECASE-home-assistant-statistics.md](USECASE-home-assistant-statistics.md) - reference workflow used to evaluate MCP analysis scenarios
- [`research/`](research/) - archived payload studies and superseded design research kept for context
- [`backend-data/README.md`](backend-data/README.md) - local runtime data and live-test artifact policy

## Audience

This file is for **developers working on mcpscope itself**.

If you want to **use** a released mcpscope build to evaluate an MCP server, start with:

- [TUTORIAL.md](TUTORIAL.md) for the Docker/user workflow
- [RELEASING.md](RELEASING.md) for GHCR image usage and tags

## Product surfaces

mcpscope currently ships as one product with four main surfaces:

- Web UI for human inspection and configuration
- backend HTTP API as the canonical integration layer
- packaged CLI for shell-native workflows
- MCP interface for agent-native interaction

Those surfaces share the same backend-owned session model and canonical hierarchical IDs. The CLI is not a separate product or package line; it is another entrypoint into the same distribution.

## Current deliberate limits

- runtime state persists on `session_containers` plus the `v2_*` tables; normal startup does not create the obsolete `sessions` / `turns` / `rounds` / `parts` / `raw_exchanges` runtime tables
- session parent rules remain intentionally narrow: parents are limited to `session` and `benchmark`, depending on `session_type`
- deterministic non-LLM step types and broader workflow automation are still future work
- benchmark support is currently limited to the minimal container model, not a fuller benchmark product surface

## Developer setup

Clone the repo, install dependencies, then run mcpscope locally from source:

```bash
npm ci
npm run dev
```

That starts:

- the backend on `http://localhost:3030`
- the frontend served from the same app during normal local development flow

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

The released/product workflow is Docker — no Node.js install and no host CLI install required.

For the published GHCR image, authenticate first with a GitHub PAT that has `read:packages`:

```bash
echo "$GITHUB_PAT" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
docker pull ghcr.io/ffleurey/mcpscope:latest
docker run -d \
  --name mcpscope-app \
  --restart unless-stopped \
  --add-host=host.docker.internal:host-gateway \
  -p 3030:3030 \
  -v mcpscope-data:/data \
  ghcr.io/ffleurey/mcpscope:latest
```

The Web UI and API are both exposed through **`http://localhost:3030`**.

If you prefer to build locally instead:

```bash
docker build -t mcpscope .
docker run -d --name mcpscope-app -p 3030:3030 mcpscope
```

Then open **http://localhost:3030**.

Run the CLI inside the same container:

```bash
docker exec -i mcpscope-app mcpscope list
```

`docker compose` remains available as a convenience wrapper around the same image.

For the full user/tester walkthrough, use [TUTORIAL.md](TUTORIAL.md).

## Build

```bash
npm run build            # build frontend (vite)
npm run build:backend    # compile backend TypeScript
npm run build:cli        # compile CLI TypeScript
npm run start:backend    # run compiled backend
```

## Testing and type checking

```bash
npm test                 # deterministic local tests (pure logic, runtime, app, replay)
npm run check            # svelte-check + frontend TypeScript
npm run check:backend    # backend TypeScript check
npm run check:cli        # CLI TypeScript check
npm run lint:cli         # CLI lint
npm run test:integration # live LM Studio + MCP validation (requires running LM Studio + MCP server)
```

See [TESTING.md](TESTING.md) for the test strategy and how to add regressions.

## Repository notes

- `backend-data/` is local runtime state and live integration output; only its README is tracked.
- `research/` contains reference material and archived investigations, not active implementation specs.
- `backlog/` is organized as lightweight workflow state folders: `candidates/`, `specification/`, `implementation/`, `fixme/`, and `completed/`.
