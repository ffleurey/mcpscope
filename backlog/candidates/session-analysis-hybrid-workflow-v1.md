# Session analysis hybrid workflow v1

This candidate has now been subsumed by the active standalone specification:

- `backlog/specification/session-analysis-agent-v2.md`

This candidate defines the first concrete iteration of a better analysis workflow built on the new execution model.

It is intentionally narrow. It is not a generic agent framework and it is not the final analysis architecture.

The purpose of this iteration is to prove one simple pattern works well in mcpscope:

- deterministic steps own workflow shape, evidence selection, validation, and context mutation
- LLM turns are used only for bounded judgment tasks
- all stage outputs use strict JSON artifacts
- one analysis run focuses on one finished target turn

## Why this iteration exists

The current one-shot analysis workflow is too unconstrained.

The current evidence-protocol work already identifies the main failure mode:

- insufficient inspection coverage
- premature synthesis
- unsupported claims
- too much dependence on model diligence

At the same time, the new execution model now gives mcpscope the right architectural direction:

- `Session` owns orchestration
- `Step` is the unit of execution
- deterministic work can be represented by non-`Turn` step types
- visible context can be mutated deterministically between turns
- artifacts can hold structured state between steps

This candidate turns those two threads into one simple first implementation target.

## Goal

Implement a first hybrid analysis workflow that evaluates one finished target turn by using:

1. deterministic bootstrap and evidence-packet preparation
2. one bounded LLM turn per packet
3. deterministic context mutation after each packet
4. one bounded adjudication turn for the target request outcome
5. one bounded synthesis turn for final MCP-surface findings

The expected result is a workflow that is much more grounded than the current one-shot prompt, while still staying simple enough to implement and inspect.

## Scope

### In scope

- one `session_analysis` child session for one parent session
- one explicit target turn per run
- deterministic outer workflow
- bounded LLM turns with strict JSON outputs
- `JsonArtifact` outputs for all stage artifacts
- deterministic context mutation between analysis turns
- explicit coverage and packet state stored in artifacts
- final compact JSON report derived from earlier artifacts

### Out of scope

- multi-session or benchmark analysis
- open-ended autonomous analysis planning by the model
- retry loops beyond simple deterministic validation failure handling
- a generic public workflow framework for arbitrary agent tasks
- a new UI viewer for this increment
- final artifact taxonomy for all future analysis use cases

## Target use case

This iteration is optimized for one developer asking:

> for this finished turn, why did the model choose these tools, how did those calls actually go, did the turn succeed, and what MCP-surface issue most likely hurt or helped?

## Input contract

Each run should require the following workflow inputs:

```json
{
  "target_session_id": "LS8K",
  "target_turn_id": "LS8K.3",
  "analysis_goal": "Diagnose whether the turn answered the request and whether MCP tool design contributed to failure.",
  "analysis_profile_key": "default"
}
```

Rules:

- `target_turn_id` is required in v1; do not infer it implicitly
- the target turn must already be finished
- the workflow should fail fast if the turn is still running or missing

## Workflow shape

The workflow is session-backed but harness-controlled.

The analysis session is the persistent, inspectable container. The harness decides every step.

### Stage 1. Bootstrap step

Step kind:

- deterministic `ArtifactProductionStep`

Responsibilities:

- verify the target session and target turn exist and are completed
- inspect the parent session root, setup, and target turn structure
- identify all target-turn rounds in order
- identify all tool-call nodes in the target turn in order
- identify the final answer part for the target turn when present
- build the initial artifact set

Produced artifacts:

- `analysis_target`
- `coverage_map`
- `evidence_packet_index`

No model judgment is allowed in this stage.

### Stage 2. Repeated packet assessment turns

Step kinds:

- repeated LLM `Turn`
- deterministic `ContextMutationStep` after each turn

Each packet-assessment turn receives exactly one packet from `evidence_packet_index`.

In v1, packet kind is limited to `tool_call`.

Each packet includes:

- the relevant user prompt for the target turn
- the inspected reasoning immediately before the tool call when present
- the tool call payload
- the tool result payload
- the next reasoning part when present
- minimal stable context from `analysis_target`

The model must answer only the packet questions and must return the exact JSON schema defined below.

After each accepted packet assessment:

- the packet's bulky evidence is removed from active visible context
- the accepted `tool_call_assessment` artifact remains available as working memory
- stripped evidence remains inspectable in transcript/history

### Stage 3. Coverage validation step

Step kind:

- deterministic `ValidationStep`

Responsibilities:

- verify every packet in `evidence_packet_index` has a completed assessment artifact
- verify the target turn final answer part has been recorded in `coverage_map`
- fail the workflow if required packet coverage is incomplete

This is a hard gate before adjudication.

### Stage 4. Turn outcome adjudication turn

Step kind:

- LLM `Turn`

Inputs:

- `analysis_target`
- completed `tool_call_assessment` artifacts
- inspected final answer part for the target turn
- the original user request for the target turn

