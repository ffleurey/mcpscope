# LM Studio API Research — Payload Study

**Server:** `lms1.fleurey.com` (LM Studio 0.4.12, HTTPS via Caddy reverse proxy)  
**Model used:** `google/gemma-4-e4b` (Gemma 4 E4B, 7.5B params, Q8_0 quantization)  
**Date:** 2026-05-08

---

## 1. Model Discovery

### 1.1 OpenAI-Compatible: `GET /v1/models`

**File:** `compat-v1-models.json`

Returns a minimal list — only model IDs, no parameters:

```json
{
  "object": "list",
  "data": [
    { "id": "google/gemma-4-e4b", "object": "model", "owned_by": "organization_owner" },
    { "id": "qwen3.6-35b-a3b-apex", "object": "model", "owned_by": "organization_owner" }
  ]
}
```

**`GET /v1/models/{id}`** — returns the same minimal shape, no extra detail.

**What you get:** model keys only. No context length, no quantization, no loaded status, no capabilities.

---

### 1.2 LM Studio Native: `GET /api/v1/models`

**File:** `lms-api-v1-models.json`

Rich per-model data. Full Gemma 4 entry:

```json
{
  "type": "llm",
  "publisher": "google",
  "key": "google/gemma-4-e4b",
  "display_name": "Gemma 4 E4B",
  "architecture": "gemma4",
  "quantization": { "name": "Q8_0", "bits_per_weight": 8 },
  "size_bytes": 9022887056,
  "params_string": "7.5B",
  "loaded_instances": [
    {
      "id": "google/gemma-4-e4b",
      "config": {
        "context_length": 4096,
        "eval_batch_size": 512,
        "parallel": 4,
        "flash_attention": true,
        "offload_kv_cache_to_gpu": true
      },
      "remaining_ttl_seconds": 3589
    }
  ],
  "max_context_length": 131072,
  "format": "gguf",
  "capabilities": {
    "vision": true,
    "trained_for_tool_use": true,
    "reasoning": {
      "allowed_options": ["off", "on"],
      "default": "on"
    }
  },
  "variants": ["google/gemma-4-e4b@q8_0"],
  "selected_variant": "google/gemma-4-e4b@q8_0"
}
```

**`GET /api/v1/models/{id}`** — does NOT work (404). Only the list endpoint is available.

**What you get vs OpenAI compat:**

