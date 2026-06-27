# Verification Record — branch `judge-session-improvement`

**Status: completed (2026-06-27).** Record of the pre-PR verification pass for this branch, kept for
history. All automatable checks were driven via the mcpscope MCP tools (Part A) and the UI was
exercised with a browser agent (Part B), against the local dev instance (UI `:5173` / API `:3030`).

**Outcome:** all Part A (9/9) and Part B UI tests passed. The pass also surfaced **one bug (B-1 —
errored sessions rendered "Session ready" in the chat view), which was fixed and verified** on this
branch, and flagged **B-2 (SSE self-heal unobservable behind the Vite dev proxy)** for prod-build
follow-up. The CLI `--max-tool-rounds` gap and two minor wording/dead-branch findings were also
resolved (see §3). The original plan sections below are preserved as-written, annotated with results.

---

## 1. What this branch changes (9 commits)

| Commit | Area | Risk introduced |
|---|---|---|
| `275c1be` fix(eval): raise tool-round limits + parse only final answer | judge reliability | round cap 5/10→50; `selectFinalRoundContent` could drop/duplicate content |
| `7500b45` feat(eval): judge grades rubric-as-oracle, inspects on demand | judge behavior | no pre-injected trace; judge must inspect itself; prompt rewrite |
| `4ede1d8` feat(inspect): size-capped tool-call params in nested views | inspect payload | new `tool_arguments` (80-char cap); direct lookups must stay full |
| `119170b` feat(cli): render tool-call params + compact compaction block | CLI output | rendering only |
| `b42123b` feat(session): persist + surface session init failures | error surfacing | new `initError` in state_json; phase attribution |
| `5342aeb` feat(benchmark): surface session failure reasons in run report/status | error surfacing | run-level first-error message |
| `564fac5` fix(streaming): self-heal scheduler SSE stream | frontend live updates | reconnect loop, heartbeat, tolerant parse |
| `c7e3406` feat(session): per-session max tool rounds | schema + execution | **SCHEMA v4→v5 (DB wipe)**; `max_tool_rounds` everywhere |
| `2f5cbfa` fix(dialog): don't close on backdrop click | dialog UX | backdrop handler removed; Escape intercepted |

Automated suite already green on this branch: **286 tests / 31 files**, `tsc` ×3 clean, `eslint` ×3 clean.

---

## 2. Environment prerequisites (verify first)

- [ ] mcpscope MCP server connected to this client (URL `http://localhost:3030/mcp`, Streamable HTTP).
      Verify by listing tools — you should see `mcpscope_*`. If absent, add `.mcp.json` at repo root:
      ```json
      { "mcpServers": { "mcpscope": { "type": "http", "url": "http://localhost:3030/mcp" } } }
      ```
      then reconnect.
- [ ] **Fresh DB** (schema v5). Confirm `mcpscope_list` returns zero sessions. If the backend failed
      to start with a schema-mismatch error, the old v4 DB was not wiped — delete it and restart.
- [ ] Infra state at time of writing (re-check, it drives the failure-path tests):
  - `ha-replay` (`http://localhost:3021/mcp`) — **UP** (default-enabled profile `ha-replay`).
  - `ha-oslo`  (`http://localhost:3011/mcp`) — **DOWN** (use for init-failure tests; profile `ha-oslo`).
  - LMStudio / model availability — **UNKNOWN, verify.** Tests that need a real model run
    (T-INSPECT, T-JUDGE) require a reachable model config. Model configs present:
    `ce0c471c-…` Gemma 4 12B QAT, `gemma-4-e4b`, `qwen36-35b-apex`, `lms2-gemma-4-e4b-2`.

---

## 3. Findings already identified (confirm / decide before merge)

