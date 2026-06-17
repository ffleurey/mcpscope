# V1 analysis & benchmark plan

Direction note (not yet a coding-agent-ready spec) capturing the V1 analysis/benchmark
plan and the rationale behind it. Supersedes the framing in
`backlog/what-should-v1-look-like.md` (section "Session Analysis") which proposed
"two analysis strategies (deterministic + autonomous)".

Related prior candidates (cross-reference, do not duplicate):
`benchmark-automation.md`, `session-batch-runs.md`, `session-analysis-agent.md`,
`session-analysis-hybrid-workflow-v1.md`.

## Framing

The analysis **framework** (visitor + `WorkflowStep` + artifacts + bounded turns) is a
good foundation for the future UC3 case where developers build their own analysis
agents. For V1 it is already developed beyond what V1 needs — that is fine, we keep it.
We do **not** remove framework capability. We just stop adding analysis-strategy depth
and instead invest in repeatability/benchmarking, which is where the UC2 value is.

The primary V1 value is for the **MCP server tester / coding agent**: once a test set is
defined, mcpscope owns session/run creation so the tester focuses on their MCP server and
gets repeated runs as feedback — both on overall quality and specifically on which tools
cause issues (descriptions, parameters, performance, token efficiency). Testers should not
have to script session/run creation themselves.

## The three V1 features

### 1. Consolidate a guided analysis strategy (for small/lazy models)
Refine the existing deterministic workflow into one good "guided" strategy. Its whole point
is to compensate for small models' tendency to be lazy and not look at the facts: it injects
the exact content to analyze and walks the model through it. Absorb `fastSession` into this
as a prompt/verbosity variant rather than a separate class. Built on the workflow framework.

### 2. New "skill" analysis (for capable models)
A lighter analysis guided by a prompt + instructions, like a skill rather than a fully
controlled workflow. A capable model should decide what to inspect on its own via the
`mcpscope_inspect` tools (which already exist) instead of being forced through every tool
call. Implementation is small: a bounded agentic turn with instructions + inspect-tool
access and a higher tool-round budget, **without** the deterministic evidence injection.
Rides the same `WorkflowStep`/artifact substrate, so the framework is reused, not bypassed.

### 3. Benchmark concept (V1, simple)
Let a tester define a benchmark once and re-run it. The heaviest item; build on the existing
`benchmark` container type already in the data model (not greenfield):
- **Define** a named benchmark = a set of prompts (+ optional loose expectations) + a
  model/MCP profile selection.
- **Run** = N repetitions and/or a prompt sequence, orchestrated by the existing sequential
  scheduler, producing one session per run grouped under the benchmark container. Exposed via
  UI + CLI + MCP so a coding agent can trigger it.
- **Aggregate** = a report. This is where the tool-level feedback lives: per-tool called/not,
  error rate, token cost, latency, across runs. This is the reborn *intent* of the broken
  `fastTool` strategy — as cross-run aggregation, not a forced per-tool-call workflow.

## Design cautions

- **Decouple run from analyze.** Repeated runs + raw per-tool/token stats are valuable with
  zero LLM analysis. Make LLM analysis an optional layer so the benchmark is useful
  immediately and is not gated on analysis quality.
- **Keep expectations loose for V1.** With non-deterministic LLMs avoid a rich assertion DSL.
  Use observable, forgiving checks: expected tools called, answer contains/matches a criterion,
  no tool errors, under a token budget.
- **Tool-level feedback is an aggregation concern**, not a per-session strategy. Delete the
  broken `fastTool` per-group strategy; move its goal into benchmark aggregation.

## Sequencing (cheapest-value-first)

1. Skill analysis mode (small; reuses inspect tools + bounded turn).
2. Guided strategy consolidation (refinement of existing code).
3. Benchmark v1: define -> run (repeat/sequence) -> aggregate tool/token stats, analysis optional.

If time slips, **protect the benchmark's deterministic run + tool/token aggregation** (the
UC2 must-have). The guided consolidation is the most droppable, since the skill mode alone
could cover analysis for V1.

## Relation to review findings (2026-06-17 foundation review)

- `fastSession` is structurally identical to `fullSession` -> merge into the guided strategy.
- `fastTool` only ever assesses `tool_groups[0]` (silently drops the rest) -> delete as a
  strategy; its goal becomes benchmark aggregation.
- The visitor base advertises ~21 hooks but only 4 are ever overridden, and several
  `AnalysisTarget` fields are computed-but-unread. These are real over-development, but per
  this plan we keep the framework and do not prune it in V1 — revisit when UC3 is specified.
- See also `refactor-decompose-tool-enabled-turn.md` and `fixme/analysis-dead-cursor-step-key.md`.
