# Session analysis agent v2

This task defines the next real version of the session-analysis agent.

It is a standalone specification task. It intentionally consolidates the useful conclusions from earlier analysis-agent, evidence-protocol, hybrid-workflow, and backend-owned-launch notes into one active planning target.

This task should be treated as the current source of truth for the next analysis-agent direction.

## Goal

Build a proper new version of the session-analysis agent that replaces the current one-shot prompt flow with a session-backed hybrid workflow in which:

- deterministic steps control workflow shape, evidence selection, validation, and context mutation
- bounded LLM turns perform only narrow judgment tasks
- structured outputs are persisted as strict JSON artifacts
- the whole workflow remains inspectable through the normal mcpscope session model

The near-term product goal is a much more trustworthy per-session analysis primitive.

The architectural goal is to prove that mcpscope's new execution model can support deterministic steps combined with LLM turns inside one visible, inspectable analysis session.

## Problem

The current analysis MVP proves that mcpscope can create an analysis child session and get an answer, but it is still too weak and too unconstrained to trust as a real debugging and evaluation tool.

Observed failure modes from earlier work:

- the model inspects too little before judging
- it often synthesizes conclusions from a root-level summary instead of the actual evidence-bearing parts
- it can overclaim what it inspected
- it mixes evidence extraction, request-success judgment, and MCP-surface diagnosis in one free-form pass
- smaller or lazier models degrade badly when left to self-manage the workflow

This is a product problem, not just a prompt problem.

The next agent version therefore needs explicit workflow structure, explicit working artifacts, and deterministic control over what the model sees and when.

## Desired product outcome

After this task, mcpscope should have a new analysis-agent workflow with the following user-facing properties:

- the user launches analysis on a finished parent session and explicitly chooses the target turn to analyze
- mcpscope creates a `session_analysis` child session as the visible runtime for the analysis
- the analysis session executes a deterministic multi-step workflow rather than a single free-form analysis prompt
- each LLM stage returns schema-valid JSON only
- each stage artifact remains inspectable after the run
- the final report is grounded in earlier structured artifacts rather than a vague end-of-run impression

This task is still product-specific. It is not a generic agent framework.

## Core decisions for this version

These decisions are in scope for this task and should be treated as fixed unless implementation work reveals a concrete blocker.

### 1. Session-backed hybrid workflow

The analysis agent remains a child session, not a hidden background job and not a separate external workflow runtime.

The session is the inspectable execution container.

The harness owns step sequencing.

### 2. Deterministic outer control

The workflow is controlled by deterministic `Step` types around ordinary LLM `Turn` steps.

The model does not choose the stage order, packet order, or compaction policy in this version.

### 3. One explicit target turn per run

Version 2 should focus on one finished target turn inside one finished parent session.

Do not attempt full-session autonomous analysis in this increment.

### 4. JSON artifacts as working memory

Structured workflow state should live in `JsonArtifact` instances plus session working state.

Artifact subclasses remain content-oriented. Semantic meaning lives in schema keys and workflow validation rules, not in a new subclass for every artifact meaning.

### 5. Deterministic context mutation

After each bounded LLM assessment turn, bulky evidence should be removed from active visible context and replaced by accepted structured artifacts.

Stripped evidence must remain inspectable through normal history and lookup flows.

### 6. Backend-owned launch and orchestration

This version should not keep the current split ownership where the frontend launches only part of the workflow.

The backend should own child-session creation, initialization, stage sequencing, and failure handling.

## Scope

### In scope

- a new version of the `session_analysis` workflow
- backend-owned launch of that workflow
- one explicit target turn per run
- deterministic outer workflow using non-`Turn` steps
- bounded LLM turns with strict JSON output schemas
- persisted `JsonArtifact` stage outputs
- deterministic validation and context mutation between analysis turns
- a compact final findings artifact derived from earlier artifacts
- normal inspectability through session, step, artifact, transcript, and lookup surfaces
- enough backend/API support that CLI and MCP can later trigger the same workflow without semantic drift

### Out of scope

- multi-session or benchmark synthesis
- open-ended autonomous planning by the analysis model
- a generic public workflow engine for arbitrary tasks
- a new analysis viewer UI
- final benchmark-domain product work
- a broad retry/optimizer loop for analysis quality

## Standalone constraints

This task should not depend on fine-grained sequencing with older backlog tasks.

