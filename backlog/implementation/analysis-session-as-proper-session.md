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

## Concrete reference session: CXQJ

Use session `CXQJ` as a concrete reference example when checking whether the runtime matches
this specification.

`CXQJ` is the source session. The analysis session is expected to be a child
`session_analysis` session whose prelude and deterministic evidence-loading trace make the
analysis behavior inspectable.

### Source session shape

The relevant source setup for `CXQJ` is:

- `CXQJ.S.1-MI`: Home Assistant MCP instructions
- `CXQJ.S.2-TD`: Home Assistant tool definitions

The relevant source turn for the first analysis examples is `CXQJ.1`.

That turn contains these packets:

- packet 1: entity discovery
  - `CXQJ.1.1.2-R`: reasoning before discovery call
  - `CXQJ.1.1.3-T`: `ha_history_list_entities` call and result
  - `CXQJ.1.2.1-R`: reasoning after discovery result / before first stats call
- packet 2: first stats attempt
  - `CXQJ.1.2.1-R`: reasoning before first stats call
  - `CXQJ.1.2.2-T`: first `ha_history_get_sensor_stats` call and result
  - `CXQJ.1.3.1-R`: reasoning after first stats result / before retry
- packet 3: retry of stats call
  - `CXQJ.1.3.1-R`: reasoning before retry
  - `CXQJ.1.3.2-T`: retry `ha_history_get_sensor_stats` call and result
  - `CXQJ.1.4.1-R`: reasoning after retry / before broader query
- packet 4: broader stats call leading to final answer
  - `CXQJ.1.4.1-R`: reasoning before broader query
  - `CXQJ.1.4.2-T`: broader `ha_history_get_sensor_stats` call and result
  - `CXQJ.1.5.1-R`: reasoning after broader query

In `CXQJ`, tool results are embedded in the inspected `tool_call` parts rather than stored as
separate `tool_result` parts, so the evidence unit for a tool interaction is a single
inspected part such as `CXQJ.1.1.3-T` or `CXQJ.1.2.2-T`.

### Expected analysis initialization

Before any packet assessment, the analysis session should have a normal prelude and one
bootstrap deterministic evidence-loading turn.

The expected initialization state is:

1. Normal session prelude exists in the analysis session.
2. The prelude contains:
  - `system-prompt`
  - `tool-definitions`
3. The analysis MCP tools available in the prelude are `mcpscope_inspect` and
   `mcpscope_status`.
4. Token counts are populated for the prelude parts.
5. The target session's own MCP instructions and tool definitions do not live in the
  analysis-session prelude. They are introduced as inspected evidence through the bootstrap
  deterministic turn.
6. Bootstrap injects exactly 2 deterministic inspect calls:
   - inspect `CXQJ`
   - inspect `CXQJ.S`
7. Those bootstrap deterministic inspect calls appear as first-class tool interaction parts in
   the analysis session trace.
8. No synthetic prompt bundle is used to carry setup or source-session evidence.

This distinction matters:

- the analysis-session prelude contains the prompt and analysis tools for the analysis session
  itself
- the analyzed session's MCP instructions and tool definitions appear as content inside the
  bootstrap-inspected evidence, typically in the first deterministic turn

### Expected first deterministic evidence-loading turn

The first deterministic evidence-loading turn is the bootstrap turn.

Expected rounds in that turn:

1. round 0: inspect `CXQJ`
2. round 1: inspect `CXQJ.S`

Expected context after bootstrap and before the first packet assessment:

- analysis prelude parts remain included
- bootstrap deterministic inspect evidence remains included
- source-session setup evidence is available through the inspected `CXQJ` and `CXQJ.S` data
  carried by the bootstrap deterministic turn
- no packet-local evidence has been loaded yet
- no packet assessment prompt has run yet

Using `LLDD` as the concrete example:

- `LLDD.S` is the prelude for the analysis session itself
- `LLDD.1.1.1-T` is the bootstrap inspect of `CXQJ`
- `LLDD.1.2.1-T` is the bootstrap inspect of `CXQJ.S`
- the analyzed session's `mcp_instructions` and `tool_definitions` are visible inside the
  inspected payloads of `LLDD.1`, not as parts under `LLDD.S`

