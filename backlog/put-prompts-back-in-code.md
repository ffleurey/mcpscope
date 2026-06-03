To better manage our prompt and making them easy to edit and to manage the variable they contain we should use one of the 2 appraoches bellow:


1. The TypeScript Native Way (Highly Recommended)

Instead of keeping prompts in .txt files, move them to .ts files as functions that return template literals. This gives you type safety, meaning your compiler will catch if you forget to pass a required variable to your prompt.

This is the most robust approach for a TS backend because you get full IDE autocompletion and zero extra dependencies.
TypeScript

// evaluationPrompts.ts

export interface ToolEvalParams {
  targetId: string;
  toolSchema: string;
  toolInput: string;
}

export const getToolEvaluationPrompt = (params: ToolEvalParams): string => `
You are an expert LLM evaluator. Your task is to evaluate a single tool call.

<Tool_Schema>
${params.toolSchema}
</Tool_Schema>

<Model_Input>
${params.toolInput}
</Model_Input>

Evaluate tool call: ${params.targetId}.
Criteria: Did the model pass the correct arguments according to the schema?
Output your response using the standard JSON evaluation schema.
`;

2. The Handlebars Approach (Best for separating text from code)

If you specifically want to keep your prompts as pure text files (perhaps so non-developers or prompt engineers can edit them without touching TypeScript), a templating engine like Handlebars (npm install handlebars) is the industry standard.

Handlebars allows you to use {{variable}} syntax, but more importantly, it handles loops and conditionals, which is incredibly useful for injecting arrays of chat history.

Your text file (tool_eval.hbs):
Plaintext

You are an expert LLM evaluator. 

{{#if systemContext}}
Here is the system context:
{{systemContext}}
{{/if}}

Here is the tool input to evaluate:
{{toolInput}}

Your TypeScript code:
TypeScript

import * as fs from 'fs';
import Handlebars from 'handlebars';

// Read the file once during startup
const templateFile = fs.readFileSync('./prompts/tool_eval.hbs', 'utf-8');
const compiledPrompt = Handlebars.compile(templateFile);

// Generate the prompt dynamically
const finalPrompt = compiledPrompt({
  systemContext: "The user is asking about weather.",
  toolInput: '{"location": "Bærum"}'
});