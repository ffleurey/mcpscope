# Session Analysis

This document describes the currently shipped `session_analysis` workflow.

Use it as the project-level source of truth for how session analysis works in mcpscope today.

For historical planning context, see the completed backlog records in `backlog/completed/`.

## Purpose

Session analysis lets mcpscope inspect one finished parent session through a child
`session_analysis` session that stays visible in the normal runtime tree.

The analysis session is not a hidden batch job and not a synthetic prompt wrapper.
It is a real session with:

- its own setup
- normal turns, rounds, and parts
- deterministic orchestration steps between turns
- inspectable evidence loaded through restricted MCP tools

This distinction matters:

- the workflow is deterministic where it needs to be
- but the determinism lives inside the analysis session through normal steps, turns, parts, and
  context state
- the implementation should not drift back toward a half-in, half-out design where important
  workflow state or model-visible evidence is carried outside the session model

## Current workflow

The shipped workflow is backend-owned and tool-call-centric.

At a high level:

1. launch a `session_analysis` child session for a finished parent session and target turn
2. initialize a normal analysis-session prelude bound to the restricted `/mcp/analysis` MCP surface
3. run bootstrap orchestration to validate the target, build evidence packets, and persist analysis artifacts
4. load parent-session evidence through deterministic `mcpscope_inspect` calls committed as normal tool interactions
5. run one bounded assessment turn per tool-call packet
6. mutate context after each packet so packet-local evidence does not accumulate in active context
7. synthesize one turn summary per analyzed turn
8. produce a final analysis report over the accepted packet assessments and turn summaries

## Analysis-session prelude

The analysis session itself has a normal setup.

Its setup contains:

- a system prompt for the analysis model
- tool definitions for the restricted analysis MCP surface

The restricted analysis MCP surface currently exposes only:

- `mcpscope_inspect`
- `mcpscope_status`

Important distinction:

- the analysis-session prelude belongs to the analysis session itself
- the analyzed session's MCP instructions and tool definitions do not live in the analysis-session prelude
- those analyzed-session setup parts are introduced later as inspected evidence during bootstrap

## Deterministic evidence path

Model-visible evidence must be loaded through deterministic `mcpscope_inspect` calls that are
committed into the analysis session as ordinary `tool_call` parts with embedded results.

This is the key rule that keeps the workflow inspectable.

The workflow does not use synthetic prompt bundles to flatten parent-session evidence into one
large user message.

Instead:

- bootstrap inspect calls load the target session and target setup
- packet-local inspect calls load exact parent-session parts needed for one assessment
- those inspect calls remain inspectable in the analysis trace even after they are excluded from
  future model context

## Core artifacts

Bootstrap persists the deterministic working state as artifacts.

Current key artifacts are:

- `analysis.analysis_target.v1`
- `analysis.evidence_packet_index.v1`
- `analysis.coverage_map.v1`
- `analysis.tool_call_assessment.v1`
- `analysis.turn_summary.v1`
- `analysis.final_analysis_report.v1`

These artifacts hold durable workflow state while normal turns and parts hold the model-visible
conversation and evidence.

## Packet model

The analysis unit is one tool-call packet.

For each packet, the workflow loads the exact parent-session evidence slice needed to judge that
tool interaction. Depending on what exists in the parent session, that slice can include:

- reasoning before the tool call
- the tool-call part itself, including the embedded tool result when tool results are stored that way
- reasoning after the tool result
- the downstream final answer when result usage needs to be judged directly

The current runtime resolves surrounding reasoning at turn scope rather than only within the
tool-call round. This matters because post-call reasoning often lives in the next round of the
same source turn.

## Context policy

The context policy is intentionally narrow.

- bootstrap evidence may stay included while packet assessment begins
- packet-local inspect evidence is included only for the corresponding assessment slice
- after the packet assessment is accepted, deterministic context mutation excludes that packet-local
  evidence from active context
- assessment prompts become `historical_only`
- analysis reasoning parts are excluded and then stripped by normal compaction
- accepted assessment answers, turn summaries, and the final report remain durable visible outputs

This keeps the trace inspectable without letting packet-local evidence snowball across the whole
analysis session.

## Example: V2EH analyzing CXQJ

`V2EH` is a good concrete reference session.

The source session is `CXQJ`.

### Bootstrap

`V2EH.S` is the analysis-session prelude.

The first deterministic evidence-loading turn is `V2EH.1`:

- `V2EH.1.1.1-T` inspects `CXQJ`
- `V2EH.1.2.1-T` inspects `CXQJ.S`

This means the analyzed session's own setup enters the analysis session as inspected evidence,
not as part of `V2EH.S`.

### Packet assessments for `CXQJ.1`

`V2EH` assesses four packets for `CXQJ.1`.

Packet 1 uses `V2EH.2` and loads:

- `CXQJ.1.1.2-R`
- `CXQJ.1.1.3-T`
- `CXQJ.1.2.1-R`

Packet 2 uses `V2EH.4` and loads:

- `CXQJ.1.2.1-R`
- `CXQJ.1.2.2-T`
- `CXQJ.1.3.1-R`

Packet 3 uses `V2EH.6` and loads:

- `CXQJ.1.3.1-R`
- `CXQJ.1.3.2-T`
- `CXQJ.1.4.1-R`

Packet 4 uses `V2EH.8` and loads:

- `CXQJ.1.4.1-R`
- `CXQJ.1.4.2-T`
- `CXQJ.1.5.1-R`

This example is important because it shows the shipped fix for cross-round post-call reasoning.
Packets 1 through 4 all include the reasoning that lives in the next source round.

### Packet assessment for `CXQJ.2`

`V2EH.11` assesses the one tool-call packet in `CXQJ.2` and loads:

- `CXQJ.2.1.2-R`
- `CXQJ.2.1.3-T`
- `CXQJ.2.2.1-A`

That packet directly supports judging whether the successful stats query was used correctly in the
follow-up answer.

### Summaries and final report

After the packet assessments:

- `V2EH.10` summarizes turn `CXQJ.1`
- `V2EH.13` summarizes turn `CXQJ.2`
- `V2EH.14` produces the final analysis report

In this example, the grounded diagnosis is that the user request was answered, but the path was
inefficient because `ha_history_get_sensor_stats` behaved inconsistently around `aggregation`
versus `aggregations` and forced repeated attempts.

## Manual inspection checklist

When validating a live analysis session, check these points first:

1. the analysis session has its own prelude with only `mcpscope_inspect` and `mcpscope_status`
2. bootstrap loads the target session and target setup through deterministic inspect turns
3. packet-local inspect turns load exact parent-session IDs rather than a synthetic evidence prompt
4. post-call reasoning is present when it exists in the next source round
5. packet-local inspect evidence becomes excluded after the corresponding assessment
6. assessment prompts are short and referential rather than restating all evidence
7. turn summaries and the final report are grounded in accepted earlier outputs

## Validation

The main focused regression for the recovered workflow is:

```bash
npx vitest run backend/src/app.test.ts -t "v2 full flow with tool calls: produces assessment, turn_summary, and final_report artifacts via deterministic inspect turns" --reporter=dot
```

Backend type safety remains the other required post-edit check:

```bash
npm run check:backend
```

## Boundary

This document describes the shipped session-analysis workflow.

It does not freeze every future analysis product decision. Broader benchmark automation,
resumable frontiers across later parent-session growth, richer viewers, and other higher-level
analysis product work remain backlog topics.

Current status is intentionally modest: this is the minimum coherent shipped solution, not the end
state. The direction is now correct, but some cleanup and generalization work still remains.