### Expected first tool analysis for CXQJ

The first packet assessment should analyze the entity-discovery step.

The deterministic step should inspect exactly these source parts:

1. `CXQJ.1.1.2-R`
2. `CXQJ.1.1.3-T`
3. `CXQJ.1.2.1-R`

What those parts mean:

- `CXQJ.1.1.2-R`: the model decides it must resolve the outdoor temperature entity before
  fetching statistics
- `CXQJ.1.1.3-T`: `ha_history_list_entities` is called with outdoor temperature search
  parameters and returns `sensor.ruuvitag_fc8f_temperature`
- `CXQJ.1.2.1-R`: the model uses that entity result to prepare the first stats call

Expected rounds and context shape for this first packet analysis:

1. Deterministic inspect round for `CXQJ.1.1.2-R`
2. Deterministic inspect round for `CXQJ.1.1.3-T`
3. Deterministic inspect round for `CXQJ.1.2.1-R`
4. A bounded assessment turn runs with a short referential prompt
5. An `analysis.tool_call_assessment.v1` artifact is produced for packet 1
6. After the assessment completes, those 3 packet-local inspected evidence parts are excluded
   or masked from active LLM context
7. The bootstrap evidence remains available

So immediately before the first packet-assessment turn starts, the active context should
contain:

- the normal analysis prelude
- bootstrap inspect evidence for `CXQJ` and `CXQJ.S`
- packet-local inspected evidence for `CXQJ.1.1.2-R`, `CXQJ.1.1.3-T`, and `CXQJ.1.2.1-R`
- no synthetic textual restatement of those parts

### Expected second tool analysis for CXQJ

The second packet assessment should analyze the first stats attempt.

The deterministic step should inspect exactly these source parts:

1. `CXQJ.1.2.1-R`
2. `CXQJ.1.2.2-T`
3. `CXQJ.1.3.1-R`

What those parts mean:

- `CXQJ.1.2.1-R`: the model plans to fetch daily max statistics for
  `sensor.ruuvitag_fc8f_temperature`
- `CXQJ.1.2.2-T`: the first `ha_history_get_sensor_stats` call returns the contradictory error
  `Invalid aggregation "max". Valid values: mean, min, max, median, count.`
- `CXQJ.1.3.1-R`: the model notices the contradiction and chooses to retry

Expected rounds and context shape for this second packet analysis:

1. Deterministic inspect round for `CXQJ.1.2.1-R`
2. Deterministic inspect round for `CXQJ.1.2.2-T`
3. Deterministic inspect round for `CXQJ.1.3.1-R`
4. A bounded assessment turn runs with a short referential prompt
5. A second `analysis.tool_call_assessment.v1` artifact is produced for packet 2
6. After the assessment completes, those 3 packet-local inspected evidence parts are excluded
   or masked from active LLM context
7. Bootstrap evidence remains available for later steps

So immediately before the second packet-assessment turn starts, the active context should
contain:

- the normal analysis prelude
- bootstrap inspect evidence for `CXQJ` and `CXQJ.S`
- packet-local inspected evidence for `CXQJ.1.2.1-R`, `CXQJ.1.2.2-T`, and `CXQJ.1.3.1-R`
- the accepted output of the first packet assessment if later steps keep prior assessments in
  context
- no lingering included packet-local parts from the first packet

### What should not appear while checking CXQJ

When manually checking the analysis child session for `CXQJ`, these are signs the runtime is
still wrong:

- more than the 2 bootstrap inspect calls appear before the first packet-local assessment
- packet-local assessment reloads broad root session/setup evidence together with local packet
  evidence
- packet-local evidence is flattened into a synthetic `user-message` prompt bundle
- the bounded assessment prompt restates the inspected evidence instead of referring to it
- packet-local inspected parts remain included in active context after their assessment
- deterministic evidence parts are missing token counts
- inspected reasoning around the tool call is absent from the evidence loaded for assessment
- the analyzed session's MCP instructions or tool definitions are expected under the
  analysis-session prelude instead of under the bootstrap inspect evidence

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