1. ~~**CLI ≠ MCP for `max_tool_rounds`.**~~ **RESOLVED (2026-06-27).** Added `--max-tool-rounds <n>`
   to `mcpscope create` and `mcpscope benchmark_run`. The `create` flag required threading
   `maxToolRounds` through the `/api/sessions/from-defaults` route (it previously dropped the field);
   `benchmark_run` already accepted `max_tool_rounds` server-side. Both validate positive-int and were
   verified end-to-end (`create --max-tool-rounds 5` → session persists 5; `benchmark_run
   --max-tool-rounds 9` → run record 9). `create` text output now also prints a `tool rounds` line.
   CLI now matches MCP/GUI, consistent with MCP.md. tsc/eslint/tests green.
2. **Schema v4→v5 requires a manual DB wipe** (no migrations). Make sure the PR description says so.
3. ~~Minor: `create.ts:169` `?? null` is dead.~~ **Investigated — left as-is (correct).** It is *not*
   a dead branch: `sessionRecordSchema.maxToolRounds` is intentionally `.optional()` ("for
   forward/backward tolerance; reads default it"), so `session.maxToolRounds` is `number | undefined`
   and `?? null` is the type-necessary `undefined → null` conversion for the `number | null` return.
   Removing it would break tsc; making the field required would fight the documented design.
4. **Round-cap diagnostic wording fixed (2026-06-27).** `toolTurns.ts` no longer says only
   "Increase BACKEND_MAX_TOOL_ROUNDS"; now: *"Raise this session's max tool rounds (currently N) — or
   the BACKEND_MAX_TOOL_ROUNDS default —…"*, reflecting the per-session budget. No test asserted the
   old text; backend tsc/eslint/toolTurns tests green.

---

## 4. Part A — Automatable via mcpscope MCP tools

> **RESULTS (2026-06-26, run via MCP against fresh schema-v5 DB).** All 9 Part-A tests **PASS**.
> Env confirmed: MCP connected, 0 sessions/benchmarks at start, ha-replay UP (:3021), ha-oslo DOWN
> (:3011). Task model: Gemma 4 12B QAT (`ce0c471c…`). Per-test evidence inline below.
>
> | Test | Result | Key evidence |
> |---|---|---|
> | T-DEFAULT | ✅ PASS | session `YM8W` inspect → `max_tool_rounds: 20` |
> | T-MAXROUNDS-SET | ✅ PASS | `WAUS` inspect → `3`; send hit cap: diagnostic *"reached the maximum of 3 tool-call rounds"* at round 4 (ran exactly 3) |
> | T-INITFAIL-MCP | ✅ PASS | `42DV`: same msg *"fetch failed — initializing MCP server 'HA Oslo' (http://localhost:3011/mcp)"*, `error_kind=mcp_init_error`, in **list+status+inspect** |
> | T-INITFAIL-LM | ✅ PASS (bonus) | judge session `3LQ9`: `error_kind=token_probe_error`, *"…Failed to load model 'qwen3.6-35b-a3b-apex'… — initializing LM connection model 'Qwen3.6 35B APEX' (http://localhost:1234/v1)"* — names LM, not MCP; MCP handshake passed first |
> | T-RUNFAIL | ✅ PASS | run `R-9Z5H` status=error *"1 of 1 session(s) failed. First error (3BB3): fetch failed — initializing MCP server 'HA Oslo'…"*; report per-session `error.error_kind=mcp_init_error` |
> | T-RUNROUNDS | ✅ PASS | run `R-PGCH` record `max_tool_rounds:7`; both sessions `KHNX`/`3EPC` inspect → `7`; `KHNX` errored at exactly 7 rounds |
> | T-INSPECT-ARGS | ✅ PASS | `6KMK.1T` overview → `"search":"…-a… [110 chars]"` (capped, key intact, no payload); direct `6KMK.1T.1.3-T` → full 110-char value + full result |
> | T-JUDGE | ✅ PASS | eval `E-AAUE` (judge `lms2-gemma-4-e4b-2`) score 7/12; analysis `ADPH` completed, called `mcpscope_inspect`, cited IDs `DZ6K.1T.3.1-A`/`DZ6K.1T.2.2-T`; graded `1096.1` vs pinned `1114.3`→0 (rubric-as-oracle); no loop/parse errors |
> | T-CLI-RENDER | ✅ PASS | `tsx cli inspect 6KMK.1T` → params one-liner; `inspect 3EPC` → compaction block collapsed (1 line/stripped part + shared reason once) |
>
> Notes for the PR: (a) T-MAXROUNDS diagnostic says *"Increase BACKEND_MAX_TOOL_ROUNDS (currently 3)"* —
> surfaces the right per-session number but the env-var phrasing is a leftover from the global-default era;
> consider rewording. (b) qwen 35B judge config (`qwen36-35b-apex`) is **not loadable** in the current
> LMStudio — unrelated to this branch, but it's why the first judge attempt errored. (c) Throwaway objects
> left in DB for the UI tests (Part B cross-checks): sessions YM8W/WAUS/42DV/FHLF/6KMK/AHHP, benchmark
> B-WBCB, runs R-9Z5H/R-PGCH/R-BU43.

Run these next session. Each lists the risk, the MCP calls, and the expected result. Check off + note
the observed IDs/messages.

### T-DEFAULT — per-session default budget is 20 and is surfaced
Risk: `c7e3406` plumbing; default moved from 10→20.
1. `mcpscope_create` title="t-default" (let model/mcp default; ha-replay is default-enabled).
2. `mcpscope_inspect` the new session id.
- [ ] Expect `max_tool_rounds: 20` in the inspect payload (session node).

### T-MAXROUNDS-SET — custom budget honored end-to-end (MCP-only param)
Risk: `c7e3406` per-session param; only settable via MCP/GUI.
1. `mcpscope_create` title="t-rounds-3" with `max_tool_rounds: 3`.
2. `mcpscope_inspect` → expect `max_tool_rounds: 3`.
3. (If a model is up) `mcpscope_send` a prompt that needs several tool calls; poll `mcpscope_status`.
- [ ] Inspect shows `3`.
- [ ] If exercised: a multi-tool task terminates at the cap with a tool-loop-limit-style failure
      (not an infinite loop), proving the per-session value is read at execution.

### T-INITFAIL-MCP — init failure against a down MCP server is persisted + actionable
Risk: `b42123b`. Deterministic (no model needed for the MCP handshake to fail).
1. `mcpscope_create` title="t-initfail" with `mcp_profile_ids: ["ha-oslo"]` (down at :3011).
2. `mcpscope_status` and `mcpscope_inspect` the session; also `mcpscope_list`.
- [ ] `initStatus`/state = error AND a persisted `latest_error` / `initError` is present.
- [ ] Message names the phase + server, e.g. *"fetch failed — initializing MCP server 'HA Oslo'
      (http://localhost:3011/mcp)"* — not a bare "fetch failed".
- [ ] The same message appears in **all three**: `list`, `status`, `inspect`.

### T-INITFAIL-LM — failure attributed to the token-probe phase
Risk: `b42123b` phase attribution (mcp vs tokens).
1. Point a model config at an unreachable LM (or pick one whose connection is down), with a working
   MCP profile (`ha-replay`), so init passes the MCP handshake then fails at the token probe.
2. `mcpscope_create` with that `model_config_id`; inspect/status.
- [ ] Error names the **LM connection** ("…initializing LM connection 'model …' (baseUrl)"),
      `errorKind = token_probe_error` — NOT the MCP server.
- Note: if every configured LM is actually up, this case may be hard to trigger; skip if so and note it.

### T-RUNFAIL — benchmark run surfaces the first session's real error
Risk: `5342aeb`. Deterministic via the down MCP server.
1. `mcpscope_benchmark_create` name="t-runfail".
2. `mcpscope_benchmark_add_case` a trivial prompt.
3. `mcpscope_benchmark_run` with `mcp_profile_ids: ["ha-oslo"]` (down), `repetitions: 1`, `--wait`/poll.
4. `mcpscope_benchmark_run_status` and `mcpscope_benchmark_run_report`; also check `mcpscope_list`/run inspect.
- [ ] Run status = error (all sessions failed) with message like *"1 of 1 session(s) failed. First
      error (XXXX): fetch failed — initializing MCP server 'HA Oslo' (http://localhost:3011/mcp)"*.
- [ ] The per-session entry in the run **report** carries a structured `error` for the failed session.

### T-RUNROUNDS — run snapshots maxToolRounds and applies it to every session
Risk: `c7e3406` benchmark snapshot column (v5).
1. `mcpscope_benchmark_run` an existing benchmark with `max_tool_rounds: 7` (use ha-replay; repetitions ≥2).
2. `mcpscope_benchmark_run_report` / inspect the run; `mcpscope_inspect` one of its sessions.
- [ ] Run record shows `max_tool_rounds: 7`.
- [ ] Each test session inspect shows `max_tool_rounds: 7` (snapshot applied to all).

### T-INSPECT-ARGS — nested tool_arguments are size-capped; direct lookup is full
Risk: `4ede1d8`. Needs a real session with a tool call that has a long argument (model + ha-replay up).
1. Get a completed session that made at least one tool call with a sizeable argument value (run one,
   or reuse a T-MAXROUNDS run).
2. `mcpscope_inspect` the **session** (overview) and read a `tool_call` part.
3. `mcpscope_inspect` that **part directly** (e.g. `ABCD.1T.1.3-T`).
- [ ] Overview: `tool_arguments` present, each value capped (`… [N chars]` past 80 chars), every key intact.
- [ ] Overview: no full `tool_payload` on the nested node.
- [ ] Direct part: full, **untruncated** `tool_payload` (call + result).

### T-JUDGE — rubric-as-oracle judge: inspects on demand, no parse/loop errors
Risk: `7500b45` + `275c1be` (the headline reliability fixes). Needs a judge model up.
1. Have a completed run with at least one case carrying a **rubric** with concrete, pinned values
   (e.g. "final answer reports February total of 267 kWh, ±1"). Add via `mcpscope_benchmark_update_case
   --rubric-json` if needed.
2. `mcpscope_benchmark_evaluate <run_id> --judge-model <model_config_id>`; poll
   `mcpscope_benchmark_run_evaluations` to completion.
3. `mcpscope_inspect` the judge analysis session.
- [ ] Judge session completes — **no `tool-loop-limit`, no `json_parse_error`** (the two bugs fixed).
- [ ] Judge's trace shows it called `mcpscope_inspect` itself (evidence pulled on demand; not pre-injected).
- [ ] Verdict notes cite hierarchical IDs; awarded points within `[0, criterion.points]`.
- [ ] Spot-check: judge grades the answer against the pinned rubric value rather than re-deriving it
      from tool results (rubric-as-oracle).

### T-CLI-RENDER — CLI inspect rendering (optional, CLI not MCP)
Risk: `119170b`. Run via shell: `tsx cli/src/index.ts inspect <id>`.
- [ ] tool-call parameters shown as a compact one-liner under each tool_call.
- [ ] compaction step renders collapsed: one line per stripped part + shared reason once (needs a
      session that underwent compaction).

---

## 5. Part B — Manual UI tests (browser)

> **RESULTS (2026-06-27, via `agent-browser` CLI against the dev UI at `http://localhost:5173`** —
> the Vite dev server; `:3030` serves the API/JSON only. Vite proxies `/api` → `:3030`.)
>
> | Test | Result | Notes |
> |---|---|---|
> | U-DIALOG | ✅ PASS | backdrop click does NOT close (input preserved); Escape unmounts + reopens; ✕ and footer Cancel close (real-click — needed a taller viewport, footer was below an 577px fold); header drag moves the dialog. |
> | U-ROUNDS | ✅ PASS | "Max tool rounds" input present on **all three** dialogs; New Session blank→20 (ZZ33) & value 14 flows (ZZ22); Run Benchmark value 6 flows (R-F8GM); Analyse value 8 flows (BPH5). All cross-checked via `mcpscope_inspect`. |
> | U-ERRORS | ⚠️ MIXED — **1 bug** | Run view ✅ shows *"1 of 1 session(s) failed. First error (3BB3): fetch failed — initializing MCP server 'HA Oslo'…"* + red badge/dot. UI-create vs down server ✅ blocked by a preflight banner ("Cannot reach MCP server … url:3011/mcp"). **BUG:** an already-errored session (e.g. 42DV) renders **"Session ready — type your first message below"** in the chat view — its persisted init error is never surfaced (see Findings). |
> | U-INSPECT | ✅ PASS (by design) | UI does **not** char-cap args (that's MCP-tool-only; frontend never references `tool_arguments`). Instead the tool part is collapsed in the overview (tool name only, no payload) and shows the full payload when expanded. Overview≠leak, drill-in=full holds. |
> | U-SSE | ⚠️ INCONCLUSIVE in dev — **see Findings** | Heartbeat ✅ (`: ping` at 20s via direct curl). Reconnect/backoff logic ✅ by code inspection (1s→10s capped doubling, reset after a healthy connection, tolerant parse). **But** browser-side self-heal could NOT be confirmed: after a `tsx watch` backend restart the browser's SSE went **stale** — the bar froze on "Running R-BLVC" for 60s while the run was actually `stopped`. Likely a **Vite-proxy artifact** (proxy holds the browser↔vite socket open so the close never reaches the client; the client has no independent ping-timeout). Needs verification against a production build (browser direct to `:3030`). |
>
> **Two findings for the PR (details at bottom of this section).**

Do these in the running UI. Ordered by risk. **NOTE:** the live UI is at **`http://localhost:5173`**
(Vite dev server), not `:3030` (which serves the JSON API).

### U-SSE — scheduler stream self-heal (highest risk, hardest to unit-test) — `564fac5`
1. [ ] Open the UI on a page showing live scheduler/run state. Restart the backend (a clean close
       under `tsx watch` — the exact case the old catch-only code missed). UI reconnects on its own
       within ~1–2s; connected indicator recovers **without a page refresh**.
2. [ ] Kill the backend ~30s: reconnect attempts back off (1s→10s, not a tight hammer); recovers when back.
3. [ ] Leave a connection idle >20s: it does **not** silently die (`: ping` heartbeat keeps it alive).
4. [ ] After a long healthy session then a drop, backoff resets to 1s (didn't stay escalated).

### U-DIALOG — dialog dismissal — `2f5cbfa`
On New Session, Run Benchmark, and Analyse dialogs:
5. [ ] Type content, click the dark backdrop outside the dialog → it does **NOT** close (no lost input).
6. [ ] Escape, the ✕, and footer buttons all still close; dialog can be **reopened** afterward
       (parent open-state stays in sync via the Escape `preventDefault`+`onClose` path).
7. [ ] Header drag still works.

### U-ROUNDS — max-tool-rounds input on the dialogs — `c7e3406`
8. [ ] New Session / Run Benchmark / Analyse dialogs each show an optional "Max tool rounds" number
       input; blank → default (20); a set value flows through to the created session/run (cross-check
       with `mcpscope_inspect`).

### U-ERRORS — init/run failures visible in the UI — `b42123b` / `5342aeb`
9. [ ] Create a session against `ha-oslo` (down) in the UI → the session shows the actionable init
       error (named server + url), not a bare error or empty state.
10. [ ] Run a benchmark against `ha-oslo` → run/list view shows the "N of M failed. First error (…)"
        message and per-failed-session error.

### U-INSPECT — inspect arg rendering in the UI — `4ede1d8`
11. [ ] In the UI inspect view, a tool call with a large argument shows capped values in the overview;
        drilling into the part shows the full payload.

---

## 5b. Part B findings (2026-06-27)

**FINDING B-1 — RESOLVED (2026-06-27).** Fix applied across 4 spots: (1) `ChatView.svelte` — added
`isInitError` to the `hasTraceContent` derivation so an errored-with-no-trace session reaches the
content branch instead of the "Session ready" empty state; (2) `ChatView.svelte` — the init-error
banner now renders the actual `latest_error.message` + `(error_kind)`; (3) backend
`sessionRoutes.ts` `buildSessionSummaryPayload` (the `include_children` list serializer the UI uses)
**only computed `latest_error` for analysis sessions** — now it prefers a session's `initError` for any
errored session (primary *and* analysis), falling back to the analysis diagnostic; (4) `sessionStore.ts`
`toSessionSummary` now maps `record.initError → latest_error` (and `backendTypes.ts` adds `initError`
to the frontend `sessionRecordSchema`). Verified live: 42DV (primary, `mcp_init_error`) and 3LQ9
(analysis, `token_probe_error`) both now surface the actionable server+url message in the chat view.
tsc/eslint/286 tests green. _Bonus: the list now carries `latest_error` for primary sessions, enabling
a sidebar error indicator later if wanted (Q4, deferred)._

<details><summary>Original report</summary>
**(bug) — errored session shows "Session ready" in the chat view (`b42123b` feature gap).**
A session with `init_status=error` (e.g. session 42DV, MCP-created against down `ha-oslo`) renders
*"Session ready — type your first message below"* in the chat/inspect view, with no init-error banner —
even though `/api/sessions` returns the actionable `latest_error`. Root cause in
`frontend/src/lib/components/ChatView.svelte`: the `{#if isInitError}` banner (≈line 412) is nested
inside the `{:else}` of `{:else if !hasTraceContent}`, so a session that failed init **before producing
any trace** (no prelude; `isInitializing` is false) falls into the empty-state branch and the banner is
unreachable. Two fixes: (a) check `isInitError`/`isInitializing` **before** the `!hasTraceContent`
empty-state branch (or add `isInitError` to the `hasTraceContent` OR-chain); (b) `toSessionSummary`
(`sessionStore.ts` ≈line 127) hardcodes `latest_error: undefined`, so even when the banner shows it
can't display the specific server+url message — map `record.initError` through instead. The UI-create
path is shielded by a preflight banner, but MCP/CLI/benchmark-created errored sessions hit this. NOTE:
a benchmark-failed session opened via the run drill-in (3BB3) *did* show the banner, so the trigger is
the empty-trace + list-loaded path — the reorder fix covers both.
</details>

**FINDING B-2 (needs prod-build verification) — SSE self-heal unobservable behind the Vite dev proxy.**
After a `tsx watch` backend restart, the browser's scheduler SSE went **stale**: the execution bar froze
on "Running R-BLVC" for 60s (>3× the 20s heartbeat) while the run had actually gone to `stopped`. A
direct `curl` to `:3030/api/scheduler/stream` *was* severed ~1s after the restart, and the `: ping`
heartbeat fires at 20s — so the **server** side is correct. The reconnect/backoff code is correct by
inspection (1s→10s capped doubling, reset after `HEALTHY_CONNECTION_MS`, tolerant parse). The likely
cause is the **Vite dev proxy** holding the browser↔vite socket open so the upstream close never reaches
the client; the client reconnects only on stream *end/error* and has **no independent ping-timeout**, so
any intermediary that swallows the disconnect leaves it stale. ACTION: verify U-SSE against a production
build (`npm run build && npm run start:backend`, browser direct to `:3030`, no proxy); consider adding a
client-side "no data/ping for >~25s ⇒ reconnect" watchdog so the self-heal is robust to proxies.

**TOOLING NOTE.** Running the browser tests auto-installed the `agent-browser` skill, which added
`agent-browser` to `package.json` deps and created `package-lock.json` changes, `.agents/`, and
`skills-lock.json`. This is test tooling — exclude from the `judge-session-improvement` PR (same as `skills/`).

---

## 6. Cleanup
- [ ] Delete throwaway sessions/benchmarks/runs created during testing (or just wipe the dev DB again).
- [ ] Decide on Finding #1 (CLI `max_tool_rounds` flags) before opening the PR.
- [ ] Decide whether untracked `skills/mcpscope/SKILL.md` belongs in this PR.
