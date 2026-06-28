# Inspect use-cases & the gradual-exploration model

> Research note for the [inspect-payload tuning task](../../tuning-of-inspect-payload.md).
> The per-object READMEs document each object type in isolation; this doc takes the
> **workflow view** — the real investigation goals — and maps each to a *fetch path*.

## The design principle

`inspect` is a **smart, use-case-aware file reader**. The model should explore
**gradually**: each fetch is either (a) enough to fulfil the goal, or (b) enough to decide
exactly what to fetch next — without bloating context with more than the goal needs.

Two consequences for payload design:

- **A payload only earns its split if a use-case is satisfied before fetching the
  children.** Breaking a payload into summary/children is pointless if every question
  forces you to fetch everything anyway. Each granularity must be a real decision point.
- **Every navigation payload must be a router**: it must surface the IDs *and the signal*
  (token cost, status, error, which tool, pass/fail) needed to choose the next fetch. A
  navigation payload that lists children without that signal forces a blind drill.

Each use-case below is scored on two axes: **does the entry fetch alone often suffice?**
and **does it cleanly route the next fetch?**

---

## UC-1 · Analyse a session / "why did it work or not"

**Entry fetch (single):** `inspect <session>` (full overview) → user prompt, final answer,
and per-round tool calls with (capped) arguments.

- **Suffices when:** the answer is right/wrong on its face, or the tool-selection mistake
  is visible in the call list (wrong tool, missing call, malformed args within 80 chars).
- **Routes to:** `reasoning` part (why this tool?), `tool_call` part (exact result values
  / long args), or `setup` parts (config-caused failure). Each is one targeted leaf fetch.

This is the canonical loop and the one the **benchmark judge** runs:
"Inspecting the session … returns the user request, the final answer, and each round's
tool calls … enough for most criteria. Fetch a specific turn or part only when a tool-use
criterion needs a detail the session view omits"
([`benchmarkEvaluation/systemPrompt.ts:22`](../../../backend/src/analysis/benchmarkEvaluation/systemPrompt.ts)).
**Entry suffices: often · Routes: cleanly.** The model case to protect when tuning.

## UC-2 · Make a recommendation about an MCP tool / server

**Goal:** is a tool's description / parameters / result shape good, or did the model have
to fight it?

