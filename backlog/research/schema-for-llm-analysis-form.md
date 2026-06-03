# Improvement / simplifiaction of sesison analysis


## Idea / Goal

I would like to do some simplification in the way we have implemented analysis sessions. One of the problem is that we have implemnted different ways of doing the analysis (which is good and required) and then each different analysis strategy has different evaluation turns for which we are specifying prompts and output formats. Each of the prompt has different sets of variables which need to be replaces.

The result is that for each promt and turn we have dedicated code to replace variables and we have specific output formats which need to be consistent between what is in the prompt, in the schema validation, etc.

This make making any change very error prone and it make the impelmentation very heavy if any new type of turn of analysis session need to be created. This is not a good framework.

We need to find a better way of impelmenting this. My ideas are:
* Use only one geenric JSON format for the evaluation output. Abstract from what we have done, potentially have some optional parameters that are not always used but stick with one data structure which is reused for all evealuation outputs.
* Use a sort of template mechanisms (or use an existing template library or approch) to geenrate the prompts.

## Inventory of the different schemas we have (for all analysis)

### Shared across all analysis workflows

- `analysis.analysis_target.v1` - the target/session scope and analysis criteria used by every analysis workflow.
- `analysis.diagnostic.v1` - error/debug artifacts written when a bounded turn cannot parse, validate, or reconcile its response.

### Full Session Analysis (`full_session_analysis`)

- `analysis.evidence_packet_index.v1` - the ordered packet list produced during bootstrap and consumed by the per-packet assessment loop.
- `analysis.tool_call_assessment.v1` - per-tool-call evaluation output for the full-session workflow.
- `analysis.turn_summary.v1` - turn-level synthesis of the per-tool-call assessments.
- `analysis.final_analysis_report.v1` - the final aggregate report for the full-session workflow.

### Fast Session Analysis (`fast_session_analysis`)

- `analysis.evidence_packet_index.v1` - reused from the shared bootstrap output to drive the fast per-packet loop.
- `analysis.fast_session_tool_call_assessment.v1` - fast per-tool-call evaluation output.
- `analysis.fast_session_turn_summary.v1` - fast turn-level synthesis output.
- `analysis.fast_session_final_analysis_report.v1` - the final aggregate report for the fast-session workflow.

### Fast Tool Analysis (`fast_tool_analysis`)

- `analysis.fast_tool_work_index.v1` - grouped work-unit index created by the fast-tool planning step.
- `analysis.fast_tool_group_assessment.v1` - grouped assessment output for a work unit / tool bundle.
- `analysis.fast_tool_final_report.v1` - the final aggregate report for the fast-tool workflow.



## Proposed consolidated schema (much simple and more generic)

### Proposal: one generic evaluation result

I think the common shape should be a single reusable evaluation result object, with the prompt and context deciding what the model should inspect and the schema only capturing the result in a generic way.

Suggested shape:

```json
{
	"schema_key": "analysis.evaluation_result.v1",
	"evaluation_kind": "single_item|grouped_item|turn_summary|final_summary",
	"subject_type": "tool_call|turn|work_unit|session",
	"subject_ids": {
		"turn_id": "string|null",
		"round_id": "string|null",
		"tool_call_part_id": "string|null",
		"work_unit_id": "string|null"
	},
	"overall_status": "pass|partial|fail|unclear",
	"overall_severity": "none|low|medium|high|critical",
	"confidence": "low|medium|high|unclear",
	"primary_reason": "string",
	"summary": "string",
	"observations": [
		{
			"label": "string",
			"status": "pass|partial|fail|unclear",
			"detail": "string",
			"evidence_part_ids": ["string"]
		}
	],
	"strengths": ["string"],
	"issues": [
		{
			"category": "parameters|tool_surface|documentation|workflow|performance|output_quality|other",
			"severity": "low|medium|high|critical",
			"description": "string",
			"evidence_part_ids": ["string"]
		}
	],
	"recommendations": [
		{
			"priority": "low|medium|high",
			"recommendation": "string"
		}
	],
	"metrics": {
		"total_items": 0,
		"passed_items": 0,
		"partial_items": 0,
		"failed_items": 0
	},
	"notes": ["string"]
}
```

Why this shape:

- It keeps the output generic enough for every workflow.
- It reuses the same objective axes everywhere: status, severity, confidence, evidence, and recommendations.
- It still allows richer feedback through free-text summary fields and issue descriptions.
- It avoids encoding workflow-specific meaning directly in the schema, so the prompt/context can define the evaluation task instead.
- It is close to the current fast-session tool-call assessment style, but broader and easier to reuse.

Possible simplifications:

- `evaluation_kind` and `subject_type` may be enough if we want to keep the shape smaller.
- `metrics` can stay optional if a specific evaluation does not naturally produce counts.
- `issues` and `observations` could be collapsed into one array if we want an even thinner schema.

Suggested mapping from the current schemas:

- `analysis.fast_session_tool_call_assessment.v1` maps well to `subject_type=tool_call` with one observation per item.
- `analysis.fast_session_turn_summary.v1` maps to `subject_type=turn` with turn-level observations and follow-up recommendations.
- `analysis.fast_session_final_analysis_report.v1` maps to `subject_type=session` with aggregate metrics and broader recommendations.
- The full-session and fast-tool schemas can also fit this form, but their workflow-specific labels would move into the prompt/context rather than the output schema.

If we want to pursue this, the next step should be to define the generic schema first and then retrofit the prompts and validators to emit it consistently.


### Alternative proposal

In the field of LLM-as-a-Judge evaluations, shifting the complexity from the output schema to the evaluation prompt is a proven pattern. It reduces code duplication, simplifies your parsing logic, and makes storing evaluation metrics in a database much easier.

Exampe:

{
  "target_scope": "tool_call", 
  "target_id": "step_4_weather_api",
  "criteria_evaluated": "Did the model pass the correct location parameters to the tool?",
  "chain_of_thought": "The user asked for the weather in Bærum. The model called the weather_api tool. Looking at the tool arguments, the model passed 'Oslo' instead of 'Bærum'. Therefore, the tool call failed the criteria.",
  "score": 0,
  "passed": false,
  "flags": ["hallucinated_argument"]
}

Schema Field Breakdown:

* target_scope (Enum): Defines the level of the evaluation (e.g., tool_call, turn, session).
* target_id (String): A unique identifier for what is being evaluated so you can join the evaluation back to your logs (e.g., a specific tool call ID or a turn number).
* criteria_evaluated (String): The SLM repeats back what it was asked to evaluate. This helps ground the SLM and acts as metadata for your database.
* chain_of_thought (String): Critically important for SLMs. This must appear before the score in the schema. Forcing the SLM to write its reasoning before making a judgment significantly improves accuracy and reduces hallucinations.
* score (Integer/Float): A standardized metric. You can define this in your prompt as binary (0 or 1) or a scale (1-5).
* passed (Boolean): A definitive pass/fail verdict, useful for automated testing thresholds.
* flags (Array of Strings): An optional list of specific anomalies (e.g., ["syntax_error", "unauthorized_tool"]). This gives you the flexibility to capture specific issues without changing the base schema.

### Third proposal

I think we can simplify even further for the shared schema if we want the model to focus on one judgment at a time and let the application calculate any counts, ratios, or rollups.

Suggested shape:

```json
{
	"schema_key": "analysis.evaluation_result.v1",
	"subject_scope": "tool_call|turn|work_unit|session",
	"subject_id": "string",
	"evaluation_focus": "string",
	"score": 0,
	"verdict": "pass|partial|fail|unclear",
	"confidence": "low|medium|high|unclear",
	"severity": "none|low|medium|high|critical",
	"reasoning": "string",
	"qualitative_summary": "string",
	"recommendation": "string|null",
	"evidence_part_id": "string|null"
}
```

Why I think this is a good fit:

- It keeps the model focused on one evaluation target instead of asking it to produce nested breakdowns.
- It works for aggregation turns because the prompt can define the focus as a turn, work unit, or session-level question.
- It avoids arrays entirely, so we can derive counts, success ratios, and other rollups in code from the stored results.
- It keeps the LLM on the qualitative part of the task: deciding whether the target meets the stated criteria and explaining why.
- It is easier to validate, easier to store, and easier to migrate across different analysis styles.

My bias would be to use this as the actual common v1 if we want the broadest reuse with the least schema surface area.

### Consolidated proposal (#4):

Here is a proposal with some simplifications to avoid redundant and unreliable fields.

