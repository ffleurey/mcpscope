We need to update our application's LLM streaming logic. Currently, the application works perfectly with LMStudio, but it fails to capture and display the "reasoning" or "thinking" traces when streaming from OpenRouter and Ollama using models that support chain-of-thought (like DeepSeek R1, Qwen 3, or OpenAI's o-series). 

Your task is to update our API request payloads and our stream parsing loop to natively support the specific reasoning fields required by OpenRouter and Ollama. 

Below are the concepts, payload specifications, and official documentation links you need to implement this.

### 1. OpenRouter Implementation
OpenRouter separates reasoning tokens from standard content tokens. Standard OpenAI SDKs often miss these tokens because they only look for `delta.content`.

**Request Payload:**
To request reasoning tokens, we need to add the `include_reasoning: true` flag, or the newer `reasoning` object to our request body.
Example:
```json
{
  "model": "deepseek/deepseek-r1",
  "messages": [{"role": "user", "content": "..."}],
  "stream": true,
  "include_reasoning": true
}

Stream Response Parsing:
When streaming, OpenRouter sends the thinking tokens in a custom delta.reasoning field. Once thinking is complete, it switches to sending the final answer in the standard delta.content field.
The parsing logic must check for:
chunk.choices[0].delta.reasoning

Documentation Links:

    OpenRouter Reasoning Tokens Guide: https://openrouter.ai/docs/guides/best-practices/reasoning-tokens

2. Ollama Implementation

Ollama similarly separates the thinking trace from the final content block.

Request Payload:
We must include the think parameter in the request payload. For most models, this is a boolean (think: true), but for some models it accepts a string ("low", "medium", "high").
Example:
JSON

{
  "model": "deepseek-r1",
  "messages": [{"role": "user", "content": "..."}],
  "stream": true,
  "think": true
}

Stream Response Parsing:
When streaming via Ollama's chat API (/api/chat), the thinking tokens are sent in a custom message.thinking field. Once thinking completes, the final answer arrives in message.content.
The parsing logic must check for:
chunk.message.thinking

Documentation Links:

    Ollama Thinking Capabilities Guide: https://docs.ollama.com/capabilities/thinking

    Ollama Chat API Reference: https://docs.ollama.com/api/chat

Task Requirements:

    Inspect our current stream parsing loop.

    Update the API request builders to dynamically inject include_reasoning: true (for OpenRouter) and think: true (for Ollama) when those providers are selected.

    Update the stream chunk parser to look for delta.reasoning (OpenRouter) and message.thinking (Ollama), alongside standard content fields.

    Ensure the UI/output correctly streams and distinguishes the "thinking" trace from the final "content" answer.

Please review our streaming implementation and propose the necessary code changes.
