# Phase 2 — use-case trials on real data

> Companion to [`phase-2-pass.md`](phase-2-pass.md). The pass proposed a baseline; this doc
> **actually performs the documented use-cases** ([`use-cases.md`](use-cases.md) UC‑1…7) on
> real sessions/runs and judges whether each payload carries the *right amount* of information
> — too little (forces extra fetches), too much (bloat), or right-sized. Local models only
> (no OpenRouter for the task/judge models created here).

## Experiment data created for these trials

| Object | What | Why |
|---|---|---|
| Session `RH8P` | 2-turn, GPT-4o-mini + Meteo, 2nd turn errored mid-stream | multi-turn + mid-stream error (earlier turn) |
| Session `2ZHT` | 2-turn, Gemini 2.5 Flash Lite + Meteo, clean | clean multi-turn reference (earlier turn) |
| **Run `R-AW4J`** | **B-GUDP cases 1–2 × 2 reps, Gemma 4 E4B** | a 2nd run of B-GUDP on a *different local model* to compare against `R-RZNP` (Gemma 4 12B QAT). (Interrupted by a dev-server reload mid-run, then **resumed** — exercised the run-control resume path too.) |
| **Eval `E-V5V2`** (on R-AW4J) | local judge Gemma 4 12B QAT | the compare/audit chain with a local judge; landed `status:error` (3/4, one invalid-JSON judge) — a real incomplete eval |

`R-RZNP` (Gemma 4 12B QAT, B-GUDP all 5 cases × 5 reps, evals E-FE7K Kimi + E-2BPM Gemma)
already existed and is the baseline run.

---

## UC-3 · Document a benchmark / a case

**Fetch path performed:** `inspect B-GUDP` (full) → `inspect B-GUDP.1` (case).

- **`B-GUDP` full** gives suite id/name/description, the 5 cases (id, name, prompt,
  `rubric_criteria_count`), and the runs (id, status, completion, eval IDs). **Right-sized as a
  router:** you see the suite shape and where to drill. **Deliberately omits the rubrics** — so
  *fully* documenting the suite (every answer key) is 1 + N fetches (`B-` + each `B-.N`).
- **`B-GUDP.1`** is the full case spec in one fetch — prompt, `expected_tools_(not_)called`,
  the rubric (criteria + points), provenance. **Exactly right** for "document/edit a case."

**Verdict:** case payload right-sized; suite payload right-sized *as a router* but a reviewer
documenting the whole answer-key set pays N drills. The `rubric_criteria_count` hint is the
right compromise (inlining 5×~6 criteria would bloat the most-listed payload). *Judgment call,
default kept:* no rubric inlining in `B-`.

---

## UC-7 · Audit the judge (the dog-food chain)

**Fetch path performed:** `inspect E-FE7K` (full) → pick a low score (`ZTJE` judged `9LJM` at
20%) → `inspect ZTJE` → read the verdict → `inspect 9LJM.1T.4.1-A` (a cited id).

- `E-FE7K` full gives the per-criterion grid inline (rubric × awarded points + the judge's
  ID-citing note) — you can often see *why* a score is low without leaving the eval.
- Drilling the judge session `ZTJE` shows its full trace: the `mcpscope_inspect` call and the
  verdict `assistant_answer` citing `9LJM.1T.4.1-A` (wrong coldest-day value), `9LJM.1T.3.2-T`
  (the `min` aggregation), etc.
- **This chain was BROKEN before this pass** — the judge's owned turn (its verdict) was
  invisible in text. Fixing the owned-turn rendering is what makes UC-7 actually work in text.

**Verdict:** right-sized. `E-` full answers most audits; the judge-session drill (now legible)
+ the cited part are the deeper rungs. The fix here was the single highest-value find of the
whole content pass.

---

## UC-6 · Diagnose non-determinism across repetitions

**Fetch path performed:** `inspect R-RZNP` (full) → read per-case `pass_at_k` vs `pass_hat_k`.

- `R-RZNP` per-case: `B-GUDP.2 pass 4/5 (80%) pass@k 1 pass^k 0` — `pass@k=1` (some rep passed)
  but `pass^k=0` (not all) is the exact non-determinism signal; `B-GUDP.1` shows `pass^k 1`
  (reliable). `total_token_stats` carries the stddev for token-instability.

**Verdict:** right-sized. The `pass@k`/`pass^k` gap + token stddev in one fetch localise
non-determinism, then `per_session` `terminal_status` routes to the culprit rep. No gap.

