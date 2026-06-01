This task is about creating multiple types of analysis sessions.

Per now we have primary sessions and analsyis sessions.

In general, we want mcpscope to be a framework where we can easily create enw types of analysis and customize the existing ones. That is why we have designe the architecture around a hierachy of clasees to define sessions polymorphically and also execture them with a kind of interpreter pattern. We have also modularized the session execution in steps which are meant to encapsulate a particular reusable unit. We also define relatively generit types of artifact which should allow to easily reuse a workflow with different atifacts and/or reuse artifacts across worflows.

But so far we have only one type of analysis session and in terms of the way it is implemented there are several potential issues.
* The implemntation is probably too monolythic -> ie. One big class with everything in it
* The steps are not well encapsulated and modularized as reusable units. I think we missed the mark with how the compaction is happening, it seems that we are cleaning the context at the start of our steps, where for teh steps to be better encapsulated it should happen at the end. As it is now we are cleaning based on what the last step did which breaks encapsulation of the steps.


So, there is 2 reasons to try to introduce now multiple (maybe 3) tyeps of analysis session
1. We will need different types and for benchmarks: we need something faster to grade runs and then a benchmark agregarion might decide to scrutenize closer some of the runs.
2. We need more than one type of analysis session to "prove" and justify that we have a good framework.


**Full session analysis**

We can keep the analysis session logic for the "full analysys" like we have it at this point. But we can change the encapsulation into steps and other structures if it make sense.

**Fast session analysis**

Exact same set of steps but much simpler prompts and expeted outputs. No interpretation but a ranking of the tool use efficiency for the tool analysis from "excellent", "partly sucessful", "useless", "request error", "response error", "empty" or something like this. Inputs are welcome on the options we should provide. the goal is to have a quick assesement of the parts around the tool call so that when we agregate multiple runs we can pin point the interesting ones to analyse and not spend time on what is working. The turn summary should qualify how well the model was able to answer the question. And the final session summary should give a tool by tool assessement plus an averall assesement of the session.

This is a bit of a special case but the framework should also allow for different workflow. Here is a thirs analysis we could impelment to compare how it would perform.

**Fast Tool analsysi**
We will not follow the session linearly this time but after initializing the session like the other analysis we will create one step per tool used in the session. For each tool useding in the session, we are going to put in the context of the moddel all the resonning and tool calls for that tool at once and then have 1 prompt to ask for an assesement of the success using the tool.
Then we have only one agregation step which will just give a comment on the overal session and give a summary of the performance tool by tool. The analsis can be asked to point out which part id correspond to tool calls.

In the impelmntation of those 3 types of session we should figure out a good way of reusing when it make sense but also an elagant way of implemnting the specific steps of each analysis without overhead.

One question looking at the implemntation today is how we can maybe find a more elegant way of storing prompts and jso schemas without having them in the code itself but maybe as ressources which get loaded. We do not want to have them in the db I believe but maybe we can find something more elegant than bloating the source code which is a bit hard to edit and maitain as well.

## Task specification

### Workflow summaries

The three concrete session-analysis workflows in scope are:

#### Full session analysis

Full session analysis is the richest and most interpretive workflow.

It walks the session in broad linear order, builds packet-level evidence around tool usage, produces one detailed assessment per tool call, produces one turn summary per analyzed turn, and then produces one final session report.

Its purpose is to explain what happened, why it happened, what the main tool-use issues were, and what improvements to tool surfaces or tool descriptions may be justified.

#### Fast session analysis

Fast session analysis keeps the same broad linear traversal shape as full session analysis, but uses simpler prompts and more compact schemas.

It still works from tool-call evidence packets and still produces turn-level and session-level outputs, but its purpose is quick grading, compact diagnostics, and benchmark-friendly aggregation rather than rich interpretation.

#### Fast tool analysis

Fast tool analysis does not primarily follow the session turn by turn after initialization.

Instead, it reorganizes the target evidence around tool uses and produces one compact assessment per tool-use unit, followed by one session-level aggregation focused on tool-by-tool performance and on identifying which tool uses deserve deeper follow-up.

