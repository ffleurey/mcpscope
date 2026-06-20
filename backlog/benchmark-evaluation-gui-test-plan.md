# Benchmark LLM-evaluation — GUI test plan

Manual GUI evaluation of the shipped benchmark LLM-evaluation feature (branch
`more-gui-adjustments`), based on the Home Assistant case study
(`case-study/prompts/with-evaluation/`). Findings are recorded inline under each test.

- **Status legend:** ⬜ not run · ✅ pass · ⚠️ pass with notes · ❌ fail
- Record observations under **Findings** as you go; we triage from there.

## Fixtures (provisioned via MCP)

- **Benchmark `B-266B` — "Oslo HA history — V1 seed"**, 4 cases, deterministic tool-checks set.
  Rubrics intentionally left empty (authored in the GUI — that is Test 2).

| Case | Theme | `expected_tools_called` | `expected_tools_not_called` |
|---|---|---|---|
| B-266B.1 | Climate matrix (4 areas, 7d) | `ha_history_list_entities`, `ha_history_get_sensor_stats` | — |
| B-266B.2 | EV charger energy + sessions | `ha_history_get_consumption`, `ha_history_detect_sessions` | — |
| B-266B.3 | Stairs motion daily | `ha_history_get_state_history` | `ha_history_get_sensor_stats`, `ha_history_detect_sessions` |
| B-266B.4 | Olivia away-from-home | `ha_history_get_state_history` | `ha_history_get_sensor_stats`, `ha_history_get_consumption`, `ha_history_detect_sessions` |

- **Environment:** model configs incl. Qwen3.6 35B APEX (`qwen36-35b-apex`) + Gemmas;
  MCP profile **HA Oslo** (`ha-oslo`, `http://localhost:3011/mcp`).
- **Recommended run settings:** strongest local model as the system-under-test, MCP =
  HA Oslo, all 4 cases, repetitions = 2. Judge with a **different, strong** model
  (Qwen 35B APEX). 4 cases × 2 reps = 8 task sessions; an evaluation pass adds 8 judge
  sessions. Runs/evaluations are sequential — allow a few minutes.

## Rubrics to author in the GUI (Test 2)

Each criterion is `points` — description. Sum = 10/case. They score **path quality +
answer quality**, the case study's core ask.

### B-266B.1 — Climate matrix
- `3` — Resolves the four areas' ambient temp+humidity entities without asking for IDs (≤2 discovery calls); uses only room/outdoor climate sensors, not batteries, setpoints, or litter-box/printer internal temps.
- `3` — Uses `ha_history_get_sensor_stats` for mean/min/max temp + mean humidity over the 7-day period (real values, not fabricated).
- `2` — Single compact comparative table covering Cave, Kitchen, Salon, Outdoor with avg/min/max temp + avg humidity.
- `2` — If the daily shape can't be fully satisfied, states the limitation honestly instead of inventing daily min/max.

### B-266B.2 — EV charger
- `3` — Resolves the outdoor EV charger device + power/energy entities without asking for IDs (even though named like a plug).
- `3` — Returns total charging energy (consumption) **and** session count (detect_sessions) for 30 days.
- `2` — Compact session table: date, start, end, duration, peak power, energy.
- `2` — Concise; no device-by-device exploratory wandering.

### B-266B.3 — Stairs motion
- `3` — Resolves both entrance/stairs motion binary sensors without asking for IDs.
- `3` — Uses binary-sensor state history (`state_value=on`, `group_by=day`) — not numeric stats or threshold sessions.
- `2` — Daily comparison table for both sensors over 7 days + per-sensor totals + last-trigger.
- `2` — Ends with a busier-overall conclusion; doesn't invent hourly buckets / unsupported raw-transition claims.

### B-266B.4 — Olivia away
- `3` — Resolves Olivia's correct person/tracker entity; not distracted by battery/app-version/charger/geocode companion-phone entities.
- `3` — Uses discrete state history (not numeric tools); treats "not home" as time outside the Home zone.
- `2` — Day-by-day table (away sessions, first departure, last return, total away) + accumulated weekly total.
- `2` — States the entity used; concise and factual; notes retention limits if relevant.

---

## Tests

### T0 — Sanity (fresh DB)
App loads, no console errors; sidebar shows the 3 sections; LM connections + MCP
profiles still present (config survived the DB reset).

- Status: ⬜
- Findings:

### T1 — Benchmark created via MCP is visible
Open Benchmarks → "Oslo HA history — V1 seed" (`B-266B`) with 4 cases. Open a case card:
prompt + expected/forbidden tools render; rubric section empty.

- Status: ⬜
- Findings:

