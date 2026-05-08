# Multi-turn Token Counting

**Model used:** `qwen3.6-35b-a3b-apex` (Qwen3 35B-A3B, 16384 ctx loaded)  
**Payload files:** `multiturn-turn1.json`, `multiturn-turn2.json`

---

## How LM Studio counts tokens across turns

Each API request re-encodes the **full conversation history** from scratch.  
The model does NOT retain KV cache between requests.

### What each field means

| Field | What it counts |
|---|---|
| `prompt_tokens` | All tokens sent to the model this request: system prompt + all prior turns (content only) + current user message |
| `completion_tokens` | Tokens generated this response, **including reasoning tokens** |
| `total_tokens` | `prompt_tokens + completion_tokens` |
| `completion_tokens_details.reasoning_tokens` | Subset of completion tokens used for chain-of-thought (not exposed to the next turn) |

### Critical insight: reasoning tokens are NOT passed to the next turn

When assembling multi-turn history, only `message.content` is included in the history —  
**not** `message.reasoning_content`. This means reasoning tokens "disappear" between turns.

### Observed numbers (Qwen3 35B-A3B, 2-turn conversation)

```
Turn 1 request:  [user: "Reply with only the word: hello"]
Turn 1 response: prompt=17  completion=143 (reasoning=139)  total=160

Turn 2 request:  [user: "hello", assistant: "hello", user: "Now reply with only the word: world"]
Turn 2 response: prompt=36  completion=156 (reasoning=152)  total=192
```

Turn 2 prompt breakdown:
- T1 user message: ~17 tokens
- T1 assistant content only ("hello"): ~4 tokens  ← NOT the 139 reasoning tokens
- T2 user message: ~15 tokens
- Total: 36 tokens (much less than T1's total of 160)

### Why `prompt + completion` is the WRONG "context used" metric

If you show `promptTokens + completionTokens` per message:
- Turn 1: 17 + 143 = **160**
- Turn 2: 36 + 156 = **192**  ← happens to increase here

But with a longer Turn 1 answer (e.g. 916 completion tokens, 562 reasoning):
- Turn 1: 30 + 916 = **946**  
- Turn 2: ~50 + ~50 = **~100**  ← **drops dramatically**

This is misleading — it looks like context shrank.

### Correct metric: use `promptTokens` alone

`prompt_tokens` at any turn N = the accumulated conversation history as fed to the model.  
This grows monotonically (assuming the conversation grows) and is the actual context window pressure.

- Turn 1: prompt = **17** (just the first message)
- Turn 2: prompt = **36** (Turn 1 history + Turn 2 message)
- Turn N: prompt = total non-reasoning history tokens so far

### Implication for context bar

Use `promptTokens` from the most recent response as "context consumed".  
Compare against `loaded_instances[0].config.context_length` (not `max_context_length`).

```
History: 36 tokens  (= promptTokens of this response)
Generated: 156 tokens  (= completionTokens, of which 152 were reasoning)
Context limit: 16,384 tokens  (from loaded_instances[0].config.context_length)
```

---

## stream_options.include_usage

Add `"stream_options": {"include_usage": true}` to streaming requests.

The usage chunk is sent as the **last data event before `[DONE]`**:

```
data: {"choices":[],"usage":{"prompt_tokens":36,"completion_tokens":156,"total_tokens":192,"completion_tokens_details":{"reasoning_tokens":152}}}

data: [DONE]
```

Without this option, streaming responses return no usage data.
