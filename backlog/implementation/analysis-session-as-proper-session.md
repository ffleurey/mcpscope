# Analysis session as a proper session

## Goal

Recover the analysis workflow so that a `session_analysis` run behaves like a normal
session whose turns, rounds, parts, context assembly, and streaming semantics follow the
same runtime model as a primary session.

The orchestration layer remains deterministic, but it must sit between normal turns rather
than replacing them with synthetic prompt construction.

## Source of truth for this recovery

This file is the only task description that should be used for the recovery.

Ignore older analysis-agent specifications, backlog notes, roadmap text, or earlier design
documents if they conflict with the rules below.

## Core architectural rules

### 1. An analysis session is a normal session

An analysis session is a first-class session.

The only difference from a primary session is that deterministic orchestration steps drive
what happens between turns instead of a human user doing so manually.

The session machinery itself must remain normal:

- prelude initialization
- MCP binding
- tool definitions in session context
- full turn execution
- tool rounds inside turns
- normal persisted parts
- normal streaming events
- normal context assembly from persisted parts

### 2. Deterministic steps have a narrow role

A deterministic step may do arbitrary internal logic and may write step-local outputs for
inspection, but that internal work must not become the mechanism for model-visible evidence.

For model-visible execution, a step may do only these things:

- add first-class session parts to the analysis session context
- add attachments if needed in the future
- change visibility of already-written parts
- start the next bounded turn by providing a prompt

For this recovery, the relevant model-visible parts are deterministic MCP tool calls and
their results.

### 3. No synthetic prompt-based evidence injection

Do not inject analysis evidence as synthetic `user-message` prompt bundles.

That means:

- do not flatten parent-session reasoning, tool calls, tool results, or turn summaries into
  large text prompts just to feed the model
- do not use prompt injection as the carrier of analysis evidence
- do not preserve the current `turn inject` or `evidence inject` pattern as the main design

The analysis LLM should evaluate evidence that exists in the analysis session as real,
inspectable session parts.

### 4. Deterministic inspect calls are the model-visible evidence path

When the analysis workflow needs parent-session evidence, it should load it through
deterministic `mcpscope_inspect` calls committed into the analysis session as proper
`tool_call` and `tool_result` parts.

Those parts must:

- appear in the analysis session trace like any other tool interaction
- be available in model context when included
- be excludable from future context when no longer needed
- remain inspectable even after exclusion from model context

### 5. Reasoning around tool calls is part of the evidence

The target session's reasoning around tool calls must be available to the analysis LLM as
part of the evidence it evaluates.

Do not satisfy this by copying reasoning into prose bundles.

Instead, reasoning parts should be loaded from the parent session through deterministic
inspect calls and made available in the analysis session as inspected evidence.

## What the implementation should look like

### Session launch and prelude

The analysis session must be launched with a real MCP binding:

- `mcpProfileSnapshot` points to the restricted `/mcp/analysis` endpoint
- `runSessionInitialization` runs with the real MCP gateway
- the session prelude contains `system-prompt`, `mcp-instructions`, and
  `tool-definitions`
- token metadata is populated as it is for a normal session

Inspecting a freshly launched analysis session should show a normal prelude with the
analysis MCP tools available.

### Bootstrap step

Bootstrap may still do orchestration and planning work directly against the database.

That includes:

- target session and target turn validation
- evidence packet discovery
- coverage map creation
- writing artifacts such as `analysis_target`, `evidence_packet_index`, and `coverage_map`

Bootstrap may also load initial model-visible evidence through deterministic inspect calls,
but it must not write ad hoc prompt-style evidence blocks.

### Packet assessment flow

For each packet, the workflow should follow this shape:

1. Deterministic step identifies the exact parent-session IDs needed for that packet.
2. Deterministic step loads those IDs through `mcpscope_inspect` calls committed as real
  tool-call and tool-result parts in the analysis session.
3. Bounded turn starts with a short prompt that refers to the already-loaded evidence.
4. The turn returns a normal assistant response that is parsed into the required artifact.
5. Deterministic context mutation excludes packet-specific evidence parts when they are no
  longer needed.

The assessment prompt must be short and referential. It must not restate all evidence.

### Exact evidence to load for packet assessment

Packet assessment should load exact parent-session evidence IDs rather than broad root dumps
whenever possible.

The step should deterministically inspect the exact parts needed for the packet, including
when present:

- the user-request part relevant to the target turn
- reasoning before the tool call
- the tool-call part itself
- the tool-result part itself
- reasoning after the tool result
- the downstream final-answer part when needed to judge result usage