### T2 — Rubric editor (new UI)
Edit each case → Rubric section → Add criterion rows, paste descriptions + points above →
Save. Reopen: criteria persist in order; case card shows "Rubric (10 pts)" with each line.
Try remove / reorder / edit points and re-save.

- Status: ✅ (one note)
- Findings: Editor + criterion system work well; usability good. Confirms case editing
  works. **No UI to reorder criteria.** Assessed as cosmetic — ordering has no evaluation
  impact (ids are positional, assigned on save; judge renders in list order and cites those
  ids; scoring sums awarded/max regardless of order). Decision: leave out for V1 (see triage
  TR-1).

### T3 — Launch a run
Run → model under test, MCP = HA Oslo, all 4 cases, repetitions = 2 → Launch. Run view
opens; status `pending → running`; per-case progress ticks; child sessions appear live in
the tree under the run (tests live polling).

- Status: ⬜
- Findings:

### T4 — Run report / deterministic metrics
On `complete`: per-tool rollup (calls/errors/error-rate); per-case Success / pass@k / pass^k
reflecting the tool-checks (e.g. case 3 fails if the model used `get_sensor_stats`). Open a
case → its sessions → inspect a session trace.

- Status: ⬜
- Findings:

### T5 — Evaluate (judge model)
On the completed run, click **Evaluate** → pick a different, strong judge (Qwen 35B APEX) →
Launch. Returns immediately; the "LLM evaluation" section appears with status `running`.

- Status: ⬜
- Findings:

### T6 — Evaluation scores (live)
While judging, judge child sessions appear in the tree (parented to each run-session); the
pass polls to `complete` and shows overall % + per-case rows with min/med/max distribution
across the 2 repetitions.

- Status: ⬜
- Findings:

### T7 — Verdict drilldown + ID linkification
Expand a case's per-session verdicts (eye icon). Each session shows `awarded/max` + pct +
status, with run-session and judge-session IDs as clickable `IdBadge`s. Click the judge
session id → resolves to the analysis session; read the verdict's per-criterion notes
(should cite hierarchical IDs).

- Status: ⬜ (retest after TR-4 fix)
- Findings: Judge sessions did not appear anywhere in the treeview (see TR-4). Fixed — they now
  nest under their run-session in the Benchmark-runs tree. Re-verify navigation + that opening a
  judge session shows its full trace (context, tool calls, pulled evidence).

### T8 — Repeatability / compare judges
Click **Evaluate** again with a different judge model. A second evaluation pass appears
alongside the first; both show independent scores (confirms 0..N passes per run).

- Status: ⬜
- Findings:

### T9 — Negative / edge checks
- A case with **no rubric** (re-run + re-evaluate): its sessions are listed but not LLM-scored (excluded from stats).
- Self-judge: judging with the same model as the task is allowed (not blocked) — note behavior.

- Status: ⬜
- Findings:

### T10 — Cross-surface read (optional)
Shell: `benchmark_run_evaluations <R-id>` (CLI) or `GET /api/operations/benchmark-runs/<R-id>/evaluations`.
Same scores in snake_case → CLI/MCP parity holds.

- Status: ⬜
- Findings:

---

## Triage / follow-ups

Issues found, with severity + proposed fix, get listed here as we work through the plan.

- **TR-1 (low / won't-do for V1)** — No UI to reorder rubric criteria (T2). Ordering is
  cosmetic: no effect on scoring or the judge's verdict (ids are positional and re-derived on
  save). Recommend leaving out for V1; revisit only as drag-to-reorder polish if desired.
- **TR-2 (terminology / decision pending)** — Question on the "Rubric" term (T2). Assessment:
  "rubric" is a standard term (educational assessment + LLM-as-judge literature) for weighted
  scoring criteria with partial credit, and it pairs cleanly opposite the deterministic
  **checks** (the oracle-like binary `expectedTools*`). Recommend **keep "rubric"**.
  Alternatives if renamed: "scoring/grading criteria" or "scorecard" — wordier, less standard;
  rename would ripple through `rubric_json` column, types, ops, UI labels, and docs. Awaiting
  user decision. (Cross-language check: French "barème" — a points-per-criterion grading
  scheme — is the same concept; English assessment equivalents are "rubric" / "mark scheme".
  The concept having a settled name in both languages reinforces keeping "rubric".)
