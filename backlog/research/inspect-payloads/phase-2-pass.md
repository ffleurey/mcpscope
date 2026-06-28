# Phase 2 — the inspect-payload content pass (proposal)

> Companion to [`FINDINGS.md`](FINDINGS.md) (the tracked register) and
> [`serialization-architecture.md`](serialization-architecture.md) (the Phase-1 structure).
> Phase 1 stood up the render architecture + the `format` param and redesigned the benchmark
> payloads. **Phase 2 is the per-type content critique:** apply critical eyes to *what each
> payload contains* against its use-cases, make the obvious/defensible improvements, and flag
> only the genuinely debatable calls (with a low-risk default already implemented).
>
> Framing: **this is my assessed good-start.** Here is what I changed and why, and what
> remains for you to decide. Nothing below blocks you; the defaults are shippable as-is.

All payloads were re-captured from the **rebuilt** backend (read-only against `backend-data/`)
so the examples in each per-type folder reflect the improved output. `verify` is green.

---

## The headline wins

1. **Uniform "how did this session end and why" (F9/F10).** Every session payload now carries
   a top-level **`terminal_status`** (rendered as `status` in the header), derived the *same
   way* for primary, analysis, and judge sessions — and it agrees with the run report's
   per-session `terminal_status`. When it is `error`, the header also shows the **failure
   reason**: an analysis diagnostic, a persisted init failure, or — new — for a primary
   session, the trailing `diagnostic` part's stop reason.
   - `N8GF` (primary loop-to-cap) now reads `status error` + `error Turn stopped: reached the
     maximum of 20 tool-call rounds…` straight from the header.
   - `E5TS` (judge `json_parse_error`) presents the *identical* header shape.
   - This was the weakest surface in the whole register; it is now the most consistent.

2. **`B-` got a genuine summary/full split (F5).** Summary is a cheap router — `cases` as
   `{id, name}`, `runs` as `{id, status}` — and it skips the per-run progress computation
   entirely. Full adds prompts, rubric size, run completion counts, and evaluation IDs.

3. **Graph-plumbing trimmed from the JSON (F4).** `token_source`, `token_confidence` (every
   part) and `owner_step_id` (every turn) were **removed from the payload** — no use-case read
   them, and they were already omitted from text. `parent_ref` is now **rendered** (the
   run / analyzed-session edge, useful for the audit chain).

4. **Consistent model identity across types.** Sessions showed a friendly model name; runs and
   evals showed a raw config id (a UUID for one judge, a slug for another). Runs/evals now
   resolve a **`model_name` / `judge_model_name`** from a child session's snapshot (the same
   historical truth the session shows), keeping the config id as the JSON join key. `R-RZNP`
   now reads `model Gemma 4 12B QAT`; its evals read `judge Kimi K2.5` / `judge Gemma 4 12B
   QAT` (+ `temp` for judge-stability comparison) instead of opaque ids.

