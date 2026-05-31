# Analysis session as a proper session

Status: completed.

This increment recovered the analysis workflow so that a `session_analysis` run behaves like a
normal session whose model-visible evidence is loaded through deterministic inspect turns rather
than synthetic prompt bundles.

## Delivered outcome

- analysis sessions now have a normal prelude and real MCP binding to the restricted
  `/mcp/analysis` surface
- bootstrap and packet assessment evidence is committed as normal deterministic inspect tool calls
- packet-local evidence is loaded as exact parent-session IDs rather than large synthetic prompts
- reasoning around tool calls is available as inspectable evidence, including cross-round
  post-call reasoning
- packet-local evidence is excluded from active context after use while remaining inspectable in
  history
- automated backend regression coverage encodes the intended deterministic inspect flow

## Canonical project docs after completion

- use `SESSION-ANALYSIS.md` for the shipped workflow and the concrete `V2EH` / `CXQJ` example
- use `ARCHITECTURE.md`, `DATA-MODEL.md`, and `TESTING.md` for the supporting system contracts

## Validation used for closure

- `npx vitest run backend/src/app.test.ts -t "v2 full flow with tool calls: produces assessment, turn_summary, and final_report artifacts via deterministic inspect turns" --reporter=dot`
- `npm run check:backend`

## Historical note

This completed record replaces the former active implementation task in `backlog/implementation/`.