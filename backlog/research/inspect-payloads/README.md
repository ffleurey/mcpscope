# Inspect payload tuning — investigation workspace

> Backlog task: [`tuning-of-inspect-payload.md`](../../tuning-of-inspect-payload.md)

`inspect` is the single most important read surface in mcpscope. The same operation
([`backend/src/operations/inspect.ts`](../../../backend/src/operations/inspect.ts))
backs the CLI (`mcpscope inspect`), the MCP tool (`mcpscope_inspect`), and the UI id-pill,
so **the quality of these payloads is the quality of the product** for any agent or
developer working through the trace. This folder is the systematic baseline we will
review before deciding on any changes: for every inspectable object type we capture the
actual `summary` and `full` payloads and define the use-cases each granularity serves.

This is a documentation / analysis pass. **No code has been changed.** The goal is to
make the current behaviour legible so we can decide what to tune.

> **Two cross-cutting research notes** live alongside the per-type folders:
> - [`formats.md`](formats.md) — text vs JSON, content parity, and **measured token
>   efficiency** (JSON costs **2.8–3.1×** the tokens of text for tree/overview payloads).
> - [`use-cases.md`](use-cases.md) — the workflow-level investigation goals (analyse a
>   session, write/compare run reports, document a case…) mapped to **fetch paths** under
>   the "gradual exploration" principle. Raw measurement artifacts: [`_measurements/`](_measurements/).
> - [`use-cases-by-type.md`](use-cases-by-type.md) — the **micro** use-case catalogue:
>   per type, who asks what, with the key ones to optimize for flagged.
> - [`serialization-architecture.md`](serialization-architecture.md) — the implementation
>   pattern (per-type serializer + single text renderer derived from the JSON payload) that
>   makes text/JSON equivalent **by construction**.
> - [`FINDINGS.md`](FINDINGS.md) — the consolidated, triageable findings register (F1–F16).

## How this folder is organised

One folder per inspectable object type. Each folder has:

- a **`README.md`** — what the object is, the use-cases for inspecting it, and
  summary-vs-full guidance, grounded in the project docs and source (file:line cited);
- one or more **`example-*.md`** files — the real captured payloads, in both modes, as
  readable text.

| Folder | ID form | Object |
|---|---|---|
| [`session/`](session/) | `SSS` | a full runtime trace (one conversation / analysis run) |
| [`setup/`](setup/) | `SSS.S` | session prelude (system prompt, mcp instructions, tool defs) |
| [`turn/`](turn/) | `SSS.NT` | one user-request → response lifecycle |
| [`round/`](round/) | `SSS.W.NT.N` | one model/tool iteration inside a turn |
| [`part/`](part/) | `SSS.W.NT.N.N-X` | one content node (prompt, reasoning, tool call, answer, …) |
| [`step/`](step/) | `SSS.NW` / `SSS.CN` | a deterministic step (shipped case: compaction) |
| [`benchmark/`](benchmark/) | `B-XXXX` | a benchmark suite blueprint |
| [`benchmark-case/`](benchmark-case/) | `B-XXXX.N` | one case (prompt + tool checks + rubric) |
| [`benchmark-run/`](benchmark-run/) | `R-XXXX` | one immutable run of a suite |
| [`benchmark-evaluation/`](benchmark-evaluation/) | `E-XXXX` | one LLM-judge scoring pass over a run |
| [`errors/`](errors/) | (cross-cutting) | failed sessions, judge errors, incomplete evaluations — the non-success scenarios |

## How the examples were captured

All payloads were captured from the **live test instance** (`http://localhost:3030`)
on 2026-06-27, while benchmark run `R-RZNP` (benchmark `B-GUDP`, "HA History V3",
Gemma 4 12B QAT on the `ha-replay` MCP profile) was running. The canonical runtime
example is session **`9LJM`** — `01 outdoor-winter-coldest-and-freezing (rep 1)`, a
clean single-turn, three-round, one-compaction trace that exercises every runtime part
subtype.

Payloads were rendered with the CLI text renderer (`node cli/dist/index.js inspect`)
for readability, exactly as the task asked. **This text view is CLI-only** — see the
cross-cutting findings below.

---

## Cross-cutting findings (read this first)

