# mcpscope manual

This document is the usage-oriented companion to the technical reference docs.

Use it to understand what mcpscope is for, how to think about its session model, and how the
main workflows are meant to be used.

For the technical contract, use:

- `ARCHITECTURE.md`
- `DATA-MODEL.md`
- `DATABASE-SCHEMA.md`
- `SESSION-ANALYSIS.md`

## What mcpscope is for

mcpscope is a local-first runtime analysis and debugging tool for MCP-backed LLM workflows.

Its job is not just to get answers from a model. Its job is to make the run inspectable:

- what setup the model saw
- what tool it chose
- what payload it sent
- what result came back
- what stayed in later context
- where the context budget went

## Core mental model

All mcpscope sessions are conceptually LLM sessions.

Some session types are mostly open-ended and user-driven. Others are steered more tightly with
deterministic steps and context policy.

The important distinction is:

- determinism does not require moving the workflow outside the session model
- a deterministic workflow can still run as a normal visible session with setup, turns, rounds,
  parts, and inspectable context changes
- `session_analysis` is the shipped example of that model

This is an implementation choice. mcpscope does not need to become less deterministic just because
it is centered on LLM sessions.

## Main workflows

### 1. Run a normal session

The basic workflow is:

1. create a session from configured defaults
2. wait until it is ready
3. send one prompt
4. inspect the resulting turn, rounds, and parts

For the released Docker path, use `TUTORIAL.md`.

### 2. Inspect a run

mcpscope is designed so that the same run can be inspected from several angles:

- session root for structure
- setup for prelude state
- turn and round boundaries for execution flow
- individual parts for exact evidence such as prompts, reasoning, tool calls, and answers

The practical rule is simple: inspect broad objects to map IDs, then inspect exact parts to read
real evidence.

### 3. Analyze a session

Session analysis creates a child `session_analysis` session under a finished parent session.

That child session stays inspectable like any other session, but deterministic orchestration steers
the analysis workflow:

- bootstrap loads initial parent-session evidence
- one bounded assessment turn judges each tool-call packet
- packet-local evidence is removed from active context after use
- turn summaries and a final report are synthesized from accepted earlier outputs

Use `SESSION-ANALYSIS.md` for the technical contract.

## Session-analysis walkthrough

`V2EH` analyzing `CXQJ` is a good reference example.

### Bootstrap

`V2EH.S` is the analysis-session prelude.

`V2EH.1` is the bootstrap evidence-loading turn:

- `V2EH.1.1.1-T` inspects `CXQJ`
- `V2EH.1.2.1-T` inspects `CXQJ.S`

This is the first key distinction to keep in mind:

- `V2EH.S` belongs to the analysis session itself
- the analyzed session's own MCP instructions and tool definitions appear later as inspected
  evidence inside the bootstrap turn

### Packet slices

For `CXQJ.1`, the analysis session loads one packet per tool call.

Examples:

- `V2EH.2` loads `CXQJ.1.1.2-R`, `CXQJ.1.1.3-T`, `CXQJ.1.2.1-R`
- `V2EH.4` loads `CXQJ.1.2.1-R`, `CXQJ.1.2.2-T`, `CXQJ.1.3.1-R`
- `V2EH.6` loads `CXQJ.1.3.1-R`, `CXQJ.1.3.2-T`, `CXQJ.1.4.1-R`
- `V2EH.8` loads `CXQJ.1.4.1-R`, `CXQJ.1.4.2-T`, `CXQJ.1.5.1-R`

This example matters because it shows the shipped fix for cross-round post-call reasoning. The
post-call reasoning can live in the next source round and still be included in the packet slice.

For `CXQJ.2`, `V2EH.11` loads:

- `CXQJ.2.1.2-R`
- `CXQJ.2.1.3-T`
- `CXQJ.2.2.1-A`

That packet is enough to judge whether the successful stats query was actually used in the
follow-up answer.

### Final outcome

The resulting grounded diagnosis is that the user request was answered, but the path was
inefficient because `ha_history_get_sensor_stats` behaved inconsistently around `aggregation`
versus `aggregations` and forced repeated attempts.

## Practical checklist

When validating a live analysis session, check these points first:

1. the analysis session has its own prelude with only `mcpscope_inspect` and `mcpscope_status`
2. bootstrap loads the target session and target setup through deterministic inspect turns
3. packet-local inspect turns load exact parent-session IDs rather than a synthetic evidence prompt
4. post-call reasoning is present when it exists in the next source round
5. packet-local inspect evidence becomes excluded after the corresponding assessment
6. assessment prompts are short and referential rather than restating all evidence
7. turn summaries and the final report are grounded in accepted earlier outputs

## Use-case docs

Use-case and user-flow material lives in these docs:

- `TUTORIAL.md` — packaged Docker workflow and quick start
- `USECASE-home-assistant-statistics.md` — first concrete reference scenario and evaluation target
- `FRONTEND-TEST.md` — optional manual UI checks

These documents are intentionally different from the technical reference docs. They explain goals,
usage, and representative workflows rather than defining the canonical runtime contract.