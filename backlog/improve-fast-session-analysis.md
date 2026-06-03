# Improvement / simplifiaction of sesison analysis


## Idea / Goal

I would like to do some simplification in the way we have implemented analysis sessions. One of the problem is that we have implemnted different ways of doing the analysis (which is good and required) and then each different analysis strategy has different evaluation turns for which we are specifying prompts and output formats. Each of the prompt has different sets of variables which need to be replaces.

The result is that for each promt and turn we have dedicated code to replace variables and we have specific output formats which need to be consistent between what is in the prompt, in the schema validation, etc.

This make making any change very error prone and it make the impelmentation very heavy if any new type of turn of analysis session need to be created. This is not a good framework.

We need to find a better way of impelmenting this. My ideas are:
* Use only one geenric JSON format for the evaluation output. Abstract from what we have done, potentially have some optional parameters that are not always used but stick with one data structure which is reused for all evealuation outputs.
* Use a sort of template mechanisms (or use an existing template library or approch) to geenrate the prompts.

## Consolidated proposed schema:

```json
{
    "subject_scope": "tool_call, turn, session, other", // this field should be free text and will be populated in the prompt
    "subject_id": "string", // this field should be free text and will be populated in the prompt
    "evaluation_focus": "string",
    "reasoning": "string",
    "verdict": "pass|partial|fail|unclear", // this should be a strict ennumeration
    "score": 0, // we use a 0 to 5 
    "evidence_part_id": "string|null" // Optional, no validation
}
```


## Prompt to be used - example

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
    "subject_scope": "tool_call ${params.toolCallWithParams}",
    "subject_id": "${params.targetId}",
    "evaluation_focus": "Model execution accuracy vs. MCP tool description quality.",
    "reasoning": "Explain step-by-step why this score was given. Explicitly state whether any issues found were the fault of the model or the fault of the MCP tool's design.",
    "verdict": "pass|partial|fail|unclear",
    "score": 0,
    "evidence_part_id": "Quote specific text from the tool description, session context, or previous tool calls that justifies your reasoning and include the corresponding part IDs"
}
`;
```

params.toolCallWithParams = "ha_history_get_state {"id":"GTXT.1.3.2-T"}" // as an example

## Prompt implementation

As part of the impelmentation we will stop having prompts as separate text file and re-inject them in the code.

Instead of keeping prompts in .txt files, move them to .ts files as functions that return template literals. This gives you type safety, meaning your compiler will catch if you forget to pass a required variable to your prompt.

This is the most robust approach for a TS backend because you get full IDE autocompletion and zero extra dependencies.