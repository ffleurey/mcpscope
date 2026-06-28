One of the most important feature of mcpscope is the inspect tool which gives full CLI and MCP coverage to inspect efficiently and with as many details as required all the parts of sessions and now also benchmarks, runs and llm evaluations.

mcpscope is only as good as the quality of the inspect payloads it offers in order to have agent (and developers) able to work efficiently with it.

We had a pass early in the mcpscope development to tune the session and parts payloads for primary sessions and their child nodes but sinec then we have not put too much effort in tuning those inspect payloads. 

In our inspect tool, we want to support all types of mcpscope object and for each type of object we have the option of defining 2 granularity the summary and full.

I would like us to systematically capture inspect payload (in text, not JSON to help readability) which we can review. For each different type of type of object we inspect we are going to review the exact information provided in each of the 2 modes and we are going to define the use-cases for those payloads. ie. when reviwing a benchmark run in sumarey we might be comparing runs and making a report that compares run to run. If we inspect a run in full, we are probably making a report for that specific run and need to have more details. Etc.

The fist step of this task is to make a documentation structure which we are going to use to decide on any changes or act leasty evaluate what we have today. We need to make a folder for each type of object we can inspect and in this folder put a few md files with the output of inspect payloads for a few example and then a README file in which we define the usecases we see for inspecting this type of object.

To figure out the usecases we will need to review our documentation broadly, including our research folder, user documentation and potentially completed tasks which probably include a lot of thinking and discussion on the different scenario for inspection.

An important aspect is the bootstraped / eating our own dogfood where we are heavily using the mcp tools ourselves for llm evaluation, analysis sessions, etc. These are important use-cases.

This is a tasks taht reaquires a lot of exploration and heavy systematic work before we start actually looking at what changes we want to make.

---

# Hand-over — Phase 1 complete; ready for Phase 2 (2026-06-28)

The original "explore → capture → decide" work above is **done**, and we went on to build the
**structural foundation (Phase 1)**: a backend rendering architecture, the benchmark payload
redesign, and the GUI inspect dialog/navigator. What remains is **Phase 2 — the per-payload
*content* critique**: applying critical eyes to what each payload actually contains, against
the documented use-cases. Phase 1 deliberately changed *structure* (and the benchmark payloads,
which had no evidence of being good) while keeping sessions/parts as the reference.

**Everything is on branch `tuning-of-inspect-payload`** (pushed). Commits:
`5666ee9` backend render + `format` param + benchmark redesign + GUI dialog ·
`8edf5d9` GUI payload navigator · `7190dfd` format fix.
The full `verify` gate is green (prettier + eslint + svelte-check + tsc + **323 tests**).

## Hand-over package — `backlog/research/inspect-payloads/`

Read in this order:
- **`README.md`** — overview + the cross-cutting findings narrative + folder index.
- **`FINDINGS.md`** — the authoritative, tracked register **F1–F16** (severity, evidence,
  proposed direction, and which are resolved by Phase 1). *This is the Phase-2 work list.*
- **`use-cases.md`** (workflow fetch-paths UC‑1…7) and **`use-cases-by-type.md`** (the micro
  per-type use-cases with the key ones flagged) — the lens for the content critique.
- **`formats.md`** — text-vs-JSON, parity, and **measured token efficiency** (JSON ≈ 2.8–3.1×
  text on tree/overview payloads). **`serialization-architecture.md`** — the implementation
  pattern (decisions resolved). **`gui-navigator-spec.md`** — the GUI navigator spec.
- **Per-type folders** (`session/ setup/ turn/ round/ part/ step/ benchmark/ benchmark-case/
  benchmark-run/ benchmark-evaluation/ errors/`) — captured `summary`+`full` payload examples
  and per-type use-case READMEs. **`_measurements/`** — raw token artifacts + test fixtures.

## What Phase 1 delivered (done)

- **Research & capture** of every object type's `summary`/`full` payloads + error/non-success
  scenarios (failed sessions, judge `json_parse_error`, incomplete evaluation, `diagnostic` part).
- **Backend render module** (`backend/src/inspect/renderInspect.ts`): one renderer, `format:
  text | json`, text derived **only** from the JSON (text ⊆ json by construction). The step
  `latest_error` now renders.
- **`format` param** through the inspect operation, `/api/lookup`, and MCP — **text by
  default**, no `structuredContent` double-encode. Rendering is a backend domain feature; the
  **CLI is a thin printer**. **Coverage test + omission allow-list** enforce json ⊆ text.
- **Benchmark `B-`/`R-`/`E-` payloads redesigned** drill-oriented (status + session lists with
  metrics; `B-` no results; `E-` lean summary + incomplete flag). Sessions/parts and `B-.N`
  kept as reference.
- **GUI:** the ID pill opens a consolidated **Inspect dialog turned navigator** — back/forward
  history, a free-text id "address bar", and **clickable ids in both JSON and text** (grammar-
  based detection; text links via the prefetched JSON's id-set). New reusable
  **`SegmentedControl.svelte`** (amber active state) added to the design system; `DialogShell`
  gained `fixedHeight`/`flush`.
- **Findings resolved:** F1, F2, F3 (text default), F4 (safe direction + coverage test), F5/F12
  (for the benchmark types), F8, F11 (E- incompleteness), F15, F16.

## Phase 2 — the starting point (what's next)

The open work is the **content critique**; `FINDINGS.md` is the tracked list. Open items:
- **F4** — decide, *per type*, whether the plumbing fields (`token_source`, `owner_step_id`,
  `parent_ref`, …) belong in the **JSON** at all (they're already omitted from text).
- **F5** — `B-` / `B-.N` are still `summary == full`; decide if they need a real split.
- **F6** — full content (tool schemas, tool results) is reachable only by *direct part* lookup;
  decide whether to surface/signal it.
- **F7** — a round full-lookup doesn't expand its own tool result.
- **F9 / F10** — a primary session exposes no top-level status/error; failure is exposed
  inconsistently across session kinds. Define one uniform "how did this end and why".
- **F13** — nothing consumes compaction/deterministic-step payloads; decide invest vs UI-only.
- **F14** — doc drift: a design doc says the judge seeds from `short=true`; shipped says
  "default, not short".
- **Per-type omission allow-list contents** (`backend/src/inspect/omissionAllowList.ts`) — review.
- The broad pass: critical eyes on **every** payload via `use-cases-by-type.md` + the captured
  examples; tighten content where it doesn't serve a use-case.

## Deferred (not blocking Phase 2)

- GUI: **JSON syntax highlighting** in the dialog; navigator **id autocomplete** (top-level
  entities + in-payload children) and an optional **backend id-offset sidecar** for exact text
  links; a pill action to **open the element's GUI view**.
- **Ops:** live end-to-end verification needs the `:3030` backend **rebuilt/restarted** — it
  still runs the pre-Phase-1 build, so its `inspect` ignores `format=text` and serves the old
  benchmark payloads.