### Canonical step contract

All workflow steps in this task should be specified with the same explicit contract shape:

* what gets added to the context
* what prompt is used
* what output schema is used
* what gets removed from the context

That should be treated as the minimum design contract for a step.

For implementation purposes, a step may also need operational fields such as:

* step identity
* preconditions
* produced artifacts
* next-step routing
* deterministic validation rules

But the four fields above are the core behavioral contract and should be documented for every step.

### Intent

This task is not only about adding one more analysis workflow. It is about clarifying and extracting the execution contract and workflow boundaries that should be shared by:

* primary sessions
* session analysis workflows
* future benchmark analysis workflows
* future backend-owned agent workflows that may have different inputs, tools, artifacts, and report formats

The current implementation already contains useful pieces for this, but the overall structure is still too centered on one concrete `AnalysisSession` implementation. This task should move the architecture toward a generic runtime contract with workflow-specific execution logic.

### Core architectural direction

The shared abstraction should not be "analysis session logic".

The shared abstraction should be a backend-owned executable workflow run with:

* a subject to operate on
* a workflow definition
* a tool surface
* persisted execution state
* step-by-step execution through the scheduler
* inspectable turns, parts, steps, and artifacts

In other words, the common layer should be the runtime contract and persistence model, not the middle workflow logic.

The middle logic must remain flexible enough that different workflow families can differ on:

* what kind of subject they accept
* how they build their work plan
* whether they execute linearly or by grouping work in another way
* what steps they run
* how they manage context between steps
* what artifacts and final reports they produce
* what tools they can use

### Scope of this task

This task should define and implement enough framework structure to support three concrete session-analysis workflows cleanly:

* the existing full session analysis workflow
* a new fast session analysis workflow
* a new fast tool analysis workflow

The implementation should be done in a way that keeps the door open for future workflow families, including benchmark-oriented analysis, without forcing them into session-analysis-specific assumptions.

This task does not need to implement benchmark analysis now.

This task also does not need to generalize every session type immediately if doing so would cause excessive churn. However, the design introduced here must move the code toward a universal runtime contract rather than further entrenching one-off special cases.

### Required outcomes

#### 1. Introduce a workflow-level abstraction

The implementation should introduce a workflow abstraction that separates:

* the generic execution shell
* the workflow-specific planning and step logic

At minimum, the structure should make room for the following concerns to be implemented separately:

* workflow identity
* workflow input or subject type
* workflow initialization
* workflow cursor state
* workflow step execution
* workflow-owned context mutation policy
* workflow artifact production
* workflow completion or error reporting

The exact names and module layout are open, but the code should make it possible to add a new workflow without copying and modifying one monolithic runner.

#### 2. Keep one common runtime contract

The runtime contract should be treated as shared across all executable workflows, including primary sessions.

That common contract should continue to support the same kinds of capabilities that already exist in the backend scheduler and HTTP layer:

* launch or create
* initialize
* execute fully
* execute one step
* pause
* resume
* inspect status
* stream execution events

This task does not need to fully unify every existing code path under one implementation if that would be too large for one PR, but the resulting design must clearly converge toward that direction.

#### 3. Add the two additional analysis workflows explicitly requested by this task

This task should implement the two additional session-analysis workflows described in the input text, not only one lighter variation of the existing flow.

The first additional workflow is fast session analysis.

This workflow should:

* reuse the same target-session style of input as the current analysis launch flow
* remain backend-owned and inspectable like the existing analysis workflow
* use simpler prompts and stricter, smaller outputs than the full workflow
* keep the same broad linear traversal model as the full workflow unless a smaller change proves clearly better

The purpose of this workflow is to support quick assessment and future benchmark aggregation, so machine-readable outputs matter more than rich narrative outputs.

The second additional workflow is fast tool analysis.

This workflow should:

* reuse the same broad launch style and runtime contract as the other session-analysis workflows
* analyze the session by grouping evidence by tool name rather than following the session strictly linearly
* create exactly one analysis unit per tool name used in the in-scope part of the target session
* produce a compact per-tool assessment and one overall aggregation step for the session

