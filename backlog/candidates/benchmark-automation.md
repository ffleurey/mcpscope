# Benchmark automation

This task builds on session-level analysis to let mcpscope run and evaluate benchmark suites more autonomously.

## Problem

Once users have:

- repeated runs of the same prompt
- prompt sets
- experiment grouping
- and a session analysis agent

the next bottleneck is turning many runs into a usable benchmark result.

Today, that still requires a lot of manual work:

- run or script multiple sessions
- inspect each session individually
- summarize what repeated runs mean
- decide whether changes improved or regressed the MCP server

That makes benchmarks expensive to run and hard to compare over time.

## Goal

Add a first-class **benchmark automation** workflow that can:

1. define benchmark cases with expectations
2. run sessions across those cases, typically through session batches / experiments
3. run the session analysis agent on each finished run
4. produce benchmark-level findings and summaries across multiple sessions

## Relationship to other tasks

This task should build on:

- `backlog/specification/session-types-and-parent-links.md`
- `backlog/specification/session-analysis-agent.md`
- `backlog/candidates/session-batch-runs.md`
- the completed `backlog/completed/mcpscope-mcp-interface.md` work

The intended layering is:

1. session-level analysis
2. grouped repeated runs / prompt sets
3. benchmark-level synthesis and reporting

That means benchmark automation should build on:

- the generalized typed parent-linked session model from `session-types-and-parent-links.md`
- the specialized analysis-session machinery from `session-analysis-agent.md`

It should not invent a separate generic agent subsystem.

It should also inherit the same principle for tool access:

- use mcpscope's MCP interface where it helps
- but keep internal analysis/synthesis tool surfaces narrow and purpose-built

## Core idea

A benchmark case should define something like:

- prompt
- expected result
- expected tools or tool sequence
- optional notes about what matters most

mcpscope should then:

- create and run the corresponding sessions
- analyze each finished session
- aggregate those per-session analyses into a benchmark report

That report may also include a higher-level synthesis step that looks across multiple runs.

That synthesis step will likely also need a dedicated internal session type, separate from both:

- normal user sessions
- per-session analysis sessions

Likely relationship:

- benchmark run sessions may optionally have a benchmark/experiment parent
- benchmark synthesis sessions should have a mandatory benchmark/experiment parent

## Important scope boundary

This task is about **automation and reporting** on top of existing runs and analysis.

It does not require solving every benchmark problem at once.

The first version does not need:

- a perfect universal scoring system
- statistical benchmarking UI
- multi-model comparison across arbitrary dimensions
- a complex judge ensemble

The first version should focus on useful, explainable automation.

## Desired behavior

### 1. Benchmark cases are explicit

Each benchmark case should define expectations, not just a prompt.

Likely fields:

- prompt
- expected result
- expected tools or acceptable tool set
- optional notes

This is important because benchmark usefulness depends on knowing what "good" means.

### 2. Multiple runs can be analyzed consistently

For repeated runs or prompt suites, mcpscope should:

- run the same analysis method on each session
- keep the results structured and comparable
- preserve enough per-run detail to drill into failures

### 3. Benchmark-level synthesis

After analyzing individual sessions, mcpscope should be able to produce a higher-level report.

Examples:

- which benchmark cases consistently pass
- which cases are unstable across repeated runs
- which tools are repeatedly misused
- which regressions appeared after a server change
- which schema/description changes appear most needed

This may require a second agent step that synthesizes multiple per-session reports.

If so, that synthesis should also run as a clearly identified internal workflow with:

- its own configuration
- its own session type
- explicit links to the experiment and analyzed sessions

### 4. Reports stay inspectable

Automation should not hide the underlying evidence.

The benchmark workflow should preserve the ability to:

- inspect the benchmark
- inspect each case
- inspect each generated session
- inspect each session analysis report

The synthesis layer should summarize, not replace, the inspectable evidence.

## Open design questions

### 1. Benchmark definition format

What is the best shape for benchmark cases and suites?

Possible levels:

- one benchmark case
- one benchmark suite containing many cases
- one experiment instance containing many generated sessions

This task should define a shape that works with the experiment/session grouping model from `session-batch-runs`.

### 2. Scoring

Should benchmark automation produce:

- pass/fail only
- scalar scores
- categorized outcomes
- confidence levels

The first version should not over-promise precision if the judgment is still partially model-based.

### 3. Synthesis agent

Should the benchmark-level summary:

- be a deterministic aggregation of per-session results
- or also include an LLM synthesis step

A likely direction is:

- structured per-session analysis first
- optional synthesis agent second

This preserves inspectability and reduces the risk of opaque benchmark conclusions.

### 4. Objectivity and reproducibility

This task must explicitly address the risk that benchmark evaluation becomes too subjective.

Possible mitigations:

- strict structured inputs
- strict structured outputs
- evidence-oriented prompts
- preserving all per-session analysis results
- keeping the synthesis step separate from the raw per-session judgments

### 5. Internal session visibility

Because benchmark automation may create:

- many normal benchmark sessions
- many per-session analysis runs
- and possibly synthesis runs

the product needs a clear visibility model.

The likely rule is:

- normal session lists show primary sessions
- internal analysis/synthesis sessions are hidden by default
- dedicated development-oriented views can reveal them for debugging

## Scope

### Backend

- define benchmark case and benchmark suite models
- connect benchmark execution to session-batch-runs / experiment grouping
- run per-session analysis automatically
- add benchmark-level aggregation and possibly synthesis
- store enough structure to inspect results later
- define how primary benchmark run sessions and benchmark-analysis sessions attach to benchmark/experiment parents
- preserve explicit links between:
  - experiment
  - normal run sessions
  - analysis sessions
  - synthesis sessions

### CLI

- likely support benchmark creation / execution / inspection commands in later increments
- should surface compact benchmark summaries and drill-down paths

### UI

- should allow viewing benchmark summaries and drilling into underlying sessions
- no need for a large dashboard in the first version
- should keep internal agent-run sessions out of the ordinary session list by default
- should still make those internal sessions inspectable in a dedicated development/debug view

## Important design notes

- benchmark automation should build on the session analysis agent, not bypass it
- the system should prefer explainable benchmark outputs over opaque single-number scoring
- repeated runs are especially important because MCP behavior is often not fully deterministic
- benchmark-level automation should help developers see patterns, not just produce a leaderboard
- the product should remain local-first and trace-first
- benchmark automation should reuse a narrow product-specific internal agent workflow, not introduce a full generic agent framework
- benchmark automation should build on focused mcpscope MCP tool subsets, not hand broad operational capabilities to every internal agent step

## Expected result

After this task:

- users can define benchmark cases with expectations
- mcpscope can run those cases through grouped session runs
- mcpscope can analyze each run automatically
- mcpscope can produce a benchmark-level report that summarizes outcomes, instability, and recurring tool-use issues
- developers can use mcpscope not only to inspect single runs, but to evaluate MCP changes across a benchmark suite