The goal is precise evidence loading, not synthetic summarization.

### Turn summary flow

After all packets for a target turn are assessed:

- any turn-level evidence still needed should already exist in context as first-class parts
- a bounded turn runs with a short summary prompt
- the resulting assistant output is persisted normally
- turn-level evidence can then be excluded from future context

### Final aggregation flow

Final aggregation should operate from accepted prior analysis outputs already present in the
analysis session context.

It must not rebuild the workflow state into another large synthetic prompt bundle.

## Context management rules

Context mutation should become a pure visibility manager.

Its job is to include or exclude already-materialized parts, not to compensate for prompt
injection.

After packet assessment completes, it should:

- exclude packet-specific inspected evidence parts that are no longer needed
- exclude transient prompt parts only if required for message-order correctness
- keep accepted assessment outputs available when later steps need them

After turn summary completes, it should:

- exclude turn-level inspected evidence parts that are no longer needed

Compaction compatibility must be preserved.

## What should be removed or rewritten

The current branch already contains useful groundwork and should not be rewritten from
scratch.

Keep and build on the parts that already move analysis closer to the normal session model:

- real analysis MCP binding at launch
- full session initialization
- bounded turns using the normal tool-enabled turn machinery
- deterministic tool calls committed as real turns and parts
- SSE streaming through the normal turn event path

However, the prompt-based evidence transport path must be removed or rewritten.

In particular:

- any `turn inject` step that writes large context bundles as `user-message` parts should be
  removed or rewritten
- any `evidence inject` logic that copies parent-session reasoning and tool data into prompt
  text should be removed or rewritten
- summary and final aggregation steps should not rely on synthetic evidence bundles

## Acceptance criteria

1. **MCP binding present at launch**: a freshly launched analysis session shows a normal
  prelude containing `system-prompt`, `mcp-instructions`, and `tool-definitions` for
  `mcpscope_inspect` and `mcpscope_status`, with token counts populated.

2. **Deterministic inspect evidence is first-class**: when the workflow loads parent-session
  evidence, it appears in the analysis session as normal `tool_call` and `tool_result`
  parts, not as synthetic prompt bundles.

3. **No synthetic prompt-based evidence injection**: the analysis workflow no longer uses
  large injected `user-message` evidence bundles as the main carrier of model-visible
  evidence.

4. **Packet evidence is loaded precisely**: packet assessment loads exact parent-session
  evidence IDs through deterministic inspect calls, including reasoning around the tool
  call when available.

5. **Bounded turns are normal turns**: bounded analysis turns use the normal tool-enabled
  turn machinery and are streamed like normal turns.

6. **Context mutation is visibility-only**: the mutation logic primarily changes visibility
  of already-written parts rather than authoring or rebuilding evidence for the model.

7. **Tool result is visible before judgment**: the deterministically loaded evidence parts
  are available in the analysis session context before the assessment turn starts.

8. **Deterministic evidence precedes model reasoning**: deterministic evidence-loading parts
  appear earlier in the trace than the bounded turn that judges them.

9. **Reasoning evidence is inspectable**: reasoning around target tool calls is available to
  the analysis LLM through inspected evidence, and remains inspectable in the trace even if
  later excluded from model context.

10. **Token counts and context accounting remain correct**: `context_window.available` and
   per-turn context accounting remain populated and consistent.

11. **Compaction remains safe**: `strip-reasoning` continues to work without crashes or data
   loss when the analysis session contains deterministically written tool calls/results.

12. **Tests and TypeScript are clean**: backend TypeScript is clean and the test suite passes
   after the recovery.

## Scope

- `backend/src/operations/launchAnalysis.ts`
- `backend/src/analysis/bootstrapStep.ts`
- `backend/src/analysis/analysisSession.ts`
- `backend/src/analysis/boundedTurn.ts`
- `backend/src/analysis/toolCallAssessmentTurn.ts`
- `backend/src/analysis/contextMutationStep.ts`
- `backend/src/analysis/finalAggregationTurn.ts`
- `backend/src/runtime/toolTurns.ts`
- `backend/src/app.test.ts`
- any frontend files needed only to preserve normal trace and streaming behavior for analysis

## Out of scope

- adding new MCP tools to the analysis endpoint
- changing the analysis profile or model configuration schema
- redesigning the whole analysis product beyond this recovery
- preserving legacy prompt-bundle patterns for compatibility if they conflict with this task
