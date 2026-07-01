# mcpscope — V1 Release Plan

Single source of truth for reaching a clean, publishable open-source V1. Supersedes
`completed/what-should-v1-look-like.md` (the earlier "gap to V1" doc — enduring content rescued
into the [Scope & context](#scope--context-rescued-from-the-previous-v1-doc) section below).

> **Status:** the *build* scope for V1 is essentially complete (benchmark + LLM evaluation +
> distribution all shipped). What remains is **finishing and packaging**, not building. This plan
> is an audit-driven punch list, ordered by the sequencing the maintainer chose (see below).

## Sequencing decision (2026-07-01)

The audit originally proposed doing legal/publishing/privacy first. **Reprioritized:** the
license, data anonymization, and repo pruning are **deferred to the very end** and will be handled
by **extracting a clean subset of the repo** into a fresh public repository (history stripped).
Doing that last avoids churning the working repo. The **doc-facts** portion of that original phase
(Node-24, schema v6, `better-sqlite3`, Electron) is *not* deferred — those are just wrong facts and
are fixed now.

Active order:

1. **Milestone A — Correctness & robustness** (verified bugs + hardening).
2. **Milestone B — Documentation truth & structure** (fix wrong facts; restructure; one great use-case).
3. **Milestone C — Frontend polish & code cleanup** (non-blocking quality).
4. **Milestone D — Final extraction & publish** *(deferred to last; done via clean-subset extraction).*

## Progress log

**2026-07-01 — Milestone A + doc-facts landed (branch work).** All verified with the full
`npm run verify` gate (format, lint ×3, typecheck ×4, 338 tests — +4 new).
- **A1 done** — MCP auth (bearer/basic) now sent on the wire; threaded through httpClient →
  gateway → runtime (session tool calls, deterministic calls, tool-result calls) + preflight +
  the `/test` endpoint + frontend test/preflight callers. Unit test added (`mcpAuthHeaders`).
  *Follow-up:* the MCP profile form still has no UI inputs to enter auth (settable via config/API
  only) — tracked as a Milestone C UI gap.
- **A2 done** — `fast_tool_analysis` now assesses every tool group (was `tool_groups[0]` only);
  per-group completion keyed by `work_unit_id`; `totalToolCallCount` fixed. Regression test added.
- **A3 done** — added `backend/tsconfig.build.json` excluding tests/testing/dev from `dist`;
  `build:backend` uses it. Verified clean `dist` (0 test/testing/dev files).
- **A4 done** — `relaySchedulerJobStream` hardened: write guard, `error` listener (prevents EPIPE
  crash), heartbeat. (Terminal-event single-slot race left as a noted lower-priority follow-up.)
- **A5 done** — MCP transport now closes server+transport on response close.
- **A6 done** — single shared brace-balanced `extractJsonBlock` (`analysis/shared/extractJson.ts`)
  replaces 5 copies. (In-run retry-on-parse-failure left as optional follow-up.)
- **A7 done** — `configStore.flush()` uses `path.dirname` + atomic temp-file rename.
- **A8 done** — `--version` prints the real version; `serve` sets `APP_VERSION`.
- **A9 (smaller route items)** — NOT yet done: full-run analysis terminal-phase guard, blocking
  `POST /turns`, MCP protocol-version header, `/test` OpenRouter model-list. Lower priority.
- **B1 + B2 done** — documentation factual drift fixed across README/TUTORIAL/ARCHITECTURE/
  DATABASE-SCHEMA/DATA-MODEL/CLI/MCP/BENCHMARK/TESTING/AGENTS/.env.example/case-study READMEs
  (Node 24, schema v6, node:sqlite, judge temp 0.2, 21 tools, `/api/domain-model`, column drift).

**2026-07-01 — B3 (docs restructure + de-duplication) landed.**
- Moved 8 internal docs to `docs/` (ARCHITECTURE, DATA-MODEL, DATABASE-SCHEMA, DESIGN-SYSTEM,
  DEVELOPMENT, TESTING, FRONTEND-TEST, RELEASING); added `docs/README.md` index. Kept the 6
  user-facing docs + `AGENTS.md` at root (`AGENTS.md` is an agent-discovery convention file and is
  referenced by code comments). Retired `HISTORY.md` (stale changelog; a real CHANGELOG is a
  Milestone D item).
- Rewrote every cross-link for the new layout and **verified all relative links resolve**; fixed
  the `DesignReference.svelte` text reference.
- De-duplicated to a single canonical home per topic (per the "explain once, in one place" rule):
  benchmark run-control/eval semantics → BENCHMARK.md; operation-catalog/parity mechanism →
  ARCHITECTURE.md; "current limits" → DATA-MODEL/ARCHITECTURE; `npm run verify` gate → TESTING.md;
  Docker CLI → TUTORIAL.md; `initializeSchema` → DATABASE-SCHEMA.md. ~18 lines net removed with
  pointers; verified no unique fact was dropped (e.g. ARCHITECTURE's trimmed run-control points to
  BENCHMARK.md §Run control, which holds the full explanation).
- Rejected two merges after analysis (correctly split by altitude, already cross-linked):
  DATA-MODEL vs DATABASE-SCHEMA; FRONTEND-TEST vs TESTING.
- Also removed all `backlog/` reference links from user-facing docs (backlog is non-canonical and
  will be pruned), documented the `another_session_active` error in CLI.md create/send tables,
  softened a stale "22 hooks" claim (actual: 21) in ARCHITECTURE, and dropped a redundant MCP.md
  Docker line.

**Remaining active work:** B4 (one runnable sanitized use-case — awaiting decision on the featured
MCP server), Milestone C (frontend polish + dead-code cleanup), then Milestone D (extraction/publish,
deferred).

## Baseline health (2026-07-01 audit)

Verified green: **334 tests pass**, all four typechecks pass (backend/frontend/cli/electron),
no leaked secrets in tracked source, **0** `as any` in backend, essentially no TODO/FIXME litter.
The `node:sqlite` migration is clean. This is a solid foundation; the items below are the gap to a
polished V1, not a rescue.

---

## Milestone A — Correctness & robustness

Real defects (all independently verified against the code) and daemon-hardening. These are the
top priority.

### A1. MCP server auth is never sent on the wire — **BLOCKER**
Bearer/basic auth is captured, stored, and threaded through the whole stack, but the MCP HTTP
client sets only `Content-Type`/`Accept`/`mcp-session-id` — no `Authorization` header exists
anywhere. Any auth'd MCP server returns 401; a stored credential is silently ignored.
- Root: `backend/src/services/mcp/httpClient.ts` (`mcpPost`, ~L63-95) has no auth param.
- Also thread auth through the runtime gateway: `backend/src/runtime/toolTurns.ts` (`mcpGateway`, ~L79-91).
- Config already present: `domain/configuration.ts:88-89` (`authType`/`authValue`), snapshots in
  `sessionCreationShared.ts:34-35`, `domain/model.ts:170-171`.
- [ ] Add auth-header support to `mcpPost` + all `initializeMcpSession`/`listMcpTools`/`callMcpTool`.
- [ ] Thread `authType`/`authValue` from the profile snapshot to the gateway.
- [ ] Test: bearer header present when profile configures it; absent for `none`.

### A2. `fast_tool_analysis` drops every tool after the first — **BLOCKER (or mark experimental)**
`onAfterSession` enqueues an assessment for `tool_groups[0]` only and the aggregation hard-asserts
a single group, so any session using >1 distinct tool silently loses coverage while the report
presents as complete. No test exercises this mode.
- `backend/src/analysis/fastTool/fastToolAnalysis.ts:95` (`tool_groups[0]`), `:114` (`length !== 1`).
- [ ] Loop over all `tool_groups` (per-group assessment step with a per-group `isComplete` key), or
- [ ] If not finished for V1, explicitly gate/label `fastTool` as experimental so it isn't advertised.
- [ ] Add at least one multi-tool fast-tool test (the mode currently has none).
- [ ] Fix `totalToolCallCount` passed as `assessmentCount` (`fastToolAnalysis.ts:110`).

### A3. Test/harness code compiles into shipped `backend/dist/` — **BLOCKER**
`backend/tsconfig.json` has no `exclude`, so 34 `*.test.ts` + the whole `testing/` tree emit to
`dist/`. `dist/testing/integrationEnv.js` imports `dotenv` (a devDependency), so a production
`--omit=dev` install ships a module that crashes if loaded.
- [ ] Add `"exclude": ["src/**/*.test.ts", "src/testing/**"]` to `backend/tsconfig.json` (mirror
      `cli/tsconfig.json`, which already excludes tests). Consider a dedicated build tsconfig.
- [ ] Move any genuinely-needed fixture out of `testing/` (e.g. `dev/seedCapturedSessions.ts`
      imports `testing/fixtures/capturedReasoningThreeBatch`).
- [ ] Verify the built tarball (`npm pack --dry-run`) no longer contains test/harness files.

### A4. SSE/streaming crash-hardening — **SHOULD-FIX (high value)**
The relay behind `/execute`, `/initialize`, `/turns/stream` has no `writableEnded` guard, no
`reply.raw.on('error')`, and no heartbeat. A client disconnect mid-stream can surface `EPIPE` as an
**unhandled error → process crash** on a long-running daemon; quiet model calls behind a proxy can
be silently reaped. There is also a subscribe-then-snapshot terminal-event race that can leave a
stream open forever.
- Glue in `backend/src/app.ts` (SSE relay helper); compare with the scheduler SSE endpoint which
  already sends keepalives.
- [ ] Add `writableEnded` guard + `error` listener + heartbeat; re-check terminal state after subscribe.

### A5. MCP transport resource leak — **SHOULD-FIX**
Per-request `McpServer`/`StreamableHTTPServerTransport` are created but never `close()`d.
- `backend/src/mcp/transport.ts:27-55` — register `reply.raw.on('close', () => { transport.close(); server.close() })`.
- [ ] Add cleanup on response end for both `/mcp` and `/mcp/analysis`.

### A6. Fragile, duplicated LLM-JSON extraction — **SHOULD-FIX (reliability)**
`extractJsonBlock` is byte-identical in 5 files; the `indexOf('{')`…`lastIndexOf('}')` fallback
mis-slices when model prose contains a stray `}`, and a single failed parse aborts the whole
analysis run with no retry — the dominant reliability risk across analysis modes.
- `shared/toolCallAssessmentStep.ts:219`, `shared/turnSummaryStep.ts:266`,
  `shared/finalAggregationStep.ts:142`, `fastTool/fastToolGroupedAssessmentStep.ts:151`,
  `benchmarkEvaluation/rubricJudgeStep.ts:96`.
- [ ] Extract one shared, brace-balanced extractor; consider one in-run retry on parse failure.

### A7. `configStore.flush()` path/atomicity bug — **SHOULD-FIX**
Uses `this.filePath.substring(0, lastIndexOf("/"))` — breaks on Windows and on a relative
`MCPSCOPE_CONFIG_PATH` with no slash (`lastIndexOf` → -1 → drops a char → mkdir garbage). Also
writes non-atomically (crash mid-write corrupts config).
- `backend/src/config/configStore.ts:138`.
- [ ] Use `path.dirname`; write to a temp file then `rename`.

### A8. CLI `--version` / `serve` version — **SHOULD-FIX**
`mcpscope --version` prints the literal `"mcpscope"` (`cli/src/index.ts:109`); `serve` never sets
`APP_VERSION`, so the UI footer shows `"dev"` on the npm path (`config.ts:28` fallback).
- [ ] Read version from `package.json`; set `APP_VERSION` in `serve.ts`.

### A9. Smaller route/robustness items — **SHOULD-FIX / NICE**
- [ ] Full-run analysis re-execution lacks the terminal-phase guard the single-step path has (`sessionRoutes.ts`).
- [ ] `POST /api/sessions/:id/turns` blocks the whole turn with no client-disconnect handling (`traceRoutes.ts:82`).
- [ ] MCP client hardcodes protocol `2024-11-05` and omits `MCP-Protocol-Version` on follow-ups; `clientInfo.version` stale `0.1.0` (`services/mcp/httpClient.ts:143`).
- [ ] `/api/lm-connections/test` uses OAI `/v1/models` for OpenRouter too (differs from `/models`); LM-Studio `models/details` omits the apiKey (`configurationRoutes.ts:213,393`).

---

## Milestone B — Documentation truth & structure

The docs are accurate in the large but wrong in specific load-bearing details, and too sprawling
for a clean front door.

### B1. Wrong facts a newcomer/contributor hits first — **BLOCKER (doc-facts; NOT deferred)**
- [ ] **Node version:** README.md:37, TUTORIAL.md:6,15 say "Node.js 20+"; `package.json` requires
      `>=24` and `node:sqlite` needs 24. Change to **24+** everywhere.
- [ ] **Schema version:** DATABASE-SCHEMA.md:255, ARCHITECTURE.md:98-100, DATA-MODEL.md say **3**;
      code is `SCHEMA_VERSION = 6` (`domain/model.ts:15`). Fix and make DATABASE-SCHEMA.md the single
      source; have the others defer to it. Update the version history prose too.
- [ ] **`better-sqlite3`:** ARCHITECTURE.md:31 still names it as the DB lib — it's `node:sqlite` now.
- [ ] **Electron:** undocumented in every dev/user doc despite being a shipped surface. README's
      install section, DEVELOPMENT.md, and ARCHITECTURE.md's "four surfaces" all omit the desktop app.
      Add build/run/package instructions and mention the installer as an end-user path.

### B2. Doc↔code factual drift — **SHOULD-FIX**
- [ ] Judge-temperature default is documented as `0` (CLI.md:253,304; MCP.md:192); code default is
      **0.2** (`domain/model.ts:445`). BENCHMARK.md:324 already says 0.2 — reconcile. Also document the
      CLI-vs-MCP "omit temperature" divergence (CLI sends `null` → provider default; MCP omit → 0.2).
- [ ] MCP tool count: stated as 15 / 19 / "twelve benchmark" across TESTING.md:102, MCP.md:19,33,
      BENCHMARK.md:224. Catalog has **21 (7 + 14)**. Document the two missing tools
      (`benchmark_run_control`, `benchmark_evaluation_control`) on the MCP side and in CLI.md's command
      section (currently only in the `--help` block).
- [ ] `.env.example` lists `LMSTUDIO_*`/`MCP_SERVER_URL` that are only read by the dev seed script,
      not the running app — relabel "dev seeding only" and document the real `BACKEND_*` /
      `MCPSCOPE_CONFIG_PATH` surface.
- [ ] `case-study/prompts/**/README.md` reference a nonexistent `evaluation/` tree — fix the links.
- [ ] DB doc: add `benchmark_runs.max_tool_rounds`; correct `judge_temperature` to nullable
      ("NULL ⇒ omit temperature"); `/api/system` doesn't exist → it's `/api/domain-model`
      (fix the `domain/model.ts:5` comment too).
- [ ] `npm run verify` description omits `check:electron` (TESTING.md:33, AGENTS.md:58); TESTING.md's
      "19"/"15" tool counts stale vs the 21-entry `mcp.test.ts`.

### B3. Structure — 17 root markdown files dilute the front door — **SHOULD-FIX**
- [ ] Keep user-facing at root: README, TUTORIAL, CLI, MCP, BENCHMARK, PROVIDERS.
- [ ] Move contributor/internal to `docs/`: ARCHITECTURE, DATA-MODEL, DATABASE-SCHEMA, DESIGN-SYSTEM,
      DEVELOPMENT, TESTING, FRONTEND-TEST, RELEASING, AGENTS. Update README's doc index links.
- [ ] HISTORY.md is stale (stops at v0.13; product is 0.16) — drop or replace with a real CHANGELOG.
- [ ] BENCHMARK.md re-documents the CLI/MCP surface (drift source, already out of sync) — trim the
      HTTP-API tables (internal detail) and link CLI.md/MCP.md instead of duplicating.

### B4. One compelling, runnable, sanitized end-to-end use-case — **SHOULD-FIX (highest doc leverage)**
**Deferred to a standalone task** (needs a decision on the featured MCP server + community research
into "toy" servers with rich-enough data characteristics). Full write-up — motivation, what the
example must demonstrate, the featured-server alternatives, and acceptance criteria — is in
[candidates/flagship-runnable-use-case.md](candidates/flagship-runnable-use-case.md).

Summary: the compelling example (`case-study/USECASE-…`) is a *design spec* (no runnable commands,
nonexistent model name, private HA server with personal data) and the runnable flows (TUTORIAL §4-7,
BENCHMARK tutorial) use a generic "weather server" — the two never connect. The task is to build one
runnable, personal-data-free walkthrough (create → send → inspect → benchmark → run → report → rubric
judge) that makes the "change one thing, re-run, watch the metric move" loop concrete.

---

## Milestone C — Frontend polish & code cleanup

No blockers — the frontend is consistent and in good shape. Quality/OSS-cleanliness items.

- [ ] Stop button uses non-existent class `btn btn-sm danger` → `btn-danger` (`RunReportView.svelte:287`).
- [ ] Literal `\n` in a textarea placeholder (`AnalysisLaunchModal.svelte:369`).
- [ ] Paused runs show a misleading "idle" sidebar dot (`RunList.svelte:41`); unify the divergent
      status→dot logic across `RunList`/`BenchmarkDetailView`/`RunReportView`.
- [ ] "Step (Debug)" button ships in the production analysis bar (`ChatView.svelte:549`) — gate or remove.
- [ ] `ContextSnapshotBar` uses a re-running `$effect` to init state that should be set once (`:40-44`).
- [ ] Suppressed `:focus-visible` on the title-edit input with no replacement (`ChatView.svelte:653`; WCAG).
- [ ] Raw-Unicode-glyph icons instead of `<Icon>` across ~8 components (DESIGN-SYSTEM.md violation);
      some delete buttons lack `aria-label`.
- [ ] Hand-rolled Chat/Inspect toggle → `SegmentedControl`; ad-hoc error banners → `InlineAppError`;
      `.field-error` red-border state never applied in production forms.
- [ ] Delete orphaned assets: `assets/hero.png`, `svelte.svg`, `vite.svg`, `public/icons.svg`.
- [ ] Extract duplicated helpers (`slugify`, date formatters, status-pill/dot, whitespace-normalize).

### Backend dead-code cleanup (fresh-DB stance — no back-compat)
- [ ] Remove unused `persistenceContract.ts` interfaces (keep `StepPersistenceRecord`).
- [ ] Remove benchmark ID predicate/regex scaffolding (`hierarchicalIds.ts:229-243,276-279`, test-only).
- [ ] Remove dead `analysis_v2_cursor` branch (`analysisSessionPresentation.ts:31`) + stale test refs;
      reconcile the two divergent retry-phase mappers; unify `discoverNewPackets` scope logic.
- [ ] Remove legacy `lmstudio-*` exchange kinds (`domain/model.ts:116-130`) + old `mcpProfileSnapshot`
      key fallback (`repositoryRuntime.ts:157-159,196-197`) given no-migration/fresh-DB.
- [ ] Remove dead compaction result paths (`compaction.ts:228` always returns `parts:[]`; dead loops
      in `modelTurns.ts:575,610` and `toolTurns.ts:1843,1882`).
- [ ] Prune dead analysis `static create()` factories, `setErrorPhase` no-op, dead exports
      (`artifactRepository.ts:48,77`, `anotherSessionActiveError`).
- [ ] Guard `config.ts` port/max-tool-rounds against `NaN`.
- [ ] Frontend `tsconfig.json` doesn't set `noUnusedLocals`/`noUnusedParameters` — add to catch dead code.

---

## Milestone D — Final extraction & publish (deferred to last)

Done by **extracting a clean subset of the repo** into a fresh public repository with stripped
history — so these are handled once, at the end, not by churning the working repo.

- [ ] **LICENSE** file + `"license"` field (MIT is the natural fit — maintainer's call). Legal blocker.
- [ ] Remove `"private": true`; add `homepage`, `bugs`, `keywords` to `package.json`.
- [ ] **Anonymize/remove personal data:** `exports/test-with-multiple-turns-and-tools.trace.json`
      (real HA history), `case-study/prompts/**/*.txt` (family names, bedtimes, occupancy, workplace).
- [ ] **Prune from the public tree:** `backlog/` (internal planning; contains a personal path),
      `.agents/`, `skills/`, `skills-lock.json` (untracked + not gitignored — would leak),
      `.kilo/`, stale `HISTORY.md`.
- [ ] Add `SECURITY.md`, `CONTRIBUTING.md` (point at the moved dev docs); add `.env` to `.gitignore`.
- [ ] Decide npm publishing: if yes, add an npm-publish job (`NPM_TOKEN`) to `release.yml`
      (currently only Docker + Electron) and an npm step to RELEASING.md.
- [ ] Confirm fresh-DB behavior: a pre-v6 `~/.mcpscope` DB requires recreation (no migrations) —
      ensure `serve`/Electron fail gracefully and document it for early users.
- [ ] Verify SSE self-heal in a production build (dev Vite proxy hides socket close); optional
      client-side ping-timeout watchdog.

---

## Scope & context (rescued from the previous V1 doc)

Preserved from `completed/what-should-v1-look-like.md` so the "what V1 is" framing isn't lost.

**Why the tool exists.** Built for developers and AI enthusiasts experimenting with local models
(LM Studio, Ollama) and MCP servers, to see how context works and how the LLM actually picks and
calls tools. The motivating gap: built-in chats (LM Studio, OpenWebUI) don't give enough
observability on context state — and with small local windows (8k–64k), context management is
critical.

**Use cases & V1 scope (unchanged decision).**
- **UC1 — Education / manual evaluation (Web UI):** create sessions, send prompts, inspect every
  part/tool/context bar. **In scope.**
- **UC2 — Development, testing & evaluation of MCP servers (CLI + MCP, agent-driven):** ad-hoc
  inspection + benchmark + LLM evaluation, combined with manual GUI inspection. **In scope.**
- **UC3 — Framework to build custom benchmarks/evaluation:** design *for* it (extensible analysis
  classes, workflow registry, benchmark containers) but **out of scope** for V1 shipping.

**Session-analysis modes are post-V1 (settled).** The three shipped workflows (`fullSession` /
`fastSession` / `fastTool`) remain the framework proof, not the V1 analysis story. The
production-ready **guided** (deterministic injection) and **"skill"** (prompt-guided) modes are
deliberately deferred — to be designed after real experience from the shipped benchmark + judge.
V1 does not claim a polished session-analysis surface. *(Note: `fastTool` has the A2 bug above; if
kept visible for V1 it must be fixed or explicitly labeled experimental.)*

**Provider intent.** LM Studio + Ollama are the primary local backends (both with streaming +
reasoning); OpenRouter is the secondary remote option (reasoning blocks harder to get; most useful
for larger analysis/judge models where only the result matters). A generic OpenAI-compatible option
is a minor nice-to-have gap.

**Readiness table (from the previous doc, still broadly accurate).** Architecture/data-model,
provider support, execution model & scheduler, session CRUD, CLI+MCP parity (test-enforced),
benchmark suite/case/run, benchmark LLM evaluation, Docker packaging, npm `serve` distribution,
replay harness, design system, model/MCP selection on CLI+MCP, trace export/import, and config
management are all **shipped**. Remaining V1 gaps are the audit punch list above (correctness,
docs, polish) plus the deferred extraction/publish step — not missing features. Public step
enqueue and a generic OpenAI-compatible connector remain explicitly deferred.
</content>
</invoke>
