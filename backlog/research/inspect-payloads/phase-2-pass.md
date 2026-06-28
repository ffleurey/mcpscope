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

---

## Per-type pass

| Type | Summary vs full | What changed | Assessment |
|---|---|---|---|
| **session** | real dial (router vs evidence) | + `terminal_status`; `parent_ref` rendered; `latest_error` falls back to the trailing diagnostic for primary errors; dropped `token_source`/`token_confidence`/`owner_step_id` | **good start.** Header now answers "did it fail & why" without a drill. |
| **setup** | real dial | `tool_definitions` shows a **tool count**; schemas stay drillable (not inlined) | good; one open Q (below). |
| **turn** | real dial | dropped `owner_step_id`; capped tool args by design | good. |
| **round** | real dial | full lookup expands `{call, result}` (F7 — already true; doc fixed) | good. |
| **part** (all subtypes) | leaf (always full) | dropped `token_source`/`token_confidence`; diagnostic reason now also at session header | good; `short` flag still inert on parts (open, cosmetic). |
| **step / compaction** | real dial | removed dead `workflow_kind`/`workflow_label` null fields; `latest_error` renders (F8) | good; no internal consumer **by decision** (F13). |
| **benchmark `B-`** | **now a real dial** (F5) | summary = case/run nav ids; full = + prompts/rubric-size/run completion/eval IDs; no results | good. |
| **case `B-.N`** | leaf (summary==full **by decision**) | unchanged — it *is* the full-spec drill target | correct as a leaf; cheap "list cases" lives in `B-` summary. |
| **run `R-`** | real dial | (Phase 1) lean compare-summary, no embedded rubric (F12); flat session list | good; minor open Q (model id below). |
| **evaluation `E-`** | real dial | (Phase 1) lean score summary; full grid; `incomplete` flag (F5/F11) | good. |

### Omission allow-list (reviewed)

After Phase 2 the text-omission allow-list is **only** deliberate JSON-only fields:
`source_turn_id` (text shows "after turn N"), `model.id` (text shows name + key),
`session_type` and `workflow_kind` (text shows `workflow_label` / the id namespace), plus the
partially-surfaced enums `context_state`/`type`/`status` and the echoed `mode`. Everything
content-bearing is rendered; the coverage test enforces it.

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

3. **`R-` run header shows the raw `model_config_id` UUID**, not a friendly model name — the
   run record (unlike a session) stores no model-name snapshot. *Default: leave it* (a future
   nicety would resolve/snapshot the name). Not in scope for a payload-content pass.

4. **The `short` flag is inert on parts and `B-.N` (leaves).** The operation docstring already
   carves out the exception. *Default: keep documented-but-inert.* Could signal it explicitly
   in the payload, but that adds noise to every leaf.

5. **`terminal_status` is shown even when `complete`.** Slightly noisy for a healthy session,
   but it directly serves the "did it fail?" use-case and makes the header self-describing.
   *Default: always show.* Could suppress on `complete`.

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
- `inspectBenchmark.test.ts` — added a case asserting the `B-` summary is the lean router
  (nav ids only) while full keeps the detail.
- Coverage fixtures regenerated from the new payloads; the json-⊆-text coverage test stays
  green over them and the seeded benchmark types.