---

## UC-4 · Write a report for a single run

**Fetch path performed:** `inspect R-AW4J` (full) — one fetch.

That single payload carried everything a run report needs:
- **Config:** `model Gemma 4 E4B`, `mcp ha-replay`, reps, max-tool-rounds — the report header.
- **Run-level error, legible:** `Interrupted by a server restart; resume to recover.` (the run
  was interrupted; the message reads as prose, not a code).
- **Per-case** pass rates + `pass@k`/`pass^k` (`B-GUDP.1 100% pass^k 1`; `B-GUDP.2 50% pass^k 0`).
- **Per-tool rollup** (calls/errors/error_rate/payload chars) — the "which tools misbehave"
  scorecard (here: 0 errors, so the server was clean; E4B's misses are answer-quality, not tool
  failures).
- **Per-session** metrics (`tool_call_count`, `total_tokens`, `terminal_status`) to drill the
  anomaly.

**Verdict: right-sized.** One fetch *is* the report backbone and either answers or routes. The
only judgment call: for a 25-session run the full payload is large, but that is the report, and
the **summary** is the lean variant — the split is correct.

---

## UC-5 · Compare runs across models (the headline workflow)

**Two comparable runs of B-GUDP, cases 1–2, on different *local* models:**

| Run | Task model | reps | B-GUDP.1 pass | B-GUDP.2 pass |
|---|---|---|---|---|
| `R-RZNP` | Gemma 4 **12B** QAT | 5 | 5/5 (pass^k 1) | 4/5 (pass^k 0) |
| `R-AW4J` | Gemma 4 **E4B** | 2 | 2/2 (pass^k 1) | 1/2 (pass^k 0) |

**Fetch path performed:** `inspect R-RZNP --short` + `inspect R-AW4J --short` → config diff
(model 12B vs E4B; same cases/mcp) confirms they're comparable on the varied axis. Then the
**eval `overall_pct`** to compare *quality*.

**Payload gap found and fixed (the key UC-5 finding):** the run **summary's eval digest carried
`judged/expected` but not `overall_pct`** — so "which run scored better?" forced a separate
`E-` fetch per run, defeating the "each run summary is the comparison unit" design. Fixed: the
eval digest now carries **`overall_pct`** (+ an `incomplete` flag), rendered as
`E-…  complete  overall NN%  judged x/y  judge <name>`. Comparison is now **one fetch per run**.

Quality comparison (same **Gemma 4 12B QAT judge** on both — eval `E-2BPM` on R-RZNP,
`E-V5V2` on R-AW4J — to control the judge and isolate the task model, cases 1–2):

| Case | R-RZNP (12B task) mean | R-AW4J (E4B task) mean |
|---|---|---|
| B-GUDP.1 | 26% | 20% |
| B-GUDP.2 | 50% | 20% |

The bigger model scores higher, and the gap widens on the harder case (charger-energy) — a
coherent result the payloads supported end-to-end: run-summary config diff → eval `overall_pct`
→ per-case `pct_stats` (the drill) → a specific session's verdict. Both evals landed
**`status:error` / incomplete** (a Gemma-12B judge session returned invalid JSON in each — the
`json_parse_error` pattern), and the `incomplete` flag + `⚠` made that visible at every level
(run summary, eval summary), so the partial scores read as provisional rather than final.

**Verdict:** with `overall_pct` in the run summary, UC-5 is a clean 1-fetch-per-run compare;
the per-case `pct_stats` in `E-` full is the drill when a headline moves. Before the fix the
run summary was **missing the one number the use-case is about**.

---

## What the trials changed (summary)

- **UC-5 (too little → fixed):** run-summary eval digest now carries `overall_pct` + `incomplete`,
  so runs rank by quality from the run payload — no per-run `E-` drill just to compare.
- **UC-7 (was broken → fixed earlier):** the judge's verdict (its owned turn) renders, so the
  audit chain works in text.
- **UC-3 (judgment call, kept):** `B-` omits rubrics (router stays lean); whole-suite
  documentation pays N case drills — the `rubric_criteria_count` hint is the compromise.
- **UC-4 / UC-6 (right-sized, no change):** the run full payload is the report backbone and the
  `pass@k`/`pass^k` gap localises non-determinism in one fetch.

No payload was found to carry clearly *too much* for a use-case; the lean summaries + drillable
detail split held up. The one real "too little" was UC-5's missing `overall_pct`.