These surfaced while capturing the baseline and matter more than any single payload.
They are the candidate agenda for the tuning work. **The consolidated, triageable register
(IDs F1–F15, with severity + proposed direction) lives in [`FINDINGS.md`](FINDINGS.md)** —
the narrative below explains them; FINDINGS.md is what we work from in the decision phase.
The per-type micro use-cases that justify them are in [`use-cases-by-type.md`](use-cases-by-type.md).

### 1. The MCP tool returns raw JSON, not the readable text view

The MCP server returns `JSON.stringify(result, null, 2)` for every inspect call
([`backend/src/mcp/server.ts:47-50`](../../../backend/src/mcp/server.ts)). The nice
indented text in these examples exists **only in the CLI**
([`cli/src/commands/inspect.ts`](../../../cli/src/commands/inspect.ts)). So the agents
that dog-food inspect most heavily — the analysis workflow and the benchmark judge —
consume the *JSON* shape, while the human-readable rendering we are tuning here is never
seen by them. Any "tune the payload" decision must be explicit about *which* surface
(JSON structure vs CLI text) it targets; today they diverge.

Two follow-ons, fully worked in [`formats.md`](formats.md): (a) **measured**, JSON costs
**2.79–3.10×** the tokens of text for tree/overview payloads (session, turn) and ~1.0× for
leaf content — so the navigation reads agents repeat most are also the most over-priced;
and (b) MCP encodes each payload **twice** (`content` JSON string *plus* `structuredContent`
object, [`server.ts:46-54`](../../../backend/src/mcp/server.ts)) — a client reading both
pays double. Today's CLI text is also a *lossy* projection of the JSON (drops
`token_source`, `parent_ref`, `owner_step_id`, …), so "text vs JSON" is not yet a
content-identical choice — a prerequisite to fix per the user's constraint.

### 2. The CLI text renderer only covers runtime types — benchmark types dump JSON

`runInspect` only has text renderers for `session/turn/step/round/setup/part`; the
`default` branch falls through to `JSON.stringify`
([`cli/src/commands/inspect.ts:235-256`](../../../cli/src/commands/inspect.ts)). So
`mcpscope inspect B-GUDP` / `R-RZNP` / `E-…` give a developer an unformatted JSON blob.
The benchmark example files in this folder show that fallback verbatim. This is a clear
gap: benchmark-family objects have **no readable rendering at all**.

### 3. "Summary vs full" is a real dial for only *some* types

Empirically, capturing both modes for every type:

| Type | `--short` (summary) vs default (full) |
|---|---|
| session, setup, turn, round, step | **differ** — summary omits part content, keeps token counts |
| **part** (all subtypes) | **identical** — a direct part lookup is hard-coded to `full` ([`hierarchicalLookup.ts:732`](../../../backend/src/runtime/hierarchicalLookup.ts)) |
| **benchmark** (`B-`) | **identical** — `resolveBenchmarkInspect` ignores mode ([`benchmarkOperations.ts:307-325`](../../../backend/src/operations/benchmarkOperations.ts)) |
| **benchmark_case** (`B-.N`) | **identical** — mode ignored |
| **benchmark_run** (`R-`) | **differ** — full adds the compute-on-read metrics report |
| **benchmark_evaluation** (`E-`) | **always returns the full scored report** — summary is *not* lighter |

So the summary/full contract is only meaningful for runtime containers and for
`benchmark_run`. For parts, the meaningful dial is instead *"appears inside a container
overview (abbreviated)"* vs *"inspected directly (full payload)"*. For `B-`/`B-.N`/`E-`
the dial does nothing today — a decision point for tuning.

### 4. Some full content is only reachable by direct part lookup

- **Tool definition schemas**: every container/overview view lists tool **names only**;
  the full JSON schemas come *only* from inspecting the `tool_definitions` part directly
  ([`hierarchicalLookup.ts:169-180`](../../../backend/src/runtime/hierarchicalLookup.ts)).
- **Tool call/result payloads**: inside a session/turn/round overview a `tool_call`
  shows `tool_arguments` capped at 80 chars/value and **no result**; the full
  untruncated `{ call, result }` comes only from inspecting the `tool_call` part directly
  ([`hierarchicalLookup.ts:182-208`](../../../backend/src/runtime/hierarchicalLookup.ts)).