It can cite canonical docs for runtime and testing rules, but it should otherwise stand on its own.

Useful background from earlier candidate tasks should be treated as inputs that informed this task, not as blocking prerequisites.

## Required workflow shape

The minimum workflow for this version is the following five-stage structure.

### Stage 1. Bootstrap and packet preparation

Step type:

- deterministic artifact-production step

Responsibilities:

- validate the parent session and target turn exist and are complete
- gather session setup and target-turn structure
- identify target-turn rounds and tool calls in order
- identify the target turn's user request and final answer parts
- create the initial artifact set for the rest of the workflow

No model judgment is allowed in this stage.

### Stage 2. Repeated bounded packet assessment turns

Step types:

- one bounded LLM `Turn` per packet
- one deterministic context-mutation step after each accepted packet assessment

For this version, packet kind is limited to `tool_call` packets.

Each packet-assessment turn should receive only the evidence needed for one tool-call decision slice:

- the target turn's user request
- reasoning immediately before the tool call when present
- the tool call payload
- the tool result payload
- the next reasoning step when present
- minimal stable run framing

The model should answer only the narrow packet questions and return exactly one JSON object matching the packet schema.

### Stage 3. Coverage validation gate

Step type:

- deterministic validation step

Responsibilities:

- verify every required packet has an accepted assessment artifact
- verify final-answer evidence for the target turn is available
- stop the workflow with an inspectable failure state if required coverage is incomplete

### Stage 4. Turn outcome adjudication turn

Step type:

- bounded LLM `Turn`

Responsibilities:

- decide only whether the target request was answered, partially answered, unsupported, or unanswered
- rely only on earlier artifacts plus the inspected target request and final answer
- avoid MCP-surface diagnosis in this stage

### Stage 5. Final findings synthesis turn

Step type:

- bounded LLM `Turn`

Responsibilities:

- derive a compact MCP-surface diagnosis from the prior artifacts only
- identify the most actionable next improvement
- keep the output compact and structured

## Required step types

This task should introduce only the minimum new deterministic step types needed for the workflow.

Required new concrete step types:

- `AnalysisBootstrapStep`
- `AnalysisContextMutationStep`
- `AnalysisCoverageValidationStep`

The LLM work should continue to run through `Turn` with stronger prompt and schema control.

## Input contract

The workflow should require explicit run inputs with this shape:

```json
{
  "target_session_id": "LS8K",
  "target_turn_id": "LS8K.3",
  "analysis_goal": "Diagnose whether the turn answered the request and whether MCP tool design contributed to failure.",
  "analysis_profile_key": "default"
}
```

Rules:

- `target_turn_id` is required in this version
- the target turn must already be complete
- the backend should reject invalid or still-running targets before creating a half-started workflow

## Artifact contract

All workflow outputs should be persisted as `JsonArtifact` instances with explicit `schema_key` metadata.

Recommended metadata shape:

```json
{
  "schema_key": "analysis.tool_call_assessment.v1",
  "session_id": "PJF6",
  "target_session_id": "LS8K",
  "target_turn_id": "LS8K.3"
}
```

This task should standardize the following semantic artifact schemas.

### 1. `analysis_target`

Schema key:

- `analysis.analysis_target.v1`

Purpose:

- stable run-level framing shared across later stages

Required fields:

- `target_session_id`
- `target_turn_id`
- `analysis_goal`
- `target_user_request`
- `final_answer`
- `setup_part_ids`
- `round_ids`
- `tool_call_part_ids`

### 2. `coverage_map`

Schema key:

- `analysis.coverage_map.v1`

Purpose:

- machine-checkable state of what required evidence has been inspected and assessed

Required fields:

- setup required and inspected part IDs
- target-turn required and inspected round IDs
- final-answer coverage state
- packet coverage state including linked assessment artifacts

### 3. `evidence_packet_index`

Schema key:

- `analysis.evidence_packet_index.v1`

Purpose:

- deterministic ordered packet worklist for the packet-assessment stage

Required fields:

- `packet_kind`
- ordered packet list
- round ID per packet
- tool-call part ID per packet
- reasoning-before and reasoning-after part IDs when present

### 4. `tool_call_assessment`

Schema key:

- `analysis.tool_call_assessment.v1`

Purpose:

- narrow factual assessment of one tool-call packet

Required fields:

- `packet_id`
- `round_id`
- `tool_call_part_id`
- `tool_name`
- `user_goal_in_round`
- `selected_action`
- `selection_rationale`
- `relevance`
- `observed_result`
- `expectation_match`
- `most_direct_cause`
- `next_step_understanding`
- `evidence_ids`

Required enum constraints:

- `relevance`: `high`, `medium`, `low`
- `observed_result.status`: `success`, `failed`, `mixed`
- `expectation_match`: `match`, `partial_match`, `mismatch`, `unclear`
- `most_direct_cause`: `wrong_parameters`, `tool_misunderstanding`, `tool_description_clarity`, `tool_surface_mismatch`, `tool_limitation`, `unclear`
- `next_step_understanding`: `yes`, `partial`, `no`, `unclear`

### 5. `turn_outcome_assessment`

Schema key:

- `analysis.turn_outcome_assessment.v1`

Purpose:

- narrow adjudication of whether the target request was successfully handled

Required fields:

- `target_turn_id`
- `outcome`
- `supported_by_evidence`
- `final_answer_part_id`
- `reason`
- `supporting_artifact_ids`
- `supporting_part_ids`

Required enum constraints:

- `outcome`: `answered`, `partially_answered`, `unsupported`, `unanswered`

### 6. `mcp_surface_findings`

Schema key:

- `analysis.mcp_surface_findings.v1`

Purpose:

- final compact diagnosis derived from earlier artifacts only

Required fields:

- `target_turn_id`
- `primary_issue`
- `path_efficiency`
- `summary`
- `actionable_next_improvement`
- `supporting_artifact_ids`

Required enum constraints:

- `primary_issue`: `tool_description_clarity`, `tool_surface_mismatch`, `tool_limitation`, `wrong_parameters`, `tool_misunderstanding`, `unclear`
- `path_efficiency`: `efficient`, `mixed`, `inefficient`

## Prompt and output rules for all LLM stages

Every LLM stage in this task must follow these rules:

- the prompt defines one task only
- the prompt provides the exact JSON schema expected
- the model must return only the JSON object and no surrounding prose
- the model must rely only on the provided evidence and cited artifacts
- malformed JSON or schema-invalid output is a workflow failure for that step

This task should prefer hard contracts over best-effort natural-language formatting.

## Deterministic context-mutation rules

After each accepted packet assessment:

- remove the raw packet evidence payload from active visible context
- keep the accepted `tool_call_assessment` artifact in active visible context
- keep stable run framing artifacts such as `analysis_target` and `coverage_map` available
- keep stripped evidence recoverable through normal transcript and lookup inspection

The intended working memory is the accepted artifact ledger, not a growing pile of repeated raw evidence.

## Backend-owned launch and lifecycle requirements

This task should replace the current split launch behavior with one backend-owned execution path.

Required behavior:

- create the `session_analysis` child session
- initialize it against the restricted analysis MCP surface when needed
- start the first workflow step without frontend-owned orchestration gaps
- avoid leaving a partially launched child session because the caller failed mid-flow
- keep failure states inspectable if the workflow stops after the child session exists

The UI should become a thin caller of the same backend-owned launch path.

The design should also leave room for later CLI and MCP triggers to call the same backend-owned workflow without semantic drift.

## Acceptance criteria

This task is ready for implementation splitting when all of the following are true:

1. the task fully defines the new analysis-agent behavior as one coherent product increment
2. the workflow shape is explicit and bounded
3. the minimum new deterministic step types are identified
4. the artifact contract is explicit and schema-oriented
5. the backend-owned launch behavior is part of the task rather than a separate guessed follow-up
6. the task is inspectability-first and consistent with the session-backed execution model
7. the task is still narrow enough to split into implementation increments afterward

## Validation expectations

Implementation of this task should be validated against known bad analysis cases that previously produced lazy inspection or unsupported synthesis.

Validation should prove:

- required packet coverage actually happened
- final claims are traceable to structured artifacts and inspected evidence
- the workflow is more grounded than the current one-shot analysis baseline
- deterministic context mutation keeps active context under control without hiding prior evidence from inspection

## Notes for later splitting

This task is intentionally larger than an implementation handoff.

It should later be split into smaller implementation-ready tasks, likely around:

- runtime step support
- artifact persistence and schema validation
- backend-owned launch/orchestration
- prompt and output-schema integration
- focused validation and replay coverage

Those splits should happen after this specification is accepted as the target design for the new session-analysis agent.