**Entry fetch:** depends on sub-question —
- description quality → `inspect <tool_definitions part>` (the only place with full schemas);
- call/result quality → `inspect <tool_call part>` (full `{call, result}` — "was the
  result payload useful, or did the model work around its shape?").

**Suffices when:** one tool-call part shows an oversized/awkward result or a parameter the
model got wrong. **Routes to:** the `run` report's per-tool rollup (UC-4) to see if it's
systemic across repetitions, or sibling `tool_call` parts.
**Entry suffices: often (per instance) · Routes: to systemic view.**

## UC-3 · Document a benchmark or a case

**Entry fetch (single):**
- whole suite → `inspect <B->` → all cases (prompt + rubric + tool checks) + run list,
  **in one fetch** (summary == full today);
- one case → `inspect <B-.N>` → prompt, `expected_tools_(not_)called`, rubric, provenance
  `source_session_id`, **in one fetch**.

**Suffices: almost always** — these payloads are small and complete; documenting the suite
is a single read. **Routes to:** `source_session_id` (where a from-session case came from)
or a run to show results. **Caveat:** JSON-only (no text renderer) and summary==full, so
the split does nothing here — fine for *this* use-case, but means there's no lean variant
for UC-5. **Entry suffices: yes · Routes: optional.**

## UC-4 · Write a report for a single run

**Entry fetch (single):** `inspect <R-> ` **full** → config snapshot (model, MCP profiles,
repetitions, cases+rubric) **+ the metrics report**: per-tool rollup (calls/errors/
error_rate/payload size), per-case `success_rate` / `pass_at_k` / `pass_hat_k` / token
stats, per-session metrics. This single payload is the **backbone of the report**.

- **Suffices when:** the report is about aggregate behaviour and reliability.
- **Routes to:** a failing session (`per_session` → session ID → UC-1), or a flaky tool
  (per-tool error → the `tool_call` parts where it errored → UC-2).

**Entry suffices: for the aggregate report · Routes: cleanly to every anomaly.** The
strongest example of "one rich fetch that either answers or routes." Today JSON-only —
the highest-value place to add a text/table renderer ([`formats.md`](formats.md) §3).

## UC-5 · Compare runs (different model / settings / MCP server version)

**Goal:** run the same cases against different model/MCP/version and see what changed.

**Fetch path (one bounded fetch per run, not one giant payload):**
1. `inspect <R-> --short` for each run → config snapshots to confirm the runs are
   comparable on the axis you're varying (model, mcp_profile_ids, repetitions, cases).
2. `inspect <E->` per run → `overall_pct` (+ per-case `pct_stats`) to compare *quality*;
   believe an uplift only if it clears the distribution's noise band.
3. Drill only where they diverge → the two runs' full reports (UC-4) → the diverging
   case's sessions (UC-1).

**Suffices when:** the headline metric moved and the config diff explains it.
**Routes:** by construction — each run summary is the comparison unit.

**Tuning gaps this use-case exposes:**
- Run **summary still embeds the full case rubric** — heavy for a comparison that only
  needs config + IDs. A leaner summary tuned for "compare many" would help.
- There is **no single comparison payload**; comparison is N fetches. That is consistent
  with the gradual model (each fetch routes), but a future `compare` affordance could
  collapse the common case. Worth a design note, not necessarily a payload split.
- `E-` summary is **not lighter than full** (the full scored grid is always computed) —
  for the "just compare overall_pct" step we pay for the whole grid. Candidate fix.

## UC-6 · Diagnose non-determinism across repetitions

**Entry fetch:** `inspect <R->` full → per-case `pass_at_k` vs `pass_hat_k` gap and token
stddev flag instability. **Routes to:** the specific repetition session (`per_session`
terminal_status / error) → UC-1. **Entry suffices: to localise · Routes: to the culprit rep.**

## UC-7 · Read the scoring of an evaluation / audit the judge

**Entry fetch:** `inspect <E->` full → per-criterion grid (`criteria[{id, description, max,
points, note}]`) with the judge's ID-citing notes. **Routes to:** each session's
`analysis_session_id` → inspect the judge session → follow the session/turn/part IDs it
cited (the verdict is itself a dog-fooded inspect chain). **Entry suffices: for the grid ·
Routes: to the judge's own evidence.**

---

## Where the current granularity already fits the principle

- **session ↔ part** is a textbook hub-and-leaf split: the session/turn overview routes,
  the part delivers evidence. Protect this when tuning.
- **run full** is the rare payload that both *answers* (aggregate report) and *routes*
  (per-session / per-tool anomalies) from one fetch — the model to emulate elsewhere.

## Where it doesn't (the tuning agenda this doc adds)

| Gap | Use-case hurt | Note |
|---|---|---|
| `B-` / `B-.N` summary == full | UC-3, UC-5 | no lean variant for comparison/listing |
| `E-` summary == full (grid always computed) | UC-5, UC-7 | summary should be `overall_pct` + completeness only |
| run summary embeds full rubric | UC-5 | comparison only needs config + IDs |
| benchmark family has no text renderer | UC-3, UC-4, UC-5, UC-7 | the report/compare payloads pay full JSON cost ([`formats.md`](formats.md)) |
| navigation payloads cost 2.8–3.1× as JSON over MCP | UC-1, UC-4, UC-6 | the repeated fetches are the most expensive ones ([`formats.md`](formats.md)) |
| step/compaction payload has no consumer | — | rich payload, no use-case drives it (per-object [`step/README.md`](step/)) |

Every row is a concrete, discussable change for the next phase of the tuning task.
