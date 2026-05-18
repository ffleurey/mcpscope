# CLI v1 — skeleton + `sessions list`

This increment established the initial in-repo CLI foundation for `mcpscope`.

## Delivered

- `cli/` folder added at the repo root
- TypeScript CLI build wired through `cli/tsconfig.json`
- `mcpscope` binary exposed from `package.json`
- CLI support scripts added:
  - `build:cli`
  - `check:cli`
  - `lint:cli`
  - `dev:cli`
- backend URL resolution added:
  - `--url`
  - `MCPSCOPE_URL`
  - fallback default `http://localhost:3030`
- first command implemented:
  - `mcpscope sessions list`
- output modes implemented for that command:
  - text
  - json

## Backend/API work included

- `GET /api/sessions` was slimmed to a `SessionSummary` shape suitable for list output
- redundant standalone session `/transcript` and `/context` endpoints were removed
- `GET /api/sessions/:sessionId/trace` remains the canonical full-session API
- `GET /api/lookup/:id` remains the targeted inspection API

## Result

After this increment, the project has:

- a working in-repo CLI entrypoint
- a stable command name: `mcpscope`
- a clean base for the next read-only increment without additional packaging work

## Follow-up

The next increments are tracked in:

- [cli-v2-inspect-command.md](cli-v2-inspect-command.md)
- [cli-v3-session-lifecycle-mvp.md](cli-v3-session-lifecycle-mvp.md)
- [../cli-next-iteration.md](../cli-next-iteration.md)