This workflow exists specifically to prove that the framework can support a materially different workflow shape, not only lighter prompts over the same traversal.

#### 4. Fix step encapsulation as a first-class requirement

This task must correct the current weakness where context cleanup behavior is effectively coordinated through session-level pending fields rather than owned explicitly by the step or workflow contract.

The key behavioral requirement from the input text is that step encapsulation should not depend on cleaning up at the beginning of the next step based on what the previous step happened to do.

The intended direction is:

* each step should define what context it adds during execution
* each step should define what context should remain active after it completes
* each step should define what context should be excluded or downgraded when it finishes
* cleanup should happen as part of the completion contract of the step that introduced the context, not as an implicit side effect owned by a later step

The exact implementation may still use persisted state between steps, but the code should make the ownership of context mutation explicit and local to the workflow or step definition.

#### 5. Reduce prompt and schema sprawl in code

This task should improve how prompts and related structured resources are stored.

The preferred direction is:

* prompt text and similar authored resources should move out of large inline source strings where practical
* resource loading should remain backend-owned and version-controlled
* prompts should not be moved into the database

JSON schema handling may remain code-owned if that is the cleaner option for type safety and validation, but the task should explicitly choose a maintainable strategy rather than letting prompt and schema definitions continue to grow ad hoc.

### Fast session analysis requirements

The fast session analysis workflow should inspect the same general evidence as the full workflow, but it should produce compact structured judgments optimized for aggregation.

The fast workflow should not attempt to replicate the full interpretive depth of the existing analysis.

For each assessed tool call, the output should distinguish at least:

* whether the tool usage was successful
* whether the tool usage was efficient or wasteful
* whether a failure was caused by the model, the request shape, the tool response, or lack of usable evidence

To keep aggregation clean, the output schema should avoid collapsing all of those dimensions into one overloaded enum.

A preferred shape is to separate:

* result status
* efficiency
* primary issue or failure cause
* short rationale

The exact fast session packet assessment schema must be:

```json
{
	"turn_id": "string",
	"round_id": "string",
	"tool_call_part_id": "string",
	"tool_name": "string",
	"result_status": "successful | partially_successful | unsuccessful | request_error | response_error | empty | unclear",
	"efficiency": "efficient | acceptable | inefficient | unnecessary | unclear",
	"primary_issue": "none | wrong_tool | wrong_parameters | request_construction_error | response_interpretation_error | tool_error | missing_evidence | unclear",
	"short_rationale": "string",
	"post_call_outcome": "correctly_used | partially_used | misused | ignored | not_applicable | unclear",
	"follow_up_priority": "none | low | medium | high"
}
```

The exact fast turn summary schema must be:

```json
{
	"turn_id": "string",
	"total_tool_calls_assessed": 0,
	"turn_outcome": "answered | partially_answered | not_answered | unclear",
	"turn_outcome_rationale": "string",
	"per_tool_findings": [
		{
			"tool_call_part_id": "string",
			"tool_name": "string",
			"result_status": "successful | partially_successful | unsuccessful | request_error | response_error | empty | unclear",
			"brief_finding": "string"
		}
	],
	"cross_attempt_reconciliation": "string | null",
	"follow_up_candidates": ["tool_call_part_id", "..."]
}
```

The exact fast final session report schema must be:

```json
{
	"overall_outcome": "answered | partially_answered | not_answered | unclear",
	"overall_rationale": "string",
	"path_efficiency": "efficient | mixed | inefficient | unclear",
	"tool_summaries": [
		{
			"tool_name": "string",
			"total_tool_calls": 0,
			"successful_tool_calls": 0,
			"request_error_tool_calls": 0,
			"response_error_tool_calls": 0,
			"empty_tool_calls": 0,
			"inefficient_tool_calls": 0,
			"summary": "string"
		}
	],
	"notable_failures": [
		{
			"tool_call_part_id": "string",
			"tool_name": "string",
			"result_status": "successful | partially_successful | unsuccessful | request_error | response_error | empty | unclear",
			"primary_issue": "none | wrong_tool | wrong_parameters | request_construction_error | response_interpretation_error | tool_error | missing_evidence | unclear",
			"reason": "string"
		}
	],
	"follow_up_candidates": [
		{
			"tool_call_part_id": "string",
			"tool_name": "string",
			"reason": "string",
			"priority": "medium | high"
		}
	],
	"total_tool_calls_assessed": 0
}
```

