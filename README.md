# mcpscope

Local-first **runtime analysis and debugging tool** for MCP server development and multi-turn LLM workflows. Built to inspect how models reason, choose tools, and consume context — with trace export, deterministic replay, and a trust-first approach to token accounting.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full system design and domain model.

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

## Docker (recommended for MCP server development)

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

See [RELEASING.md](RELEASING.md) for pulling a released image from GHCR.

## Releasing

See [RELEASING.md](RELEASING.md) for the full release workflow and GHCR pull instructions.

## Build

```bash
npm run build            # build frontend (vite)
npm run build:backend    # compile backend TypeScript
npm run start:backend    # run compiled backend
```

## Testing and type checking

```bash
npm test                 # deterministic local tests (pure logic, runtime, app, replay)
npm run check            # svelte-check + frontend TypeScript
npm run check:backend    # backend TypeScript check
npm run test:integration # live LM Studio + MCP validation (requires running LM Studio + MCP server)
```

See [TESTING.md](TESTING.md) for the test strategy and how to add regressions.

## Project docs

- [ARCHITECTURE.md](ARCHITECTURE.md) — system design, domain model, API surface, runtime rules
- [TESTING.md](TESTING.md) — test strategy and regression workflow
- [RELEASING.md](RELEASING.md) — release workflow and Docker image distribution
- [PLAN.md](PLAN.md) — current status and open work
- [USECASE-home-assistant-statistics.md](USECASE-home-assistant-statistics.md) — reference use case and evaluation criteria