| Field | `/v1/models` | `/api/v1/models` |
|---|---|---|
| Model key/ID | ✅ | ✅ |
| Display name | ❌ | ✅ |
| Publisher | ❌ | ✅ |
| Architecture | ❌ | ✅ (`gemma4`, `qwen35moe`, …) |
| Quantization | ❌ | ✅ name + bits_per_weight |
| Model size (bytes) | ❌ | ✅ |
| Param count string | ❌ | ✅ (`7.5B`, `35B-A3B`) |
| Max context length | ❌ | ✅ (`131072` = model's architectural max) |
| **Currently loaded** | ❌ | ✅ `loaded_instances` array |
| **Active context length** | ❌ | ✅ inside `loaded_instances[].config.context_length` |
| Remaining TTL (idle eviction) | ❌ | ✅ `remaining_ttl_seconds` |
| Vision capability | ❌ | ✅ |
| Tool use capability | ❌ | ✅ |
| Reasoning capability | ❌ | ✅ incl. allowed options |
| Variants / quantization options | ❌ | ✅ |

**Verdict:** The native `/api/v1/models` endpoint is significantly richer and is worth using exclusively. We already do this (with compat fallback). The compat endpoint is only useful as a health check when the native one isn't available.

**Important distinction:** `max_context_length` (131072) is the model's architectural maximum. `loaded_instances[].config.context_length` (4096 in this session) is what was actually configured when loaded — **this is the real usable context window** and is far more actionable for displaying context bar information.

**Cluster note:** When multiple nodes run the same model key, the same `key` appears multiple times in the list with different `display_name` values (e.g. "Compact" vs "Quality"). There is no hostname/node field in the API.

---

## 2. Chat Completion

### 2.1 What we send

Standard OpenAI format. All tested params:

```json
{
  "model": "google/gemma-4-e4b",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user",   "content": "What is 2+2?" },
    { "role": "assistant", "content": "4" },
    { "role": "user",   "content": "And 3+3?" }
  ],
  "stream": true,
  "stream_options": { "include_usage": true },
  "temperature": 0.7,
  "top_p": 0.9,
  "presence_penalty": 0.1,
  "frequency_penalty": 0.1,
  "max_tokens": 50
}
```

`top_p`, `presence_penalty`, `frequency_penalty`, `max_tokens` are all accepted without error (see `compat-chat-extra-params.json`). `logprobs: true` is accepted but always returns `null`.

---

### 2.2 Non-streaming response

**File:** `compat-chat-completion-nonstream.json`

```json
{
  "id": "chatcmpl-rgb1qjxkoe2vm2uu6b80x",
  "object": "chat.completion",
  "created": 1778214804,
  "model": "google/gemma-4-e4b",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "Hello",
      "reasoning_content": "",
      "tool_calls": []
    },
    "logprobs": null,
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 21,
    "completion_tokens": 2,
    "total_tokens": 23,
    "completion_tokens_details": {
      "reasoning_tokens": 0
    }
  },
  "stats": {},
  "system_fingerprint": "google/gemma-4-e4b"
}
```

LM Studio extensions vs standard OpenAI:
- `message.reasoning_content` — always present (empty string if model didn't reason)
- `message.tool_calls` — always present as empty array
- `usage.completion_tokens_details.reasoning_tokens` — count of reasoning tokens
- `stats: {}` — empty object, reserved for future use
- `system_fingerprint` — set to the model key (not a hash like OpenAI)

---

### 2.3 Streaming chunks

**File:** `compat-chat-stream-annotated.json`

Streaming splits into distinct phases. For a complex query ("What is 17 * 23?"), we observed:
- **562 reasoning chunks** → `delta.reasoning_content` tokens
- **350 content chunks** → `delta.content` tokens  
- **1 finish chunk** → `finish_reason: "stop"`
- **1 usage chunk** → sent after `[DONE]` when `stream_options.include_usage: true`

**Phase 1 — First chunk (role assignment):**
```json
{
  "choices": [{ "delta": { "role": "assistant", "reasoning_content": "\n" }, "finish_reason": null }]
}
```

**Phase 2 — Reasoning chunks** (only `reasoning_content`, no `content`):
```json
{
  "choices": [{ "delta": { "reasoning_content": " consider" }, "finish_reason": null }]
}
```

**Phase 3 — Content chunks** (only `content`, no `reasoning_content`):
```json
{
  "choices": [{ "delta": { "content": "There" }, "finish_reason": null }]
}
```

**Phase 4 — Finish:**
```json
{
  "choices": [{ "delta": {}, "finish_reason": "stop" }]
}
```

**Phase 5 — Usage** (only when `stream_options.include_usage: true`):
```json
{
  "choices": [],
  "usage": {
    "prompt_tokens": 30,
    "completion_tokens": 916,
    "total_tokens": 946,
    "completion_tokens_details": { "reasoning_tokens": 562 }
  }
}
```

Then `data: [DONE]`.

**Key observations:**
- `reasoning_content` and `content` are **mutually exclusive per chunk** — the switch from reasoning to content is clean
- Reasoning always precedes content — the model reasons first, then responds
- Reasoning token count is available from the final usage chunk
- Without `stream_options.include_usage: true`, no usage data is returned in streaming mode
- `logprobs` is always `null` — not supported
- `finish_reason` values observed: `"stop"` (normal), `"length"` (if max_tokens hit)

---

## 3. Context Window — What We Know and Don't Know

This is the most important gap for context bar implementation.

### What we can know:

| Information | Source | How |
|---|---|---|
| Model max ctx (architectural) | `/api/v1/models` | `max_context_length` |
| Actually loaded ctx length | `/api/v1/models` | `loaded_instances[0].config.context_length` |
| Prompt tokens used (this turn) | usage in response | `usage.prompt_tokens` |
| Completion tokens (this turn) | usage in response | `usage.completion_tokens` |
| Reasoning tokens (this turn) | usage in response | `usage.completion_tokens_details.reasoning_tokens` |

### What we cannot know from the API:

| Information | Notes |
|---|---|
| Cumulative tokens across the full conversation | Must calculate client-side by summing past message usage |
| Whether the context will overflow before sending | Must estimate client-side before the request |
| KV cache utilisation | Not exposed |
| Memory used by this model instance | Not exposed via API |
| Which messages will be truncated if context overflows | LM Studio truncates silently — no warning returned |

### Implications for context bar (Increment 4):

1. **Use `loaded_instances[0].config.context_length`** as the effective limit — not `max_context_length`. The model may be loaded with a much smaller context (4096 in the session above vs 131072 architectural max).

2. **Must accumulate usage client-side.** For each message, store `prompt_tokens` + `completion_tokens` from the API response. Sum them to estimate total context consumed. But this double-counts — the prompt includes all prior messages each turn.

3. **Best approach for context bar:** track the last response's `prompt_tokens` — this represents the entire conversation context at that moment (system prompt + all prior messages + current user message). Use that as the "used" value against the loaded context length.

4. **We should request `stream_options: {include_usage: true}`** on every streaming request to always capture token counts. We currently do not do this — a gap to fix.

---

## 4. What Parameters Are Worth Exposing in Model Config

Based on this study, recommended params for model config:

| Param | Rationale |
|---|---|
| `temperature` | Primary creativity/determinism control |
| `system_prompt` | Identity and task framing |
| `context_window_size` | Override the loaded ctx (LM Studio's `context_length` on load) |
| `max_tokens` | Cap response length — useful for test/debug configs |
| `top_p` | Nucleus sampling, alternative to temperature |
| `reasoning` on/off | Models with reasoning capability can have it disabled |

Params we tested but that **don't add value** for our use case:
- `presence_penalty` / `frequency_penalty` — marginal effect, increases config complexity
- `logprobs` — not supported

---

## 5. Summary and Recommended Actions

1. **Always use `/api/v1/models`** (already doing this ✅). The compat endpoint is useless for model selection.

2. **Show `loaded_instances[0].config.context_length`** as the effective context in model config UI — this is the real operational limit.

3. **Add `stream_options: {include_usage: true}`** to all streaming calls so we always have token counts.

4. **Store `prompt_tokens` from the last response** on the ChatSession — this gives the accurate "context used" value for the context bar.

5. **Consider adding `max_tokens`** to ModelConfig — useful for experiments.

6. **Consider exposing reasoning on/off** for models that support it (Gemma 4, Qwen3) — the capability and allowed options are in the native API.