Turn-level output should summarize how well the model progressed toward answering the user request during that turn.

Session-level output should summarize:

* overall session quality
* tool-by-tool assessment
* notable failures or inefficiencies
* a compact machine-readable summary suitable for future benchmark aggregation

### Fast session analysis step specification

The fast session analysis workflow is fully specified by the following target steps.

#### Step 1. Bootstrap and session targeting

What gets added to the context:

* the analysis system prompt for fast session analysis
* the restricted mcpscope MCP instructions and tool definitions available to the analysis session
* a deterministic inspect-based summary of the target session and the target turn boundary
* an evidence packet index artifact covering the in-scope tool calls up to the target turn

What prompt is used:

* no generative prompt is required for the LLM in this step
* this is a deterministic indexing and initialization step

What output schema is used:

* `analysis.analysis_target.v1` or a successor schema for workflow targeting metadata
* `analysis.evidence_packet_index.v1` or a successor schema for packet planning

What gets removed from the context:

* nothing yet, except any transient bootstrap-only deterministic parts that are not needed after the packet index and target artifacts are written

#### Step 2. Per-tool-call fast packet assessment

This step repeats once per evidence packet in linear packet order.

What gets added to the context:

* the packet-local inspected evidence for exactly one tool call:
* reasoning before the call when available
* the tool call itself
* the tool result when available through the inspected call evidence
* reasoning after the call when available

What prompt is used:

* a fast assessment prompt that asks for a compact judgment of the packet
* the prompt must ask exactly for the fields of the fast session packet assessment schema and must require exactly one JSON object with no prose before or after it
* the prompt must ask separately for result status, efficiency, primary issue, short rationale, post-call outcome, and follow-up priority

The prompt should explicitly avoid full interpretive narrative and should prefer sparse outputs for routine success cases.

What output schema is used:

* exactly the fast session packet assessment schema defined above

What gets removed from the context:

* the deterministic inspect evidence parts added for this packet
* the reasoning parts produced by the fast assessment step itself
* the user question part for the fast assessment prompt
* the assistant JSON result must remain in context until the relevant turn summary has completed

#### Step 3. Fast turn summary

This step runs once after all packets for one target-session turn have been assessed.

What gets added to the context:

* the turn-local context summary needed to understand what was being attempted in the turn
* the accepted fast packet assessment JSON results for that turn

What prompt is used:

* a compact turn-summary prompt asking how well the model progressed toward answering the user request during that turn
* if the same tool was used more than once in the turn, the prompt must ask for a brief reconciliation of retries or changed attempts
* the prompt must require exactly one JSON object matching the fast turn summary schema and no prose outside that object

What output schema is used:

* exactly the fast turn summary schema defined above

What gets removed from the context:

* the prompt user part for the turn summary step
* the reasoning parts produced by the turn summary step
* the turn-context inject parts added specifically for this summary step
* the accepted packet assessment JSON results for this turn must remain in context until final aggregation completes

#### Step 4. Coverage validation

What gets added to the context:

* nothing to the LLM context
* this is a deterministic validation step over artifacts

What prompt is used:

* no LLM prompt

What output schema is used:

* no new synthesis schema on success
* `analysis.diagnostic.v1` or successor diagnostic schema on failure

What gets removed from the context:

* nothing

#### Step 5. Fast final session aggregation

What gets added to the context:

* the accepted fast packet assessment results
* the accepted fast turn summary results
* any workflow target metadata needed to ground the conclusion

What prompt is used:

* a compact final aggregation prompt asking for a benchmark-friendly session summary
* the prompt must ask exactly for the fields of the fast final session report schema and must require exactly one JSON object with no prose before or after it
* the prompt must ask for overall session quality, tool-by-tool summary, major inefficiencies or failures, and which parts deserve deeper follow-up by richer analysis

