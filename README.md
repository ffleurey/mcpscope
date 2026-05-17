# mcpscope

Local-first **runtime analysis and debugging tool** for MCP server development and multi-turn LLM workflows. Built to inspect how models reason, choose tools, and consume context, with trace export, deterministic replay, and auditable token attribution.

## Documentation map

- [ARCHITECTURE.md](ARCHITECTURE.md) - system design, persistence model, streaming model, replay model, and API surface
- [DATA-MODEL.md](DATA-MODEL.md) - compact canonical runtime tree, public part taxonomy, and canonical IDs
- [CLI.md](CLI.md) - CLI command reference: commands, flags, output format, exit codes
- [PLAN.md](PLAN.md) - current product state and near-term focus
- [backlog/cli-for-llm-in-the-loop-test.md](backlog/cli-for-llm-in-the-loop-test.md) - active CLI task description and incremental rollout plan
- [backlog/done/hierachical-ids-system-and-api.md](backlog/done/hierachical-ids-system-and-api.md) - completed hierarchical ID and lookup groundwork the CLI builds on
- [TESTING.md](TESTING.md) - deterministic replay strategy, runtime tests, and live integration captures
- [FRONTEND-TEST.md](FRONTEND-TEST.md) - optional manual browser-based UI checks with agent-browser
- [RELEASING.md](RELEASING.md) - release workflow and GHCR image publishing
- [USECASE-home-assistant-statistics.md](USECASE-home-assistant-statistics.md) - reference workflow used to evaluate MCP analysis scenarios
- [`research/`](research/) - archived payload studies and superseded design research kept for context
- [`backend-data/README.md`](backend-data/README.md) - local runtime data and live-test artifact policy

## Development

```bash
npm run dev              # backend + frontend together
npm run dev:backend      # backend only (tsx watch)
npm run dev:frontend     # frontend only (vite)
```

### Seeding dev data

```bash
npm run seed:dev-config    # seed LM connections, model configs, MCP profiles
npm run seed:dev-sessions  # seed captured session fixtures
npm run seed:dev-data      # both of the above
```

## Docker

The easiest way to run the app is via Docker — no Node.js install required.

```bash
docker compose up          # build image and start (first run ~2 min)
docker compose up -d       # same, detached
docker compose down        # stop
```

Then open **http://localhost:3030**.

Session data (SQLite) is persisted in a named Docker volume (`mcpscope-data`) and survives container restarts and image upgrades.

To rebuild the image after pulling changes:
```bash
docker compose build
docker compose up -d
```

See [RELEASING.md](RELEASING.md) for released-image usage and the full release workflow.

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
- `backlog/` contains active implementation tasks; `backlog/done/` contains completed specs kept for historical context.