The model decides only whether the target request was:

- `answered`
- `partially_answered`
- `unsupported`
- `unanswered`

This turn must not produce MCP-surface recommendations.

Produced artifact:

- `turn_outcome_assessment`

### Stage 5. Final findings synthesis turn

Step kind:

- LLM `Turn`

Inputs:

- `analysis_target`
- completed `tool_call_assessment` artifacts
- `turn_outcome_assessment`

This turn produces only the final compact MCP-surface diagnosis and next improvement recommendation.

Produced artifact:

- `mcp_surface_findings`

## Artifact model

All semantic outputs in this iteration should be stored as `JsonArtifact` instances.

Artifact subtype should stay content-oriented.

That means these are semantic schemas over `JsonArtifact`, not new artifact subclasses.

Recommended metadata fields for each artifact:

```json
{
  "schema_key": "analysis.tool_call_assessment.v1",
  "session_id": "PJF6",
  "target_session_id": "LS8K",
  "target_turn_id": "LS8K.3"
}
```

## Required artifact schemas

### 1. `analysis_target`

Schema key:

- `analysis.analysis_target.v1`

Purpose:

- stable run-level framing shared across later steps

Shape:

```json
{
  "target_session_id": "LS8K",
  "target_turn_id": "LS8K.3",
  "analysis_goal": "Diagnose whether the turn answered the request and whether MCP tool design contributed to failure.",
  "target_user_request": {
    "part_id": "LS8K.3.1.1-U",
    "text": "What is the inside temperature right now?"
  },
  "final_answer": {
    "part_id": "LS8K.3.4.2-A",
    "text": "The inside temperature is 16.8 C."
  },
  "setup_part_ids": [
    "LS8K.S.1-SP",
    "LS8K.S.2-MI",
    "LS8K.S.3-TD"
  ],
  "round_ids": [
    "LS8K.3.1",
    "LS8K.3.2",
    "LS8K.3.3",
    "LS8K.3.4"
  ],
  "tool_call_part_ids": [
    "LS8K.3.1.3-T",
    "LS8K.3.2.2-T"
  ]
}
```

### 2. `coverage_map`

Schema key:

- `analysis.coverage_map.v1`

Purpose:

- machine-checkable record of what evidence has been inspected and assessed

Shape:

```json
{
  "target_session_id": "LS8K",
  "target_turn_id": "LS8K.3",
  "setup": {
    "required_part_ids": ["LS8K.S.1-SP", "LS8K.S.2-MI", "LS8K.S.3-TD"],
    "inspected_part_ids": ["LS8K.S.1-SP", "LS8K.S.2-MI", "LS8K.S.3-TD"]
  },
  "target_turn": {
    "required_round_ids": ["LS8K.3.1", "LS8K.3.2", "LS8K.3.3", "LS8K.3.4"],
    "inspected_round_ids": ["LS8K.3.1", "LS8K.3.2", "LS8K.3.3", "LS8K.3.4"],
    "final_answer_part_id": "LS8K.3.4.2-A",
    "final_answer_inspected": true
  },
  "packets": [
    {
      "packet_id": "packet-1",
      "tool_call_part_id": "LS8K.3.1.3-T",
      "assessment_artifact_id": "artifact-1",
      "status": "assessed"
    }
  ]
}
```

### 3. `evidence_packet_index`

Schema key:

- `analysis.evidence_packet_index.v1`

Purpose:

- deterministic ordered worklist for packet-assessment turns

Shape:

```json
{
  "target_session_id": "LS8K",
  "target_turn_id": "LS8K.3",
  "packet_kind": "tool_call",
  "packets": [
    {
      "packet_id": "packet-1",
      "round_id": "LS8K.3.1",
      "reasoning_before_part_id": "LS8K.3.1.2-R",
      "tool_call_part_id": "LS8K.3.1.3-T",
      "reasoning_after_part_id": "LS8K.3.2.1-R"
    }
  ]
}
```

### 4. `tool_call_assessment`

Schema key:

- `analysis.tool_call_assessment.v1`

Purpose:

- narrow factual assessment of one tool-call packet

Shape:

```json
{
  "packet_id": "packet-1",
  "round_id": "LS8K.3.1",
  "tool_call_part_id": "LS8K.3.1.3-T",
  "tool_name": "homeassistant_get_entity_state",
  "user_goal_in_round": "Find the current inside temperature.",
  "selected_action": "tool_call",
  "selection_rationale": "The reasoning indicates the model needed the current sensor reading.",
  "relevance": "high",
  "observed_result": {
    "status": "failed",
    "summary": "The call returned an entity lookup error.",
    "key_result_excerpt": "Entity sensor.inside_temperature not found."
  },
  "expectation_match": "mismatch",
  "most_direct_cause": "wrong_parameters",
  "next_step_understanding": "partial",
  "evidence_ids": {
    "reasoning_before_part_id": "LS8K.3.1.2-R",
    "tool_call_part_id": "LS8K.3.1.3-T",
    "reasoning_after_part_id": "LS8K.3.2.1-R"
  }
}
```