- **Reasoning text** is not inlined in overviews at all — only `user_prompt` and
  `assistant_answer` content is; reasoning must be read from the part directly.

This is by design (keeps overviews lean) but is a frequent surprise: a *full*-mode
session inspect is still not "everything". The prescribed workflow is **map the tree
with a container inspect, then inspect specific part IDs for evidence**
([`inspect.ts:42-47`](../../../backend/src/operations/inspect.ts)).

### 5. Two distinct dog-fooding patterns drive the requirements

- **Pre-injected / deterministic** — the *analysis workflow* (fast/full session, fast
  tool) calls `mcpscope_inspect` itself and commits the results into context before the
  model reasons ([`shared/bootstrapStep.ts`](../../../backend/src/analysis/shared/bootstrapStep.ts),
  [`shared/toolCallAssessmentStep.ts`](../../../backend/src/analysis/shared/toolCallAssessmentStep.ts)).
- **Pull-on-demand** — the *benchmark judge* is handed only a session ID and told to
  inspect-then-drill on its own (`injectEvidence:false`), deliberately dog-fooding the
  inspect surface a human tester uses
  ([`benchmarkEvaluation/systemPrompt.ts:22`](../../../backend/src/analysis/benchmarkEvaluation/systemPrompt.ts),
  [`benchmarkEvaluation/evaluationPrompts.ts:28`](../../../backend/src/analysis/benchmarkEvaluation/evaluationPrompts.ts)).

The judge is the canonical "summary → drill" consumer and the sharpest lens for tuning:
its prompt explicitly relies on what the session-overview payload does and does not
contain. Note one doc/code drift: an older design doc
([`benchmark-llm-evaluation-v1.md`](../../completed/benchmark-llm-evaluation-v1.md))
says the judge seeds from `short=true`, but the shipped prompt says "default, not short".

### 6. Error inspection is where the payloads are weakest

Now that run `R-RZNP` has completed *with* failures (3 of 25 sessions, plus an errored
evaluation pass and two judge sessions that returned invalid JSON), the non-success
payloads — captured in [`errors/`](errors/) — expose the sharpest gaps:

- **The text renderer drops `latest_error`** — an errored step shows only `… error`, never
  the reason (`json_parse_error`, "Judge response was not valid JSON"). The single most
  important field for error inspection is invisible in text.
- **A primary session surfaces no top-level status/error** — you can't tell from the
  session header that it failed; the reason lives on a turn step and a trailing
  `diagnostic` part.
- **Failure is exposed inconsistently across session kinds** (analysis sessions carry a
  top-level `latest_error`; primary sessions don't).
- **An evaluation's score doesn't flag its own incompleteness** beyond a `judged < expected`
  count mismatch.

This also surfaced a part subtype absent from success traces — **`diagnostic` (`-DN`)**,
the canonical "why did the turn stop" carrier — now documented under [`part/`](part/).

### 7. No internal agent inspects deterministic / compaction steps

Compaction-step payloads are rich (summary = `stripped_part_ids`; full = `stripped_parts`
with per-part `type`/`tokens`/`reason`), but no system prompt drives an agent into a
`C`/`W` step. Step inspection is purely a developer/UI affordance today — an asymmetry
worth noting when we decide where to invest.

---

## Status

- [x] Folder structure + captured baseline payloads (this folder)
- [x] Use-case READMEs per type (grounded, file:line cited)
- [x] Cross-cutting findings catalogue (above)
- [x] Format & token-efficiency research ([`formats.md`](formats.md)) + workflow use-cases
      ([`use-cases.md`](use-cases.md))
- [x] `benchmark_evaluation` (`E-`) examples captured (run `R-RZNP` completed with two
      passes: complete `E-FE7K`, errored `E-2BPM`)
- [x] Error / non-success payloads captured ([`errors/`](errors/)) — failed primary
      sessions, judge `json_parse_error`, incomplete evaluation; run example refreshed to
      its completed (with-failures) state
- [ ] **Next (decision):** triage the findings above into concrete tuning changes
      (per the project's feedback-triage convention: easy fixes now, design-touching
      ones discussed first).
