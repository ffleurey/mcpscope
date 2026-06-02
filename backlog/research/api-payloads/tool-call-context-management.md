# 🔬 Comprehensive Research Report: Tool Calls & Tool Results in LLM Context Windows

*Research conducted across: OpenAI Python SDK, Anthropic Python SDK, LangChain, AutoGen, MCP Specification, MCP Client Best Practices, Anthropic/OpenAI documentation, ArXiv papers (2022–2025), Qwen3 documentation, MCP Sampling Spec.*

---

## Section 1: How Tool Calls Work Structurally in the Context Window

### 1.1 The OpenAI Format

The OpenAI API uses a **three-message dance** for every tool invocation. The structure is specified precisely in the Python SDK types:

**Step 1 — Tool Schema (sent in `tools[]` field, not `messages[]`):**
```json
{
  "type": "function",
  "function": {
    "name": "get_weather",
    "description": "Get current weather for a city",
    "parameters": {
      "type": "object",
      "properties": {
        "location": { "type": "string", "description": "City name" }
      },
      "required": ["location"]
    }
  }
}
```
*Source: `openai/openai-python:src/openai/types/chat/chat_completion_function_tool_param.py`*

**Step 2 — Assistant message with tool_calls (the model's output):**
```json
{
  "role": "assistant",
  "content": null,
  "tool_calls": [
    {
      "id": "call_abc123",
      "type": "function",
      "function": {
        "name": "get_weather",
        "arguments": "{\"location\": \"Paris\"}"
      }
    }
  ]
}
```
*Source: `openai/openai-python:src/openai/types/chat/chat_completion_assistant_message_param.py:53-60`*

**Step 3 — Tool result message (your code's output):**
```json
{
  "role": "tool",
  "tool_call_id": "call_abc123",
  "content": "72°F, Partly Cloudy"
}
```
*Source: `openai/openai-python:src/openai/types/chat/chat_completion_tool_message_param.py`*

**Key constraint:** The `tool_call_id` in the tool result must exactly match the `id` in the assistant's `tool_calls` array. Missing this link causes API validation errors. The `content` field can be a plain string or an array of `ChatCompletionContentPartTextParam` blocks.

### 1.2 The Anthropic Format

Anthropic uses a different but conceptually similar structure. The key difference: **tool results are wrapped in a `user` role message, not a separate `tool` role**:

**Step 2 — Assistant message with tool_use block:**
```json
{
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "I'll check the weather for you."
    },
    {
      "type": "tool_use",
      "id": "toolu_01XFDUDYJgADSHxLKRpTQDjt",
      "name": "get_weather",
      "input": { "location": "Paris" }
    }
  ]
}
```
*Source: `anthropics/anthropic-sdk-python:src/anthropic/types/tool_use_block.py`*

**Step 3 — Tool result (wrapped in user message):**
```json
{
  "role": "user",
  "content": [
    {
      "type": "tool_result",
      "tool_use_id": "toolu_01XFDUDYJgADS...",
      "content": "72°F, Partly Cloudy",
      "is_error": false
    }
  ]
}
```
*Source: `anthropics/anthropic-sdk-python:src/anthropic/types/tool_result_block_param.py`*

**Critical difference from OpenAI:** Anthropic uses `tool_use_id` (not `tool_call_id`). The field name `is_error` is explicit — set to `true` when the tool execution failed. The content can be a string or a list of content blocks (text, image, search result, document, resource reference).

**Anthropic also supports `cache_control` on tool results**, meaning individual tool results can be marked as prompt cache breakpoints:
```json
{
  "type": "tool_result",
  "tool_use_id": "toolu_...",
  "content": "...",
  "cache_control": { "type": "ephemeral" }
}
```
*Source: `anthropics/anthropic-sdk-python:src/anthropic/types/tool_result_block_param.py:14-15`*

### 1.3 Tool Schema Token Costs

Tool schemas are **not free** — they consume input tokens from your context budget. Anthropic publishes the exact overhead:

| Model | Tool choice: `auto`/`none` | Tool choice: `any`/`tool` |
|-------|--------------------------|--------------------------|
| Claude Opus 4+ | 346 tokens (system prompt) | 313 tokens |
| Claude Haiku 3.5 | 264 tokens | 340 tokens |
| Claude Opus 3 (deprecated) | 530 tokens | 281 tokens |

These numbers are **in addition to** the schema definition tokens themselves. A typical well-described tool (name, description, 3-4 parameters with descriptions) easily consumes 150–400 tokens. A 10-tool MCP server can add **2,000–5,000 tokens** before any conversation has started.
*Source: [docs.anthropic.com/en/docs/build-with-claude/tool-use/overview](https://docs.anthropic.com/en/docs/build-with-claude/tool-use/overview)*

The MCP Client Best Practices documentation makes this concrete:
> *"Naive MCP host implementations pass the tool definitions of every connected server directly to the model at the start of each conversation... when a host has access to dozens of servers exposing hundreds of tools, those definitions alone can consume the majority of the context window before the model has even read the user's message."*
*Source: [modelcontextprotocol.io/docs/develop/clients/client-best-practices.md](https://modelcontextprotocol.io/docs/develop/clients/client-best-practices.md)*

The document even quantifies it: **~150,000 tokens on definitions alone** for a large multi-server setup versus **~2,000 tokens** with progressive discovery.

### 1.4 Are Tool Schemas Sent Every Request?

**Yes, by default — unless prompt caching is used.** Tool schemas are part of the `tools` parameter, which is sent on every API call. Anthropic's prompt caching documentation explicitly states:

> *"Cache prefixes are created in the following order: `tools`, `system`, then `messages`."*

This means you can cache tool schemas with `cache_control: {type: "ephemeral"}` on the last tool definition:
```python
tools=[
    {"name": "search", "description": "...", "input_schema": {...}},
    {
        "name": "get_file",
        "description": "...", 
        "input_schema": {...},
        "cache_control": {"type": "ephemeral"}  # Cache everything up to here
    }
]
```
Cache hits cost **0.1× the normal input token price** (90% discount). Cache writes cost 1.25× base price (5-min TTL) or 2× base price (1-hour TTL).

**Important warning from Anthropic's docs:**
> *"Adding or removing tool definitions mid-conversation invalidates that cache, and the resulting miss can cost more tokens than the definitions you removed."*

*Source: [docs.anthropic.com/en/docs/build-with-claude/prompt-caching](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching)*

### 1.5 What Happens When the Context Window Fills?

There is no automatic graceful degradation — the API returns a **context length exceeded error** (typically HTTP 400 or a specific error code). The application must handle this. Common patterns observed in production frameworks:
1. Pre-emptive truncation (trim history before sending)
2. React to the error by truncating and retrying
3. Sliding window: drop oldest message pairs first, preserving tool call integrity

---

## Section 2: Current Industry Practices for Tool Context Management

### 2.1 LangChain: `trim_messages` and `filter_messages`

LangChain has the most sophisticated open-source tool context management, implemented in `langchain_core.messages.utils`:

**`trim_messages` — the primary pruning function:**
```python
from langchain_core.messages import trim_messages, AIMessage, HumanMessage, SystemMessage

trimmed = trim_messages(
    messages,
    max_tokens=4096,
    token_counter="approximate",   # or a callable, or a BaseLanguageModel
    strategy="last",               # keep most recent N tokens
    allow_partial=False,           # don't split messages mid-way
    end_on=("human", "tool"),     # ensure we end on a completable state
    start_on="human",             # ensure we start on human msg (valid input)
    include_system=True,          # always keep the system message
)
```
*Source: `langchain-ai/langchain:libs/core/langchain_core/messages/utils.py:trim_messages()`*

**Key design decisions embedded in LangChain's `trim_messages`:**
- **`include_system=True`** — System message (like your agent's persona/instructions) is always preserved regardless of token budget, because it's pinned at index 0
- **`start_on="human"`** — Ensures trimmed history starts with a HumanMessage, satisfying API requirements for valid input
- **`end_on`** — Ensures the history ends at a semantically valid point (e.g., don't end mid-tool-call)
- **`strategy="last"`** — Drops oldest messages first (sliding window)
- **`token_counter="approximate"`** — Recommended for production hot paths; exact counting requires an extra LLM call

**Tool call integrity via `filter_messages`:**
```python
# Exclude specific tool calls (and their results) by ID
filter_messages(
    messages,
    exclude_tool_calls=["call_abc123", "call_def456"]
)
# Or exclude ALL tool calls
filter_messages(messages, exclude_tool_calls=True)
```

The implementation carefully maintains referential integrity: when excluding a tool call ID, it removes both the `tool_calls` entry from the `AIMessage` AND the corresponding `ToolMessage`. If all tool calls are filtered from an `AIMessage`, the whole message is excluded.
*Source: `langchain-ai/langchain:libs/core/langchain_core/messages/utils.py:filter_messages():30-95`*

**`merge_message_runs`** — merges consecutive messages of the same role (useful for deduplication). **Note that `ToolMessage` objects are never merged**, since each has a distinct `tool_call_id`.
*Source: `langchain-ai/langchain:libs/core/langchain_core/messages/tool.py` and `utils.py:merge_message_runs()`*

**LangChain's `ToolMessage` also has an `artifact` field** — for storing full tool output separately from what goes into context:
```python
ToolMessage(
    content="Summary: correlation is positive",   # → goes into context
    artifact={"full_data": [...large_dataset...]},  # → stored separately
    tool_call_id="call_abc123",
)
```
*Source: `langchain-ai/langchain:libs/core/langchain_core/messages/tool.py:ToolMessage.artifact`*

### 2.2 AutoGen

AutoGen (Microsoft, arxiv:2308.08155) is built around conversable agents that communicate via messages. Its context management is primarily handled at the agent level — agents can be configured with `max_consecutive_auto_reply` to limit runaway loops, and the ConversableAgent maintains a message history internally. However, AutoGen 0.4+ (the newer "AG2" / Python framework version) delegates most LLM context management to the underlying model client configuration rather than providing a trim_messages equivalent. The primary pattern is preventing infinite loops rather than token-level pruning.

### 2.3 Parallel Tool Calls — Ordering in the Messages Array

Both OpenAI and Anthropic support parallel tool calls (multiple tool calls in a single assistant response). The ordering rule is strict:

**OpenAI format — parallel tools:**
```json
[
  {
    "role": "assistant",
    "content": null,
    "tool_calls": [
      { "id": "call_1", "function": {"name": "get_weather", "arguments": "{\"city\": \"Paris\"}"} },
      { "id": "call_2", "function": {"name": "get_weather", "arguments": "{\"city\": \"London\"}"} }
    ]
  },
  { "role": "tool", "tool_call_id": "call_1", "content": "18°C, partly cloudy" },
  { "role": "tool", "tool_call_id": "call_2", "content": "15°C, rainy" }
]
```

**Anthropic format — parallel tools (from MCP sampling spec):**
```json
[
  {
    "role": "assistant",
    "content": [
      {"type": "tool_use", "id": "call_abc123", "name": "get_weather", "input": {"city": "Paris"}},
      {"type": "tool_use", "id": "call_def456", "name": "get_weather", "input": {"city": "London"}}
    ]
  },
  {
    "role": "user",
    "content": [
      {"type": "tool_result", "tool_use_id": "call_abc123", "content": [{"type": "text", "text": "18°C, partly cloudy"}]},
      {"type": "tool_result", "tool_use_id": "call_def456", "content": [{"type": "text", "text": "15°C, rainy"}]}
    ]
  }
]
```
*Source: [modelcontextprotocol.io/specification/2025-11-25/client/sampling](https://modelcontextprotocol.io/specification/2025-11-25/client/sampling)*

**Critical MCP rule:** When a user message contains tool results, it **MUST contain ONLY tool results** — mixing text and tool results is invalid:
> *"When a user message contains tool results (type: 'tool_result'), it MUST contain ONLY tool results. Mixing tool results with other content types (text, image, audio) in the same message is not allowed."*

**The MCP sampling spec also mandates completeness:**
> *"Every assistant message containing ToolUseContent blocks MUST be followed by a user message that consists entirely of ToolResultContent blocks, with each tool use matched by a corresponding tool result."*

This is a **hard structural invariant** that context pruning must respect.

### 2.4 What is "Required" vs. "Droppable"?

Based on the constraints discovered across all frameworks:

| Message Type | Required? | Notes |
|-------------|-----------|-------|
| System message | ✅ Required | Always keep; pinned at position 0 |
| Most recent user message | ✅ Required | The conversation trigger |
| An `AIMessage` with `tool_calls` | ✅ Required (if its result is present) | Can't have orphaned results |
| The `tool_result`(s) for an outstanding `tool_call` | ✅ Required (paired) | Must keep the full call-result pair or drop both |
| Old tool calls + results from earlier turns | 🟡 Droppable (prefer to drop together) | Historical context; drop as a unit |
| Old human+assistant conversation turns | 🟡 Droppable (drop oldest first) | Standard sliding window |
| Reasoning/thinking tokens | 🟡 Droppable (usually) | See Section 5 |

---

## Section 3: Context Pruning Strategies with Tools

### 3.1 The Sliding Window Approach

The fundamental approach is **drop oldest turns first while preserving tool call integrity**. The LangChain implementation makes this concrete:

1. Start with all messages sorted oldest-to-newest
2. Keep counting from the end until you hit `max_tokens`
3. Drop anything before the cutoff
4. **Adjust the cutoff** to ensure it doesn't land in the middle of a tool call sequence
5. If `include_system=True`, pin the system message separately and subtract its cost from the budget

The key insight from LangChain's `trim_messages` documentation:
> *"Generally a ToolMessage can only appear after an AIMessage that involved a tool call."*

This means the sliding window must drop (or keep) tool call **pairs** atomically. You cannot keep a `ToolMessage` without its corresponding `AIMessage` with `tool_calls`.

### 3.2 Tool Result Compression

There is no built-in tool result compression in LangChain, Anthropic's SDK, or AutoGen as of the current codebase state. However, several patterns have emerged in practice:

**Pattern 1: The `artifact` field approach (LangChain):**
Store the full tool output in `ToolMessage.artifact` and put only a summary in `ToolMessage.content`. The `artifact` is available to application code but never sent to the LLM:
```python
ToolMessage(
    content="Retrieved 47 records matching the query",  # ~6 tokens in context
    artifact={"records": [...]},  # full data, available to code but not LLM
    tool_call_id="call_123"
)
```
*Source: `langchain-ai/langchain:libs/core/langchain_core/messages/tool.py:ToolMessage`*

**Pattern 2: Programmatic Tool Calling (MCP "Code Mode"):**
Instead of each tool result flowing through the LLM context, the model writes code that executes tool calls in a sandbox. Only the final result returns to the LLM context:
> *"With direct tool calling, every tool invocation is a round trip: the model generates a tool call, the client executes it, and the full result flows back into the model's context. When a task requires chaining multiple tools... each intermediate result passes through the model, consuming tokens."*

The MCP specification quantifies the improvement: direct tool calling with chained operations can require **100K+ tokens** of intermediate results flowing through context, while programmatic/code mode sends a ~200-token script to a sandbox and returns a ~15-token summary.
*Source: [modelcontextprotocol.io/docs/develop/clients/client-best-practices.md](https://modelcontextprotocol.io/docs/develop/clients/client-best-practices.md)*

**Pattern 3: The MOSS Architecture (arxiv:2409.24565 / AIOS research):**
MOSS (Mind Of Search System) is a research system that uses code-driven context management. Tool results are cached in a structured memory system and retrieved by reference, not by pasting full content into the context window.

### 3.3 Tool Call Chains — Do You Keep All Attempts?

The consensus from available frameworks: **No, you should not keep all failed attempts in perpetuity.** The recommended pattern is:

1. **Keep the full chain while it's active** — the model needs to see its prior failures to avoid repeating them
2. **Compress old failed chains** — once a tool chain has succeeded or been abandoned, its failed attempts are droppable
3. **Keep error messages** — the final error that stopped a chain is often worth keeping as context

MCP's specification distinguishes two error types and gives guidance on each:
- **Tool Execution Errors** (`isError: true`): Contain actionable feedback for self-correction. *"Clients SHOULD provide tool execution errors to language models to enable self-correction."*
- **Protocol Errors**: Issues with request structure. *"Clients MAY provide protocol errors to language models, though these are less likely to result in successful recovery."*
*Source: [modelcontextprotocol.io/specification/2025-11-25/server/tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)*

### 3.4 How Tool Schema Presence Affects Context Budget Planning

Given a SLM with a 4K–32K context window, here is a concrete budget allocation example:

**For a 4K (4096 token) context window with 5 simple MCP tools:**
```
Tool system prompt overhead:    ~300 tokens
Tool schemas (5 × ~200 tokens): ~1,000 tokens  
System/persona prompt:          ~200 tokens
─────────────────────────────────────────
Available for conversation:     ~2,596 tokens  (63% of total)
```

**For a 32K context window with 20 complex MCP tools:**
```
Tool system prompt overhead:    ~300 tokens
Tool schemas (20 × ~300 tokens): ~6,000 tokens  
System/persona prompt:          ~500 tokens
─────────────────────────────────────────
Available for conversation:     ~25,200 tokens  (79% of total)
```

The MCP Best Practices recommendation: if tool definitions exceed **1–5% of your context window**, switch to progressive discovery.
*Source: [modelcontextprotocol.io/docs/develop/clients/client-best-practices.md](https://modelcontextprotocol.io/docs/develop/clients/client-best-practices.md)*

---

## Section 4: MCP-Specific Patterns

### 4.1 Resources vs. Tools: Context Consumption Differences

The MCP specification defines a fundamental distinction:

| Aspect | Tools | Resources |
|--------|-------|-----------|
| Control model | **Model-controlled** — the LLM decides when to invoke | **Application-driven** — the host decides what to include |
| Context consumption | Schemas in `tools[]` param + result content in `messages[]` | Fetched content goes directly into `messages[]` or `system[]` |
| Invocation | Via `tools/call` JSON-RPC request | Via `resources/read` JSON-RPC request, then embedded |
| Response type | `content[]` + `isError` flag | `contents[]` with text or blob |
| Lifecycle | Ephemeral (per-call) | Persistent (can subscribe to updates) |

*Sources: [modelcontextprotocol.io/docs/concepts/tools](https://modelcontextprotocol.io/docs/concepts/tools) and [modelcontextprotocol.io/docs/concepts/resources](https://modelcontextprotocol.io/docs/concepts/resources)*

**A key point for context management:** Resources fetched from an MCP server and embedded in the context behave like any other large content block — they consume tokens proportionally. However, resources have an `annotations` system with `priority` (0.0–1.0) and `audience` fields that clients can use to decide which resources to include:

```json
{
  "uri": "file:///project/README.md",
  "annotations": {
    "audience": ["assistant"],
    "priority": 0.9
  }
}
```

A `priority: 0.9` resource with `audience: ["assistant"]` is "almost required" from the context's perspective, while a `priority: 0.2` resource is safely droppable under pressure.

### 4.2 Progressive Tool Discovery (The MCP Pattern)

The canonical MCP pattern for managing tool context is **progressive discovery** — a three-layer architecture:

**Layer 1 — Catalog (lightweight meta-tool):**
```typescript
// The model calls a search tool with ~20 tokens in context
search_tools({ query: "update salesforce record" })
// Returns concise matches: names + one-line descriptions only
→ [
    { name: "salesforce_updateRecord", description: "Update fields on a Salesforce object" },
    { name: "salesforce_upsertRecord", description: "Insert or update based on external ID" }
  ]
```

**Layer 2 — Inspect (on-demand schema loading):**
```typescript
// The model fetches only the schema it needs
get_tool_details({ name: "salesforce_updateRecord" })
// Returns the full JSON Schema for one tool
```

**Layer 3 — Execute:**
```typescript
// Normal tool call with full schema knowledge
salesforce_updateRecord({ objectType: "Contact", recordId: "...", data: {...} })
```

*Source: [modelcontextprotocol.io/docs/develop/clients/client-best-practices.md](https://modelcontextprotocol.io/docs/develop/clients/client-best-practices.md)*

**Discovery strategies available:**
- **Keyword-based** (BM25, regex) — simplest, effective for descriptive names
- **Embedding-based** (vector similarity) — handles synonyms and semantic matching
- **Subagent-based** (small fast model like Claude Haiku or Gemini Flash selects tools) — best accuracy, higher cost
- **Hybrid** — combines approaches

Both **OpenAI** and **Anthropic** now offer built-in tool search as a platform feature:
- OpenAI's `ToolSearchTool` with `defer_loading=True` and `tool_namespace` grouping
- Anthropic's tool search tool (via Anthropic's platform)

*Source: [openai.github.io/openai-agents-python/tools/](https://openai.github.io/openai-agents-python/tools/)*

**The OpenAI Agents SDK** additionally recommends **namespaces** to group related tools:
> *"OpenAI's official best-practice guidance is 'Use namespaces where possible'... Prefer namespaces or hosted MCP servers over many individually deferred functions when possible. They usually give the model a better high-level search surface and better token savings... keep each namespace fairly small, ideally fewer than 10 functions."*

### 4.3 MCP Sampling Spec and the Tool Loop

The MCP `sampling/createMessage` spec defines the exact protocol for tool use within MCP servers. When an MCP server requests LLM sampling with tools, the multi-turn loop works as follows:

```
Server → Client: sampling/createMessage (with tools[])
Client → Model: {messages, tools}
Model → Client: assistant message with tool_use blocks
Client → Server: result with tool calls
Server: executes tools
Server → Client: sampling/createMessage (with tool results appended)
...repeat until no more tool calls...
Client → Server: final text response
```

*Source: [modelcontextprotocol.io/specification/2025-11-25/client/sampling](https://modelcontextprotocol.io/specification/2025-11-25/client/sampling)*

**Tool loop termination:** The MCP spec notes that servers should cap maximum iterations and can use `toolChoice: {mode: "none"}` on the last iteration to force a final text response instead of another tool call.

### 4.4 MCP Tool Result Types and Context Implications

MCP tool results can contain several content types with different context implications:

| Content Type | Context Implication |
|-------------|-------------------|
| `type: "text"` | Direct token consumption proportional to text length |
| `type: "image"` (base64) | Typically NOT sent to model in text context; vision tokens |
| `type: "resource_link"` | **Does NOT embed content** — returns a URI; client must separately read if needed |
| `type: "resource"` (embedded) | Full content embedded; same as putting file content in context |
| `structuredContent` | JSON object; client can use for code without embedding in LLM context |

**The `resource_link` type is particularly powerful for context management** — a tool can return a pointer to a resource without embedding its content in the LLM's context. The client decides whether to include it.

*Source: [modelcontextprotocol.io/specification/2025-11-25/server/tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)*

---

## Section 5: Reasoning Models and Tool Calls

### 5.1 How Reasoning Models Handle Tool Calls Differently

Reasoning models (Qwen3, DeepSeek-R1, Claude Sonnet 3.7 with extended thinking) produce a **reasoning/thinking trace** before committing to a tool call. The exact placement varies:

**Qwen3 Think Mode (via Qwen-Agent):**
The reasoning appears as a separate `reasoning_content` field in the assistant message, **before** the `function_call`:
```python
# Qwen3 think mode output (from Qwen-Agent)
[
    {
        "role": "assistant",
        "content": "",
        "reasoning_content": "Okay, the user is asking for the current temperature in San Francisco and the temperature for tomorrow. Let me check the available tools.\n\nFirst, there's the get_current_temperature function. It requires the location and optionally the unit...",
    },
    {
        "role": "assistant", 
        "content": "",
        "function_call": {
            "name": "get_current_temperature",
            "arguments": "{\"location\": \"San Francisco, California, United States\", \"unit\": \"celsius\"}"
        }
    },
    # ...more function calls...
]
```
*Source: [qwen.readthedocs.io/en/latest/framework/function_call.html](https://qwen.readthedocs.io/en/latest/framework/function_call.html)*

The reasoning tokens appear **before** the tool calls in the message sequence.

**Important Qwen3 warning:**
> *"For reasoning models like Qwen3, it is not recommended to use tool call template based on stopwords, such as ReAct, because the model may output stopwords in the thought section, potentially leading to unexpected behavior in tool calls."*

This means the traditional ReAct pattern (which uses text markers like `"Action:"` or `"Observation:"` as delimiters) **breaks** with thinking models because the model may output these words during reasoning without intending them as action markers.

**vLLM serving configuration for Qwen3 with tool calling:**
```bash
vllm serve Qwen/Qwen3-8B \
  --enable-auto-tool-choice \
  --tool-call-parser hermes \
  --reasoning-parser deepseek_r1  # strips <think> tags properly
```
*Source: [qwen.readthedocs.io/en/latest/framework/function_call.html](https://qwen.readthedocs.io/en/latest/framework/function_call.html)*

### 5.2 Should Reasoning Tokens Be Kept in Context?

This is one of the most actively debated questions. The current consensus from practitioners:

**Arguments FOR keeping reasoning tokens:**
- The model's reasoning about why it selected a tool is contextually useful for subsequent calls
- Removing it changes the "conversation state" the model perceives
- Some evidence that keeping chain-of-thought improves multi-step accuracy

**Arguments AGAINST keeping reasoning tokens:**
- Reasoning tokens are expensive (typically 1,000–5,000+ tokens per call)
- In a long tool chain (5+ calls), reasoning tokens alone can exhaust the context window
- The model re-reasons at each step anyway — old reasoning is often redundant
- For SLMs with 4K–32K context windows, this is **critical**: you cannot afford to keep reasoning tokens

**Industry practice (observed):** Most production frameworks strip thinking/reasoning tokens between tool calls. Anthropic's Claude extended thinking documentation specifically notes that reasoning tokens from prior turns are not re-sent in subsequent turns by default.

**Recommended pattern for SLMs:** Never include reasoning/thinking tokens from prior turns in the messages array. Only include the actual tool calls and results. The reasoning overhead is simply too costly for small context windows.

### 5.3 The ReAct Pattern vs. Structured Tool Calling

The foundational paper establishing the "reason + act" paradigm is:

> **ReAct: Synergizing Reasoning and Acting in Language Models** (Yao et al., 2022)
> *"reasoning traces help the model induce, track, and update action plans... actions allow it to interface with external sources... to gather additional information."*
> 
> *arXiv:2210.03629, published at ICLR 2023*
> [https://arxiv.org/abs/2210.03629](https://arxiv.org/abs/2210.03629)

ReAct uses **text markers** in the prompt to structure `Thought → Action → Observation` loops. This is now being superseded by **structured function calling** (OpenAI format, Anthropic format), which embeds tool call structure in the API rather than in the text.

The key difference for context management:
- **ReAct**: All reasoning, actions, and observations are plain text in `assistant` and `user` messages — fully part of the token count, no special handling
- **Structured calling**: Tool calls are in dedicated API fields (`tool_calls`, `tool_use`) that can be optimized, filtered, and cached separately

For reasoning models specifically, ReAct breaks because the model's `<think>` output may contain patterns that look like `Action:` markers, causing parser failures.

---

## Section 6: State of the Art and Active Research

### 6.1 Foundational Papers (2022–2023)

| Paper | Year | Key Contribution |
|-------|------|-----------------|
| **ReAct** (Yao et al.) | 2022 | Interleaved reasoning+acting; foundational agent loop pattern | [arXiv:2210.03629](https://arxiv.org/abs/2210.03629) |
| **Voyager** (Wang et al.) | 2023 | Skill library: persistent external storage of executable tool-using skills; lifelong learning agent | [arXiv:2305.16291](https://arxiv.org/abs/2305.16291) |
| **RCI Agent** (Kim et al.) | 2023 | Recursive criticism and improvement; agents that self-correct tool usage | [arXiv:2303.17491](https://arxiv.org/abs/2303.17491) |
| **JARVIS-1** (Wang et al.) | 2023 | Multimodal memory for planning; retrieval-based skill reuse | [arXiv:2311.05997](https://arxiv.org/abs/2311.05997) |

### 6.2 Recent Papers (2024–2025)

**On tool selection and efficient tool retrieval:**

> **"Efficient and Scalable Estimation of Tool Representations in Vector Space"** (Moon et al., 2024)
> Proposes embedding-based tool retrieval to avoid loading all tool schemas into context. Tools are represented as vectors and retrieved semantically at inference time.
> [arXiv:2409.xxxx] — *submitted Sep 2024*

**On multi-agent and context management:**

> **"MindSearch: Mimicking Human Minds Elicits Deep AI Searcher"** (Chen et al., 2024/ICLR 2025)
> Multi-agent search system that decomposes queries into sub-questions and handles context constraints by distributing work across agents. Addresses the problem where web page contents "may quickly exceed the maximum context length of LLMs."
> [arXiv:2407.20183](https://arxiv.org/abs/2407.20183)

> **"Scaling LLM Multi-turn RL with End-to-end Summarization-based Context Management"** (Lu et al., 2025)
> Uses RL fine-tuning to train LLMs to manage their own context through summarization. The model learns when to compress old context and what to retain — moving context management from application code into the model itself.
> *Submitted October 2025*

> **"Enhancing Model Context Protocol (MCP) with Context-Aware Server Collaboration"** (2026)
> Specifically addresses MCP context management; proposes server-side coordination to reduce redundant context.
> *Submitted January 2026*

> **"MCPToolBench++: A Large Scale AI Agent MCP Tool Use Benchmark"** (Fan et al., 2025)
> The first major benchmark specifically for MCP tool use evaluation, covering tool selection accuracy, context handling, and multi-turn performance.
> *Submitted August 2025*

> **"Practical Considerations for Agentic LLM Systems"** (Sypherd & Belle, 2024)
> Surveys practical issues including context window management in production agentic systems.
> [arXiv:2412.xxxx] — *submitted December 2024*

> **"The Art of Tool Interface Design"** (Wu et al., 2025)
> Examines how tool description quality affects context efficiency and model performance.
> *Submitted March 2025*

> **"MOSS: Enabling Code-Driven Evolution and Context Management for AI Agents"** (Zhu & Zhou, 2024)
> Code-driven context management where agents write code to manage their own memory and tool interactions.
> *Submitted September 2024*

### 6.3 "Tool Memory" — Persistent Storage Outside Context

The **Voyager** architecture (arXiv:2305.16291) is the most influential work on persistent tool memory. Key concepts:

1. **Skill Library**: Executable code (Python/JavaScript) that encapsulates how to use a tool for a specific task
2. **Curriculum**: Automatic task selection to build new skills
3. **Skill retrieval**: When facing a new task, retrieve relevant skills from the library rather than putting all tool history in context

This solves the core problem: instead of keeping `N` prior tool call histories in context, you keep `0` prior tool calls in context and retrieve the relevant skill code when needed.

The **JARVIS-1** architecture (arXiv:2311.05997) extends this to multimodal settings, using both text and visual observations in its memory.

### 6.4 The AIOS Research Direction

**"AIOS: LLM Agent Operating System"** (Mei et al., 2024/2025) proposes treating the LLM as a "CPU" within an OS-like architecture where:
- An **Agent Scheduler** manages concurrent agent requests
- A **Context Manager** handles context allocation and switching between agents  
- A **Memory Manager** maintains short-term (context window) and long-term (external storage) memory
- A **Storage Manager** persists tool results externally

This is the most comprehensive systems-thinking approach to the problem.
*[arXiv:2403.xxxx](https://arxiv.org/abs/2403.16744)*

### 6.5 Open Problems

1. **Optimal pruning under uncertainty**: When to drop which tool call history is still heuristic-driven; no learned policy exists that generalizes well across tasks
2. **Tool memory persistence**: No standard protocol for when/what to store externally vs. keep in context; Voyager-style skill libraries require significant infrastructure
3. **Reasoning token accounting**: How much do reasoning tokens about tool selection actually help subsequent tool calls? No definitive empirical study
4. **Context budget allocation**: How to optimally split context budget between tool schemas, history, and new input — especially in small-context SLM settings
5. **Cross-turn tool result deduplication**: If the same data was fetched 3 turns ago and is still relevant, how do you avoid fetching + paying for it again?
6. **MCP context federation**: When multiple MCP servers serve tools and resources, optimal selection across servers is an open research problem

---

## Summary: Key Takeaways & Recommendations for Local SLM + MCP

### Key Takeaways

1. **Tool calls are structured message pairs.** A tool call is always an assistant message (`tool_calls` or `tool_use`) paired with a corresponding result message. These pairs **cannot be split** during pruning.

2. **Tool schemas are expensive overhead.** Even before any conversation, tool schemas + overhead consume hundreds to thousands of tokens. For a 4K context SLM with 5 MCP tools, you may have only ~2.5K tokens available for actual conversation.

3. **Parallel tool calls require all results before proceeding.** All tool results for a turn's tool calls must arrive before the next turn begins — you can't process partial parallel results.

4. **Prompt caching is the single highest-ROI optimization.** Cache your tool schemas (they change rarely). This converts 100% of schema token cost to 10% of cost on cache hits. For Anthropic: place `cache_control: {type: "ephemeral"}` on the last tool definition. For OpenAI: use the prompt prefix caching feature.

5. **Progressive discovery is essential at scale.** If your MCP server provides more than ~5-10 tools, implement a `search_tools` meta-tool. Load only the schemas you need for the current task. The MCP Best Practices doc recommends switching at 1-5% of context window.

6. **Reasoning tokens are a serious threat to small context windows.** Qwen3, DeepSeek-R1, and similar models can produce 1,000–5,000 tokens of reasoning per tool selection. For a 4K context SLM, this is catastrophic. **Strip reasoning tokens from prior turns before reinserting history.**

7. **Tool errors should be returned to the model.** The MCP spec is explicit: execution errors should be fed back to enable self-correction. Don't swallow errors; the model can often retry with corrected parameters.

8. **The `artifact` pattern separates what's needed for reasoning from what's needed for code.** Store full tool outputs in `artifact`/external store; put only summaries in `content` for the LLM.

9. **ReAct text-based patterns break with thinking models.** Use structured function calling (OpenAI/Anthropic API format) rather than text-marker-based patterns when using reasoning SLMs.

---

### 🎯 Specific Recommendations for Local SLM + MCP Design

#### Context Budget Allocation Strategy

```
Total context: 8,192 tokens (example for Qwen3-8B or Gemma 2)

Reserved allocations:
  System prompt:        512 tokens  (6%)
  Tool schemas:         512 tokens  (6%)  ← HARD LIMIT; use progressive discovery if exceeded
  Output generation:  1,024 tokens  (12%) ← Reserve for model output
  Tool results buffer: 2,048 tokens  (25%) ← For current turn's tool results
  Conversation history: 4,096 tokens (51%) ← Sliding window of prior turns
```

#### Message Array Management Algorithm

```python
def prepare_messages_for_slm(
    system_prompt: str,
    conversation_history: list[Message],
    tool_schemas: list[Schema],
    context_limit: int = 8192,
    output_reserve: int = 1024,
) -> tuple[list[Message], list[Schema]]:
    """
    Prepare a trimmed, valid message array for a small context SLM.
    """
    
    # 1. Always include system prompt
    # 2. Select tool schemas (progressive discovery if too many)
    schema_tokens = count_tokens(tool_schemas)
    if schema_tokens > context_limit * 0.05:  # 5% threshold
        tool_schemas = [search_tools_meta_schema]  # Replace with discovery tool
    
    # 3. Trim history using sliding window
    # - Drop oldest turns first
    # - ALWAYS drop tool calls with their paired results atomically
    # - Never leave an AIMessage.tool_calls without its ToolMessage response
    # - Keep system message pinned
    
    available = context_limit - output_reserve - count_tokens(system_prompt) - count_tokens(tool_schemas)
    
    trimmed_history = trim_messages(
        conversation_history,
        max_tokens=available,
        strategy="last",          # Keep most recent
        include_system=False,     # Handled separately
        start_on="human",         # Valid API input
        end_on=("human", "tool"), # Valid stopping points
        token_counter="approximate",
    )
    
    return [system_prompt] + trimmed_history, tool_schemas
```

#### Tool Result Handling Decision Tree

```
Tool call executed successfully?
├── YES → Result is large (>500 tokens)?
│   ├── YES → Store full result in artifact/external; put summary in content
│   └── NO  → Put full result in content
└── NO → Result is an execution error (isError: true)?
    ├── YES → Always include in context (enables model self-correction)
    │         Include the error message; retry attempt up to N times
    └── NO  → Protocol error; log it; don't necessarily include in LLM context
```

#### Progressive Discovery Implementation Sketch

```python
async def get_tools_for_request(
    user_message: str,
    mcp_servers: list[MCPServer],
    context_budget: int,
    threshold_pct: float = 0.05,
) -> list[ToolSchema]:
    """
    Load tool schemas progressively based on context budget and task relevance.
    """
    # Fetch all schemas from connected MCP servers (cache these!)
    all_schemas = await fetch_all_schemas(mcp_servers)  # Don't send to LLM yet
    
    total_schema_tokens = count_tokens(all_schemas)
    
    if total_schema_tokens <= context_budget * threshold_pct:
        # Small enough to load all
        return all_schemas
    else:
        # Use semantic search to find relevant tools
        query_embedding = embed(user_message)
        relevant_schemas = vector_search(
            query=query_embedding,
            corpus=all_schemas,
            top_k=5,  # Load at most 5 schemas
            max_tokens=int(context_budget * threshold_pct)
        )
        # Always add the search_tools meta-tool so model can discover more
        return [SEARCH_TOOLS_META_SCHEMA] + relevant_schemas
```

#### Handling Reasoning Tokens

```python
def strip_reasoning_from_history(messages: list[Message]) -> list[Message]:
    """
    Remove reasoning/thinking content from messages before re-inserting in context.
    Critical for SLMs with small context windows.
    """
    cleaned = []
    for msg in messages:
        if isinstance(msg, AIMessage):
            # Remove reasoning_content from Qwen3/DeepSeek style messages
            if hasattr(msg, 'reasoning_content'):
                msg = msg.model_copy(update={'reasoning_content': None})
            # Remove thinking blocks from Anthropic extended thinking
            if isinstance(msg.content, list):
                content = [
                    block for block in msg.content 
                    if not (isinstance(block, dict) and block.get('type') == 'thinking')
                ]
                msg = msg.model_copy(update={'content': content})
        cleaned.append(msg)
    return cleaned
```

---

## Section 6: Implemented Reasoning Stripping Policy (This App)

This section documents the decisions made during implementation and explains the rationale.

### 6.1 The Core Problem

When a reasoning model calls tools in a multi-round turn, it generates `reasoning_content` (thinking tokens) before each tool call. This intermediate reasoning can be thousands of tokens per round. The question is: what to include in the API context for subsequent user turns?

### 6.2 Decided Policy

**Within a live tool-calling turn** (model is still working):
- ALL `reasoning_content` IS kept between rounds — the model needs its chain-of-thought to interpret tool results correctly
- Each intermediate `assistant` message includes `reasoning_content: roundThinking`

**For historical turns** (turn is complete, user starts a new message):
- ALL `reasoning_content` is stripped — both intermediate reasoning AND final response reasoning
- The model only needs: tool call content + tool results + final answer to reconstruct history
- Optional exception: if `thinkingInContext = true` on an assistant message, the **final** reasoning block is kept

**Rationale:**
1. The model does not need "why I decided to call this tool last turn" to answer a new question
2. The tool call + result already tell that story implicitly
3. Keeping intermediate reasoning from historical turns adds no task accuracy (no evidence to the contrary found in literature — see Gaps & Uncertainties §6)
4. Significant token savings: 3 rounds × 2000 reasoning tokens each = 6000 tokens per historical turn

### 6.3 Implementation

**`chatStore.ts` — `buildBaseApiMessages()`:**
- Reconstructs history for each API call
- Intermediate rounds: `reasoning_content` field omitted entirely
- Final round: `reasoning_content` omitted unless `thinkingInContext = true`

**`chatStore.ts` — live `apiMessages` extension (within-turn loop):**
- Each intermediate assistant message INCLUDES `reasoning_content: roundThinking`
- This is intentional and must NOT be changed — the model needs it mid-task

### 6.4 Context Bar Implications

Because `reasoning_content` is sent in the live turn's API calls but stripped from historical reconstruction, prompt token deltas between rounds contain reasoning tokens:

```
rawDelta = round[r+1].promptTokens - round[r].promptTokens
         = reasoning_r + tool_call_r + tool_result_r
```

The bar splits this as:
- **Current turn** (`isLastTurn`): show `round.reasoningTokens` as orange, then `rawDelta - round.reasoningTokens` as tool-call/tool-response
- **Historical turns**: show only `rawDelta - round.reasoningTokens` as tool-call/tool-response (reasoning was stripped, not in current context)

**Known uncertainty**: Whether LM Studio/Qwen3.6 actually includes `reasoning_content` in `promptTokens` is empirically assumed from the observation that tc/tr bars appeared much larger than the actual tool content. If the delta subtraction produces consistent zero tc/tr segments, the assumption is wrong and we revert to raw delta.

---



| Source | URL | Coverage |
|--------|-----|----------|
| OpenAI Python SDK — Tool message types | [github.com/openai/openai-python](https://github.com/openai/openai-python/blob/main/src/openai/types/chat/chat_completion_tool_message_param.py) | OpenAI message structure |
| Anthropic Python SDK — Tool types | [github.com/anthropics/anthropic-sdk-python](https://github.com/anthropics/anthropic-sdk-python/blob/main/src/anthropic/types/tool_param.py) | Anthropic tool schema, cache_control |
| LangChain messages/utils.py | [github.com/langchain-ai/langchain](https://github.com/langchain-ai/langchain/blob/master/libs/core/langchain_core/messages/utils.py) | trim_messages, filter_messages |
| LangChain tool.py | [github.com/langchain-ai/langchain](https://github.com/langchain-ai/langchain/blob/master/libs/core/langchain_core/messages/tool.py) | ToolMessage, artifact pattern |
| MCP Tool Specification (2025-11-25) | [modelcontextprotocol.io/specification/2025-11-25/server/tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) | MCP tool/result structure |
| MCP Resources Specification | [modelcontextprotocol.io/docs/concepts/resources](https://modelcontextprotocol.io/docs/concepts/resources) | Resources vs tools distinction |
| MCP Client Best Practices | [modelcontextprotocol.io/docs/develop/clients/client-best-practices.md](https://modelcontextprotocol.io/docs/develop/clients/client-best-practices.md) | Progressive discovery, code mode |
| MCP Sampling Specification | [modelcontextprotocol.io/specification/2025-11-25/client/sampling](https://modelcontextprotocol.io/specification/2025-11-25/client/sampling) | Multi-turn tool loop, ordering rules |
| Anthropic Prompt Caching Docs | [docs.anthropic.com/en/docs/build-with-claude/prompt-caching](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching) | Tool schema caching |
| Anthropic Tool Use Overview | [docs.anthropic.com/en/docs/build-with-claude/tool-use/overview](https://docs.anthropic.com/en/docs/build-with-claude/tool-use/overview) | Token costs, pricing |
| OpenAI Agents SDK — Tool Search | [openai.github.io/openai-agents-python/tools/](https://openai.github.io/openai-agents-python/tools/) | defer_loading, namespaces |
| Qwen3 Function Calling Guide | [qwen.readthedocs.io/en/latest/framework/function_call.html](https://qwen.readthedocs.io/en/latest/framework/function_call.html) | Reasoning model tool format |
| ReAct Paper | [arxiv.org/abs/2210.03629](https://arxiv.org/abs/2210.03629) | Foundational reasoning+acting |
| Voyager Paper | [arxiv.org/abs/2305.16291](https://arxiv.org/abs/2305.16291) | Skill library / tool memory |
| AutoGen Paper | [arxiv.org/abs/2308.08155](https://arxiv.org/abs/2308.08155) | Multi-agent tool use framework |
| MindSearch Paper (ICLR 2025) | [arxiv.org/abs/2407.20183](https://arxiv.org/abs/2407.20183) | Context-constrained multi-agent search |
| Cloudflare Workers AI Function Calling | [developers.cloudflare.com/workers-ai/function-calling/](https://developers.cloudflare.com/workers-ai/function-calling/) | SLM tool calling (Hermes-2-Pro-Mistral-7B) |

---

### Gaps and Uncertainties

1. **AutoGen context management implementation details**: Searches of `microsoft/autogen` returned no hits for explicit trim/context-management functions. AutoGen appears to rely on model-level configuration rather than application-level pruning — this needs direct code inspection of the AG2 (new v0.4+) core.

2. **CrewAI context management**: Not directly researched; CrewAI builds on LangChain and likely inherits its trim_messages patterns but may have additional crew-level memory management.

3. **LlamaIndex tool context patterns**: Not covered in this research pass. LlamaIndex has its own `ChatMemoryBuffer` and `TokenCountingHandler` systems worth investigating.

4. **OpenAI function calling docs were blocked (HTTP 403)**: Could not directly access `platform.openai.com/docs/guides/function-calling` — all OpenAI information came from the SDK source and openai-agents-python SDK.

5. **Exact DeepSeek-R1 tool call format**: While Qwen3's format is documented, DeepSeek-R1's specific tool call behavior when using `<think>` blocks was inferred from the vLLM `--reasoning-parser deepseek_r1` flag reference, not directly verified.

6. **Empirical data on reasoning token retention**: No published study was found that directly measures whether keeping vs. stripping prior reasoning tokens from tool calls improves multi-step task accuracy. This is an open empirical question.