Allowed enum values:

- `relevance`: `high`, `medium`, `low`
- `observed_result.status`: `success`, `failed`, `mixed`
- `expectation_match`: `match`, `partial_match`, `mismatch`, `unclear`
- `most_direct_cause`: `wrong_parameters`, `tool_misunderstanding`, `tool_description_clarity`, `tool_surface_mismatch`, `tool_limitation`, `unclear`
- `next_step_understanding`: `yes`, `partial`, `no`, `unclear`

### 5. `turn_outcome_assessment`

Schema key:

- `analysis.turn_outcome_assessment.v1`

Purpose:

- narrow turn-success judgment based on prior artifacts and final answer

Shape:

```json
{
  "target_turn_id": "LS8K.3",
  "outcome": "unsupported",
  "supported_by_evidence": false,
  "final_answer_part_id": "LS8K.3.4.2-A",
  "reason": "The final answer gives a temperature value that is not supported by any successful inspected tool result.",
  "supporting_artifact_ids": [
    "artifact-1",
    "artifact-2"
  ],
  "supporting_part_ids": [
    "LS8K.3.4.2-A"
  ]
}
```

Allowed enum values:

- `outcome`: `answered`, `partially_answered`, `unsupported`, `unanswered`

### 6. `mcp_surface_findings`

Schema key:

- `analysis.mcp_surface_findings.v1`

Purpose:

- final compact diagnosis derived from earlier artifacts only

Shape:

```json
{
  "target_turn_id": "LS8K.3",
  "primary_issue": "tool_description_clarity",
  "path_efficiency": "inefficient",
  "summary": "The model followed a plausible tool path but repeated a failing lookup without reaching supported evidence for the final answer.",
  "actionable_next_improvement": "Clarify the expected entity identifier format in the tool description and return stronger guidance when entity lookup fails.",
  "supporting_artifact_ids": [
    "artifact-1",
    "artifact-2",
    "artifact-3"
  ]
}
```

Allowed enum values:

- `primary_issue`: `tool_description_clarity`, `tool_surface_mismatch`, `tool_limitation`, `wrong_parameters`, `tool_misunderstanding`, `unclear`
- `path_efficiency`: `efficient`, `mixed`, `inefficient`

## Prompting rules for LLM turns

Every LLM turn in this workflow must:

- receive one explicitly named task only
- receive the exact JSON schema it must return
- be instructed not to add prose outside the JSON object
- be instructed to rely only on the provided evidence and cited artifact inputs
- include the required evidence IDs in its output where the schema asks for them

The harness should reject malformed JSON or schema-invalid outputs.

## Deterministic context mutation rules

After each completed `tool_call_assessment` turn:

- remove the raw packet evidence payload from active visible context
- keep the accepted `tool_call_assessment` artifact in active visible context
- keep `analysis_target` and `coverage_map` available
- keep stripped transcript parts recoverable through normal inspect flows

This is the key v1 compaction behavior.

The model should remember the accepted facts, not continuously reread raw payloads from earlier packets.

## Minimum new step types for this increment

This iteration should stay minimal.

The workflow only needs the following new concrete deterministic step types:

- `AnalysisBootstrapStep`
  - deterministic artifact production
- `AnalysisContextMutationStep`
  - deterministic visible-context update after each packet assessment
- `AnalysisCoverageValidationStep`
  - deterministic gate before adjudication

LLM work should continue to use `Turn` with stricter prompt and output-schema handling.

## Acceptance criteria

This iteration is successful when all of the following are true:

1. one analysis run can target one completed turn explicitly
2. the harness, not the model, decides the packet sequence
3. each packet-assessment turn returns schema-valid JSON only
4. each accepted assessment becomes a persisted `JsonArtifact`
5. raw packet evidence is removed from active visible context after assessment while remaining inspectable in history
6. adjudication cannot run unless packet coverage is complete
7. final findings are derived from prior artifacts, not from a fresh free-form session inspection
8. the resulting analysis session remains inspectable through the normal mcpscope runtime surfaces

## Validation approach

Validate this iteration against known bad analysis cases already captured in the evidence-protocol work.

Validation should confirm:

- packet coverage actually happened
- final outcome claims are traceable to packet assessments and final-answer evidence
- the workflow is more grounded than the current one-shot analysis baseline
- context growth is controlled by deterministic packet compaction rather than by hoping the model stays concise

## Why this is the right first cut

This iteration is deliberately conservative.

It does not attempt to solve every future analysis need. It proves a single important pattern:

- deterministic outer workflow
- bounded JSON-producing model stages
- explicit artifact memory
- deterministic context mutation
- inspectable session-backed execution

If that pattern works well, later iterations can expand packet kinds, add retries or stronger validation, and decide whether broader guided-session autonomy is worth the extra complexity.