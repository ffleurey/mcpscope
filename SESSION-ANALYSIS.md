# Session Analysis

This document describes the currently shipped `session_analysis` workflow.

Use it as the project-level technical source of truth for how session analysis works in mcpscope today.

For historical planning context, see the completed backlog records in `backlog/completed/`.

## Purpose

Session analysis lets mcpscope inspect one finished parent session through a child
`session_analysis` session that stays visible in the normal runtime tree.

The analysis session is not a hidden batch job and not a synthetic prompt wrapper. It is a real
session with:

- its own setup
- normal turns, rounds, and parts
- deterministic orchestration steps between turns
- inspectable evidence loaded through restricted MCP tools

The important distinction is that the workflow is deterministic where it needs to be, but that
determinism still lives inside the analysis session through normal steps, turns, parts, and
context state.

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

The analysis session itself has a normal setup containing:

- a system prompt for the analysis model
- tool definitions for the restricted analysis MCP surface

The restricted analysis MCP surface currently exposes only:

- `mcpscope_inspect`
- `mcpscope_status`

The analysis-session prelude belongs to the analysis session itself. The analyzed session's MCP
instructions and tool definitions are introduced later as inspected bootstrap evidence.

## Deterministic evidence path

Model-visible evidence must be loaded through deterministic `mcpscope_inspect` calls that are
committed into the analysis session as ordinary `tool_call` parts with embedded results.

This is the key rule that keeps the workflow inspectable. The workflow does not flatten
parent-session evidence into one large synthetic prompt. Instead:

- bootstrap inspect calls load the target session and target setup
- packet-local inspect calls load exact parent-session parts needed for one assessment
- those inspect calls remain inspectable in the analysis trace even after they are excluded from
  future model context

## Core artifacts

Bootstrap persists deterministic working state as artifacts:

- `analysis.analysis_target.v1`
- `analysis.evidence_packet_index.v1`
- `analysis.coverage_map.v1`
- `analysis.tool_call_assessment.v1`
- `analysis.turn_summary.v1`
- `analysis.final_analysis_report.v1`

These artifacts hold durable workflow state while normal turns and parts hold model-visible
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
tool-call round, because post-call reasoning often lives in the next round of the same source turn.

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

## Reference example

`V2EH` analyzing `CXQJ` is a compact reference example.

- bootstrap loads `CXQJ` and `CXQJ.S` through `V2EH.1.1.1-T` and `V2EH.1.2.1-T`
- packets for `CXQJ.1` load three-part slices such as `reasoning -> tool_call -> next-round reasoning`
- the `CXQJ.2` packet loads `CXQJ.2.1.2-R`, `CXQJ.2.1.3-T`, and `CXQJ.2.2.1-A` to judge result usage

This example shows the shipped fix for cross-round post-call reasoning and the intended packet
granularity for the analysis workflow.

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

Current status is intentionally modest: this is the minimum coherent shipped solution. The
direction is now correct, but cleanup and generalization work still remains.