What output schema is used:

* exactly the fast final session report schema defined above

What gets removed from the context:

* the prompt user part for the final aggregation step
* the reasoning parts produced by the final aggregation step
* after the final artifact is accepted, any transient synthesis-only context can be excluded because the workflow is complete

### Fast tool analysis requirements

The fast tool analysis workflow should intentionally use a different execution shape from the full and fast session workflows.

After initialization, it should not be required to walk the session strictly in linear order.

Instead, it should support a plan where analysis units are built around tool usage itself. The work-unit shape is fixed for this task and is:

* identify the distinct tool names used in the target session scope
* gather all relevant reasoning, tool call, and tool result evidence for each tool name
* analyze each tool name as one grouped work unit
* run one aggregation step that summarizes session-wide tool performance

The workflow should be able to point back to the relevant part ids or equivalent evidence references for the assessed tool uses.

The outputs should remain compact and machine-readable, with emphasis on:

* whether the tool use was useful
* whether the tool use was efficient
* whether the failure mode came from the request, the tool response, the model behavior, or missing evidence
* which tool uses deserve closer inspection by richer analysis later

The exact fast tool work index schema must be:

```json
{
	"tool_groups": [
		{
			"work_unit_id": "string",
			"tool_name": "string",
			"tool_call_part_ids": ["string"],
			"tool_result_part_ids": ["string"],
			"reasoning_before_part_ids": ["string"],
			"reasoning_after_part_ids": ["string"],
			"turn_ids": ["string"],
			"round_ids": ["string"]
		}
	]
}
```

The exact fast tool grouped assessment schema must be:

```json
{
	"work_unit_id": "string",
	"tool_name": "string",
	"tool_call_part_ids": ["string"],
	"turn_ids": ["string"],
	"total_tool_calls": 0,
	"usefulness": "high | mixed | low | none | unclear",
	"efficiency": "efficient | acceptable | inefficient | unclear",
	"common_failure_mode": "none | wrong_tool | wrong_parameters | request_construction_error | response_interpretation_error | tool_error | missing_evidence | unclear",
	"summary": "string",
	"follow_up_priority": "none | low | medium | high",
	"notable_part_ids": ["string"]
}
```

The exact fast tool final report schema must be:

```json
{
	"overall_tool_use_outcome": "strong | mixed | weak | unclear",
	"overall_rationale": "string",
	"tool_summaries": [
		{
			"work_unit_id": "string",
			"tool_name": "string",
			"usefulness": "high | mixed | low | none | unclear",
			"efficiency": "efficient | acceptable | inefficient | unclear",
			"common_failure_mode": "none | wrong_tool | wrong_parameters | request_construction_error | response_interpretation_error | tool_error | missing_evidence | unclear",
			"summary": "string",
			"follow_up_priority": "none | low | medium | high"
		}
	],
	"repeated_failure_patterns": ["string"],
	"follow_up_candidates": [
		{
			"work_unit_id": "string",
			"tool_name": "string",
			"reason": "string",
			"priority": "medium | high"
		}
	],
	"total_tool_groups_assessed": 0,
	"total_tool_calls_assessed": 0
}
```

### Fast tool analysis step specification

The fast tool analysis workflow is fully specified by the following target steps.

#### Step 1. Bootstrap and tool-use planning

What gets added to the context:

* the analysis system prompt for fast tool analysis
* the restricted mcpscope MCP instructions and tool definitions available to the analysis session
* a deterministic inspect-based summary of the target session and target turn boundary
* a tool-use work index artifact describing the tool-use units to analyze

What prompt is used:

* no generative prompt is required for the LLM in this step
* this is a deterministic planning step

What output schema is used:

* `analysis.analysis_target.v1` or successor workflow-target schema
* exactly the fast tool work index schema defined above

What gets removed from the context:

* nothing yet, except any transient bootstrap-only deterministic parts not needed after artifacts are written

#### Step 2. Per-tool-name grouped assessment

This step repeats once per planned tool-use work unit.

What gets added to the context:

