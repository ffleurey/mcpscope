# Benchmark reference

mcpscope benchmarks let an MCP-server tester define a reusable test suite of prompts and
re-run it, getting repeated-run feedback — overall quality and, specifically, which tools
cause issues (coverage, errors, token efficiency). mcpscope owns session/run creation; you
do not script it.

This is the **Phase A** surface (run + deterministic metrics, no LLM evaluation). See
[backlog/specification/benchmark-v1.md](backlog/specification/benchmark-v1.md) for the full
plan and [backlog/research/benchmark-success-criteria.md](backlog/research/benchmark-success-criteria.md)
for the evaluation-design research.

## Vocabulary

- **Benchmark** — a static suite (a named set of cases). Persisted, first-class.
- **Case** — one prompt (+ optional tool-behavior expectations) in a suite.
- **Run** — one execution of a benchmark: picks a model, MCP server(s), which cases, and how
  many repetitions of each. Produces one **session** per case × repetition and a report.
- **Session** — one repetition of one case (a normal mcpscope primary session, individually
  inspectable, parented to the run).
- **Check** — an optional deterministic per-session success rule. Cases without checks still
  produce full metrics.

Individual sessions outside a benchmark are unchanged — benchmarks are purely additive.

## IDs

IDs are type-tagged so the kind is always tellable, consistent with the session
hierarchical-ID scheme (a bare 4-char code is a session):

- **Benchmark**: `B-7K3M` (`B-` prefix + 4-char code).
- **Case**: `B-7K3M.3` (case 3 of that benchmark — a dotted child).
- **Run**: `R-9QX4` (`R-` prefix + 4-char code) — **flat / first-class**, not nested under
  the benchmark.

A run is **inspectable like a session** (its report + child sessions) and shows up in the
left-pane tree as a container of its sessions.

## Data model

- **Benchmark** (editable blueprint): `id, name, description, createdAt, updatedAt`.
- **Case**: `id, benchmarkId, name, prompt, orderIndex, expectedToolsCalled[],
  expectedToolsNotCalled[], sourceSessionId, createdAt, updatedAt`.
  - `name` is an optional human label (falls back to the prompt for display).
  - `sourceSessionId` records the session a case was extracted from, if any.
- **Run** (immutable snapshot spawned from a benchmark): `id, benchmarkId, benchmarkName,
  status, modelConfigId, mcpProfileIds[], cases[{sourceCaseId, name, prompt,
  expectedToolsCalled[], expectedToolsNotCalled[]}], repetitions, sessions[{sessionId,
  sourceCaseId, repetition}], error, createdAt, updatedAt, startedAt, completedAt`.

A benchmark is an **editable blueprint**; a run is a **first-class, independent snapshot** of
the cases + settings it ran (an *association*, not composition). At launch the run resolves
and records the effective model/MCP and snapshots the selected cases, so **editing or deleting
the benchmark or its cases never alters a past run or its report**. Model and MCP selection
are run-level (the point is to run the same cases against different model/MCP combinations);
cases hold only the prompt + expectations.

### Lifecycles
- Deleting a **benchmark** cascades to its **cases** but leaves its **runs** intact.
- Deleting a **run** removes its produced sessions.
- Deleting a **case** removes it from the blueprint; past runs keep their snapshot.

## Authoring cases

Two ways to create a case:

1. **From a session (recommended)** — extract the session's first user message into a case,
   pre-filling `expectedToolsCalled` with the tools that session actually called (an editable
   default). This turns observed behavior into a checkable expectation cheaply.
2. **Manually** — provide a prompt (and optionally expected/forbidden tools) directly.

## HTTP API

Benchmark routes use **camelCase** JSON (consistent with the session/trace HTTP API the
frontend consumes — distinct from the snake_case operation catalog used by the five core
CLI/MCP commands). Not part of the MCP operation catalog.

| Method | Path | Body | Result |
|---|---|---|---|
| `GET` | `/api/benchmarks` | — | `{ benchmarks: [{...benchmark, caseCount, runCount}] }` |
| `POST` | `/api/benchmarks` | `{ name, description? }` | `{ benchmark }` |
| `GET` | `/api/benchmarks/:id` | — | `{ benchmark, cases[], runs[] }` |
| `PATCH` | `/api/benchmarks/:id` | `{ name?, description? }` | `{ benchmark }` |
| `DELETE` | `/api/benchmarks/:id` | — | `204` (cascades to cases; runs are kept) |
| `POST` | `/api/benchmarks/:id/cases` | `{ prompt, name?, expectedToolsCalled?, expectedToolsNotCalled? }` | `201 { case }` |
| `POST` | `/api/benchmarks/:id/cases/from-session` | `{ sessionId, name? }` | `201 { case }` |
| `PATCH` | `/api/benchmark-cases/:caseId` | `{ name?, prompt?, orderIndex?, expectedToolsCalled?, expectedToolsNotCalled? }` | `{ case }` |
| `DELETE` | `/api/benchmark-cases/:caseId` | — | `204` |
| `POST` | `/api/benchmarks/:id/runs` | `{ caseIds?, repetitions?, modelConfigId?, mcpProfileIds? }` | `202 { run }` |
| `GET` | `/api/benchmark-runs/:runId` | — | `{ run, report }` |
| `DELETE` | `/api/benchmark-runs/:runId` | — | `204` (also deletes the run's sessions) |

A run launch returns immediately (`202`); a background coordinator drives the sessions
sequentially through the scheduler. Poll `GET /api/benchmark-runs/:runId` for `run.status`
(`pending` → `running` → `complete`/`error`) and the computed report.

## CLI

```
mcpscope benchmark create <name> [--description <text>]
mcpscope benchmark list
mcpscope benchmark show <benchmarkId>
mcpscope benchmark add-case <benchmarkId> <prompt> [--name <text>] [--expect-tool <name>]... [--forbid-tool <name>]...
mcpscope benchmark from-session <benchmarkId> <sessionId> [--name <text>]
mcpscope benchmark run <benchmarkId> [--repetitions <n>] [--model-config <id>] [--mcp-profile <id>]... [--case <id>]... [--wait]
mcpscope benchmark report <runId>
```

All support `--json` and `--url`. `run --wait` polls until the run finishes and prints the
report.

## Report and metrics

The report is computed on read from the produced sessions (nothing is cached). It leads with
a **per-tool rollup** — the "which tools cause issues" scorecard — then per-case detail.

- **Per tool (rollup):** calls, errors, error rate, result-payload size, how many cases used it.
- **Per case:** completed count; tool-call and total-token distributions (min/median/mean/
  max/stddev — token *variation* across repetitions is itself a signal); per-tool counts; and,
  when the case defines checks, success rate plus **pass@k** (any repetition passed) and
  **pass^k** (all repetitions passed — reliability). The gap between pass@k and pass^k is the
  key non-determinism signal.

### Success checks (optional, deterministic)

A case may define tool-behavior checks: `expectedToolsCalled` (each called ≥ once) and
`expectedToolsNotCalled` (never called). A repetition passes when those hold **and** no tool
errored **and** the session completed. Cases with no checks report metrics only (no verdict).
Answer/qualitative correctness is deliberately **not** checked here — that is deferred to a
future separate-model LLM evaluation (never self-judging). See the research note.

## Known limitations (Phase A)

- Runs are sequential (one scheduler queue); no concurrency.
- A server restart mid-run leaves the run `running` (the in-memory queue is cleared; no resume yet).
- No LLM-judged success and no answer-text checks yet (deferred).