5. **Per-turn cost + structure.** A turn now carries a **`tokens`** summary (same shape as the
   run's per-session tokens) and renders a **header line** (`<id> turn <status> N rounds (T
   tokens)`), so "how costly / how many rounds was this turn?" is answerable up front and a
   turn reads like a step in the session view instead of an unlabeled run of parts.

6. **Cleaner structure, fewer cross-contaminating fields.** Session JSON groups all
   header/identity metadata (`model`, `mcp`, `parent_ref`, `terminal_status`, failure) **before
   the body** instead of trailing `parent_ref`/`mcp` after the big `steps` array. A compaction
   step no longer emits empty `owned_turn_ids`/`turns`/`postamble_step_ids` (analysis-step
   concepts) and an analysis step no longer emits null compaction fields. The run's full
   `per_case` now uses **`source_case_id`** — the same join key as `sessions`/`progress`/the
   eval — instead of an inconsistent `case_id`.

---

## Found by exercising fresh data (multi-model, multi-turn, analysis sessions)

The captured examples were all single-turn primary sessions. Running new sessions — a
multi-turn GPT-4o-mini + Meteo conversation, and re-inspecting the Kimi/Gemma judge sessions —
surfaced four real gaps, now fixed (each with a regression fixture in the coverage test):

1. **Analysis/judge sessions hid their entire trace (most impactful).** An analysis step
   (`analysis_bootstrap`, `analysis_benchmark_evaluation`, …) *owns* a turn with the agent's
   rounds, tool calls, and final answer — but the text renderer rendered only the step header,
   so a judge session's `mcpscope_inspect` calls and its verdict `assistant_answer` (with the
   cited evidence IDs) were **invisible in text**. This silently broke the "audit the judge"
   path (UC-7). Fixed: `renderGenericStep` now renders the owned turns. Guarded by the
   `analysis-session-full` fixture. (`owned_turn_ids`/`postamble_step_ids` are now allow-listed
   nav plumbing — the turns themselves carry the content.)

2. **An errored turn with no diagnostic showed no reason.** A turn can fail mid-stream (a
   provider/tool error) leaving only `status:error` + an `outcome` marker — no diagnostic part.
   The session header then read `status error` with nothing to drill. Fixed: the failure
   summary falls back to the errored turn (`<outcome>: Turn N ended in error`), and the turn
   node carries its `outcome` (rendered inline on the turn header when it didn't end cleanly).
   F9/F10 is now uniform across *every* failure kind — round-cap diagnostic, judge
   `json_parse_error`, init failure, and mid-stream provider error.

3. **Mid-session compaction rendered out of order.** The child sort parsed the id suffix, tying
   `2T` (turn 2) and `2C` (compaction-after-turn-1) and placing the compaction *after* turn 2.
   Fixed: children are sorted by **creation time**, so the trace reads chronologically.

4. **Per-turn cost/structure proved its worth on a real multi-turn trace.** The turn header +
   `tokens` (added earlier in this pass) make a multi-turn session legible — each turn's
   status, round count, and cost at a glance — which the single-turn captures couldn't show.

---

## Per-type pass

| Type | Summary vs full | What changed | Assessment |
|---|---|---|---|
| **session** | real dial (router vs evidence) | + `terminal_status`; `parent_ref` rendered; `latest_error` falls back to the trailing diagnostic for primary errors; dropped `token_source`/`token_confidence`/`owner_step_id`; **header metadata grouped before the body** | **good start.** Header now answers "what / where / did it fail & why" before the trace. |
| **setup** | real dial | `tool_definitions` shows a **tool count**; schemas stay drillable (not inlined) | good; one open Q (below). |
| **turn** | real dial | + a **header line** (rounds + token cost) and a **`tokens`** summary; dropped `owner_step_id`; capped tool args by design | good; per-turn cost now legible. |
| **round** | real dial | full lookup expands `{call, result}` (F7 — already true; doc fixed) | good. |
| **part** (all subtypes) | leaf (always full) | dropped `token_source`/`token_confidence`; diagnostic reason now also at session header | good; `short` flag still inert on parts (open, cosmetic). |
| **step / compaction** | real dial | removed dead `workflow_kind`/`workflow_label`; `latest_error` renders (F8); **kind-specific fields gated** (no empty turn-owning arrays on compaction, no null compaction fields on analysis steps); `parts` always present | good; no internal consumer **by decision** (F13). |
| **benchmark `B-`** | **now a real dial** (F5) | summary = case/run nav ids; full = + prompts/rubric-size/run completion/eval IDs; no results | good. |
| **case `B-.N`** | leaf (summary==full **by decision**) | unchanged — it *is* the full-spec drill target | correct as a leaf; cheap "list cases" lives in `B-` summary. |
| **run `R-`** | real dial | lean compare-summary, no embedded rubric (F12); flat session list; **friendly `model_name`** + per-eval `judge_model_name`; `per_case` keyed by **`source_case_id`** | good; model identity now matches sessions. |
| **evaluation `E-`** | real dial | lean score summary; full grid; `incomplete` flag (F5/F11); **friendly `judge_model_name` + `temp`** in the header | good. |

### Omission allow-list (reviewed)

After Phase 2 the text-omission allow-list is **only** deliberate JSON-only fields:
`source_turn_id` (text shows "after turn N"), `model.id` / `model_config_id` /
`judge_model_config_id` (text shows the friendly name), `session_type` and `workflow_kind`
(text shows `workflow_label` / the id namespace), plus the partially-surfaced enums
`context_state`/`type`/`status` and the echoed `mode`. Everything content-bearing is rendered;
the coverage test enforces it.

---

## Open design questions for you (low-risk default already implemented)

These are the calls reasonable people could disagree on. Each has a shipped default; none
blocks you.

1. **Should a full `setup` inspect inline the tool schemas? (F6)** — *Default: no.* The
   schemas are ~5k tokens and `setup`/`session` are the most-fetched router payloads;
   inlining defeats the token-efficiency goal, so schemas stay one drill away at the `-TD`
   part (now signposted by a tool count + token weight). The counter-argument: "inspect the
   setup in *full*" most strongly implies wanting the schemas, and setup is fetched far less
   than the session. If you agree, the cheap change is: inline `content.json` for
   `tool_definitions` **only when the setup itself is the direct target in full mode** (not
   when nested in a session). I left it out as the lower-risk choice.

2. **`parent_ref` label wording.** The header renders `parent benchmark R-RZNP` (the
   `parentKind` is the literal `"benchmark"` though `R-` is a *run*). Faithful to the data but
   slightly imprecise. *Default: render the raw kind.* Option: map the kind to a friendlier
   word ("run"/"analyzed session"). Cosmetic.

3. **Model name resolved from a child session, not a run-level snapshot.** Runs/evals store no
   model-name snapshot, so `model_name`/`judge_model_name` are read from the first child
   session's `modelProfileSnapshot`. *Default: resolve lazily.* If the run had zero sessions,
   or the session record was deleted, the name is `null` and the config-id is what shows. A
   future option is to snapshot the name onto the run/eval record at creation. Low-risk.

4. **The `short` flag is inert on parts and `B-.N` (leaves).** The operation docstring already
   carves out the exception. *Default: keep documented-but-inert.* Could signal it explicitly
   in the payload, but that adds noise to every leaf.

5. **`terminal_status` is shown even when `complete`.** Slightly noisy for a healthy session,
   but it directly serves the "did it fail?" use-case and makes the header self-describing.
   *Default: always show.* Could suppress on `complete`.

6. **A turn header line now appears in the session view too.** It delimits each turn with its
   round count + token cost (valuable for multi-turn/analysis sessions; mildly redundant for a
   single-turn session). *Default: always show*, parts kept flat (not indented) so the session
   log stays scannable.

---

## What I deliberately did **not** do

- **No new step-inspection consumer (F13).** The compaction payload is correct and cheap and
  the GUI/developer use it; no workflow needs to audit compaction programmatically today.
- **No splitting of `B-.N` / parts.** They are leaves; a split would only hide their most
  important field (the rubric / the evidence).
- **No re-architecture.** Phase-1's text-⊆-json-by-construction + coverage-test contract is
  untouched; every change above is content, not structure.

## Tests

- `deriveSessionTerminalStatus` — the terminal-status precedence (init error → analysis-phase
  error → last-turn status → session status) is unit-tested.
- `inspectBenchmark.test.ts` — the `B-` summary is the lean router (nav ids only) while full
  keeps the detail; the run carries `model_name` and the eval `judge_model_name`; the run's
  full `per_case` is keyed by `source_case_id` (not the old `case_id`).
- `app.test.ts` — the existing compaction-step contract (`parts` always present;
  `stripped_parts` only in full) still holds after the kind-specific field gating.
- **New coverage fixtures from real sessions:** `analysis-session-full` (ZTJE — steps own
  turns, guards the owned-turn rendering) and `multiturn-error-full` (RH8P — 2 turns, 2nd
  errored mid-stream, guards turn `outcome` + the synthesized failure summary + chronological
  ordering). Both run through the json-⊆-text coverage test.
- Coverage fixtures regenerated from the new payloads; the coverage test stays green over them
  and the seeded benchmark types.