* the inspected evidence for exactly one grouped tool-name work unit:
* all relevant reasoning-before parts for that tool name in scope
* all tool-call parts for that tool name in scope
* all tool-result parts for that tool name in scope
* all relevant reasoning-after parts for that tool name in scope
* the tool-use work-unit identity

What prompt is used:

* a fast grouped-tool assessment prompt asking whether this tool, across all of its uses in the in-scope session, was useful, efficient, and correctly executed
* the prompt must ask exactly for the fields of the fast tool grouped assessment schema and must require exactly one JSON object with no prose before or after it
* the prompt should ask the model to anchor the answer in the provided evidence only and to avoid cross-session theorizing

What output schema is used:

* exactly the fast tool grouped assessment schema defined above

What gets removed from the context:

* the deterministic inspect evidence parts added for this work unit
* the reasoning parts produced by the assessment step itself
* the user question part for the assessment prompt
* the accepted assistant JSON result must remain in context until the final aggregation step completes

#### Step 3. Final tool-performance aggregation

This step runs once after all tool-use work units have been assessed.

What gets added to the context:

* the accepted per-tool-use assessment results
* the workflow target metadata needed to ground the final summary

What prompt is used:

* a compact final prompt asking for a session-wide summary of tool performance
* the prompt must ask exactly for the fields of the fast tool final report schema and must require exactly one JSON object with no prose before or after it
* the prompt should ask specifically for tool-by-tool performance summary, repeated failure patterns, strongest follow-up candidates for richer analysis, and an overall session comment grounded in tool-use quality

What output schema is used:

* exactly the fast tool final report schema defined above

What gets removed from the context:

* the prompt user part for the final aggregation step
* the reasoning parts produced by the final aggregation step
* after the final artifact is accepted, any transient synthesis-only context can be excluded because the workflow is complete

### Design constraints

The implementation should follow these constraints:

* do not introduce more public CLI or MCP surface than currently exists
* preserve backend ownership of runtime state and execution semantics
* keep the frontend thin
* keep machine-readable artifacts stable and explicit
* do not force future benchmark workflows into session-analysis-specific naming or assumptions
* prefer composition of workflow pieces over deep inheritance from one base class

### Suggested implementation direction

The implementation will likely need a split roughly along these lines:

* a generic execution shell that knows how to initialize, persist cursor state, resume, and emit execution events
* one or more workflow definitions that decide how to plan work and which steps to run
* reusable step units that can declare both execution behavior and post-step context policy
* resource files for authored prompts or rubrics where this improves maintainability

For session-analysis workflows specifically, the first useful split is likely between:

* subject indexing and evidence planning
* packet or work-unit assessment
* turn or tool aggregation
* final session aggregation

The full and fast session-analysis workflows should share pieces where it is genuinely natural, but they should not be forced to share prompt structure or report schema when that creates awkward abstractions.

### Explicit non-goals

The following are not required as part of this task unless they become necessary to land the refactor cleanly:

* implementing benchmark analysis workflows
* unifying every existing session type behind one brand new runtime layer in a single change
* exposing new shared operations in CLI or MCP
* designing a plugin system for third-party workflow packs

### Acceptance criteria

This task is complete when all of the following are true:

* the original full session analysis still works through the scheduler and existing backend routes
* fast session analysis can be launched and executed end to end
* fast tool analysis can be launched and executed end to end
* the code no longer relies on one monolithic analysis runner as the only viable way to add another workflow
* step-level context cleanup is owned by the step or workflow contract that introduced the context rather than by an unrelated later step
* the implementation direction clearly supports future workflow families with different inputs and outputs
* prompts and related authored resources are in a more maintainable structure than before
* focused tests cover the preserved full workflow, fast session analysis, and fast tool analysis

### Open design questions to resolve during specification

The following points still need explicit decisions during the detailed design and implementation work:

* what the best naming is for the generic executable unit: session, run, workflow run, or agent run
* whether the second workflow should have its own session subtype, workflow kind, or another explicit discriminator
* how much of the primary-session runtime path should be aligned now versus in a follow-up task
* how prompts should be stored on disk and loaded at runtime