- **TR-3 (styling — partly fixed, rest decision-pending)** — Case editor could echo the card's
  color scheme (green/red tools, amber points) and use a red delete icon (T2).
  - **Done:** remove-criterion icon now uses the sanctioned `.icon-btn-danger` (red), matching
    every other delete affordance + the Design Reference. check/lint clean.
  - **Recommend NOT doing (deviation):** recoloring the editor's tool inputs green/red and the
    points input amber. Design system reserves green for session data (not forms), red for
    errors (red input text reads as validation error), amber for focus/accent; `.field-input`
    text is `--text-bright`. The card's colors are sanctioned because it's read-only *display*
    ("color carries signal"); editable inputs should stay neutral chrome. The editor is already
    compliant; no design-system change needed. If an echo is still wanted, the compliant route
    is a static colored preview (chips/labels), not recolored inputs — user's call.
- **TR-4 (fixed) — judge sessions invisible in the tree (T6/T7).** Judge sessions are
  `session_analysis` children of a run-session, but ChatList excludes run-sessions and RunList
  didn't descend into run-session children, so they rendered nowhere. **Fix (Option 2):** RunList
  now nests judge sessions under their run-session (run → run-session → judge session), mirroring
  the analysis-child pattern; each opens in the normal session view. Chose this over an
  "evaluation container" tree node because it matches the data model (`parent_id`), reuses the
  existing pattern, and needs no new concept. check/lint clean; awaiting GUI re-verify.
- **TR-5 (decision — raw vs clamped verdict).** Judge can over-award a criterion (saw `points:2`
  on a max-1 criterion in VJNN/E-3GLL). Scoring clamps correctly (→ 5/6), but `inspect` shows the
  raw verdict text (unclamped `2`), so the trace and the computed score disagree for over-awards.
  Options: store clamped + raw on the verdict artifact and show clamped in UI; or annotate
  "clamped from N". Low-risk but needs a presentation decision.
- **TR-6 (fixed) — temperature/model not surfaced in inspect.** Confirmed via R-V55D judge
  sessions: temperature *is* stored (modelProfileSnapshot.temperature) but the inspect/lookup
  `model` block only emitted name+key. Added `id` (model config id), `temperature`, `reasoning`.
  Live-verified `temperature:0` (explains the identical passes — same self-judge model at temp 0).
  Follow-up option: surface it in the GUI session header too (consumes lookup; data already there).
- **TR-7 (decision — run/eval rubric not inspectable).** The rubric a past run/evaluation was
  judged against is stored in the run snapshot (`cases_json`) but omitted from the run
  serialization (`runToSnake`), so `benchmark_inspect`/run views can't show "what was scored
  against." Recommend surfacing the snapshot rubric (add to run-snapshot serialization + run type).
- **TR-8 (design — snapshot vs live rubric for evaluation).** Evaluation judges against the
  run-snapshot rubric (captured at run launch), not the live case rubric. Pro: reproducible,
  matches the immutable-run philosophy. Con: a rubric added/edited *after* a run does NOT apply to
  that run (would judge against an empty/old rubric) — a real workflow gotcha (author-rubric-then-
  evaluate-an-existing-run silently uses the stale snapshot). Observed live: B-266B.1's rubric was
  edited after R-V55D, so the current case rubric differs from what E-3GLL/E-NBLY used. Decide:
  keep snapshot (and message it / warn when snapshot rubric is empty), or evaluate against live
  case rubric, or offer a choice.
- **TR-9 (feature — judge temperature control + context-size display in the Evaluate modal).**
  Makes sense; confirmed scope. (a) Judge temperature is hardcoded `0` (benchmark.ts:992) — add
  an editable field in EvaluationLaunchModal **defaulting to 0** (keep deterministic default),
  thread as optional through store → API body → POST /evaluations → evaluateBenchmarkRun →
  judgeOneSession → executeAnalysisLaunch; add optional `temperature` to the `benchmark_evaluate`
  op + `--temperature` CLI flag for parity. (b) Context size: read-only display of the selected
  judge config's `contextSize` (already on the frontend ModelConfig) with a "configured on the
  model; reload to change" hint — frontend-only. Sub-decision: store judge temperature on the
  evaluation record so the list can show "judged at temp X" (lean yes) vs rely on the judge
  session snapshot (TR-6). Docs note: temperature default 0, overridable. Build pending user OK.
- **TR-10 (fixed) — dialogs didn't separate from the dark background.** Dark-on-dark panel with a
  faint `--border`. Fixed in the single shared place (`DialogShell.svelte` `.dialog-inner`):
  `--amber-dim` border (marks the active/focused surface — sanctioned amber-accent use) +
  elevation shadow `0 10px 40px rgba(0,0,0,0.55)`, backdrop `0.55→0.62`. All dialogs inherit it
  (they all compose DialogShell); DESIGN-SYSTEM.md updated. **Maintainability check: passed** —
  one-file change, no per-dialog edits. check/lint/prettier clean.