**the order of the field matters a lot to force the chain of thought**

```json
{
    "subject_scope": "tool_call|turn|work_unit|session",
    "subject_id": "string",
    "evaluation_focus": "string",
    "analysis_and_reasoning": "string", 
    "verdict": "pass|partial|fail|unclear",
    "score": 0,
    "evidence_extracted": "string|null" 
}
```

Why this performs better:

* Forced Chain of Thought: The model reads the focus, writes its analysis, and then commits to a verdict and score.
* Zero Redundancy: By merging summary and reasoning, you save tokens and get a more cohesive paragraph.
* No Conditionals: It removes severity and recommendation so the model doesn't have to invent problems for successful turns.
* Safer Evidence Extraction: Changed evidence_part_id to evidence_extracted. SLMs struggle to map abstract ID strings to specific text blocks correctly. It is much easier for an SLM to simply quote the text (e.g., "The model passed 'Norway' instead of 'Oslo'") than to output an exact internal part_id.


### Consolidated proposal (#5):

```json
{
    "subject_scope": "tool_call|turn|session|other", // this field should be free text and will be populated in the prompt
    "subject_id": "string", // this field should be free text and will be populated in the prompt
    "evaluation_focus": "string",
    "reasoning": "string",
    "verdict": "pass|partial|fail|unclear", // this should be a strict ennumeration
    "score": 0, // we use a 0 to 5 
    "evidence_part_id": "string|null" // Optional, no validation
}
```

Typescript pseudo code (to be adapted for our specific code) which shows have to instruct the model to do the evaluation and how to use the output format.

```ts
export interface ToolCallEvalParams {
  targetId: string;
  toolName: string;
  toolDescription: string; // Inject the MCP tool definition here
  toolPayload: string;
  sessionContext: string;  // Inject recent chat history or previous tool calls here
}

export const getToolEvaluationPrompt = (params: ToolCallEvalParams): string => `
You are an expert evaluator assessing the interaction between an AI model and an MCP (Model Context Protocol) server. 

Your task is to evaluate BOTH how well the model utilized the tool AND the quality, clarity, and design of the tool provided by the MCP server.

### 1. Context to Evaluate
<Session_Context>
${params.sessionContext}
</Session_Context>

<Tool_Definition>
Name: ${params.toolName}
Description and Schema:
${params.toolDescription}
</Tool_Definition>

<Tool_Call_Execution id="${params.targetId}">
${params.toolPayload}
</Tool_Call_Execution>

### 2. Evaluation Focus
Analyze the execution from two angles:
- **Model Performance:** Did the model pass the correct arguments based on the context? Did it hallucinate?
- **MCP Server Quality:** Is the tool description clear? Does the schema make sense? If the model failed, was it the model's fault, or was the tool's description ambiguous or misleading?

### 3. Evaluation Rubric
Assign a score and verdict according to this exact rubric:

*   **Score 5 (Verdict: pass):** Flawless execution. The tool description is crystal clear, and the model perfectly formatted the call.
*   **Score 4 (Verdict: partial):** Good execution, but the tool description could be slightly tighter, or the model included unnecessary (but harmless) arguments.
*   **Score 3 (Verdict: partial):** The tool call succeeded, but the MCP tool description is ambiguous, forcing the model to guess or infer parameters. 
*   **Score 2 (Verdict: fail):** The tool call failed primarily because the MCP server's tool description or schema is poorly designed, missing constraints, or misleading.
*   **Score 1 (Verdict: fail):** The tool call failed primarily due to the model's error (hallucinated arguments, ignored explicit instructions).
*   **Score 0 (Verdict: fail):** Complete system failure, malformed JSON, or broken context.

### 4. Output Format
You must output a single JSON object exactly matching the schema below. Do not output any markdown formatting or extra text.

{
    "subject_scope": "tool_call",
    "subject_id": "${params.targetId}",
    "evaluation_focus": "Model execution accuracy vs. MCP tool description quality.",
    "reasoning": "Explain step-by-step why this score was given. Explicitly state whether any issues found were the fault of the model or the fault of the MCP tool's design.",
    "verdict": "pass|partial|fail|unclear",
    "score": 0,
    "supporting_evidence": "Quote specific text from the tool description, session context, or previous tool calls that justifies your reasoning."
}
`;
```