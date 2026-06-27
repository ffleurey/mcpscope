# Provider-Specific Behavior

mcpscope supports three LLM providers: **LM Studio**, **Ollama**, and **OpenRouter**. Each has different conventions for reasoning tokens, token reporting, model loading, and context window configuration.

All provider-specific logic is consolidated in `backend/src/services/provider/`. Adding a fourth provider means extending this module — see [Adding a new provider](#adding-a-new-provider).

---

## Detection

Each [LM Connection](backend/src/domain/configuration.ts) carries a `providerType` field (`"lmstudio"`, `"openrouter"`, or `"ollama"`) set by the user when creating the connection. This is the authoritative source.

During session creation, `providerType` is copied from the connection into the [modelProfileSnapshot](backend/src/domain/model.ts). Runtime code reads it directly via `session.modelProfileSnapshot.providerType ?? "lmstudio"`.

### Adding a new provider type

1. Add the value to `providerTypeValues` in `backend/src/domain/configuration.ts`
2. Update the `ProviderType` type in `backend/src/services/provider/index.ts`
3. Add a `case` in `buildReasoningParams`, `normalizeStreamUsage`, `getProviderContextLength`, and `probeRequestPromptTokens`

---

## Model loading / unloading

### Who loads the model

mcpscope **never explicitly loads a model at session start**. The model is auto-loaded by the provider when the first chat request arrives — in practice the token probe during session init (`sessionPrelude.ts`). What each provider does:

| Provider | Loading | Explicit load/unload control |
|----------|---------|------------------------------|
| **LM Studio** | Auto-loads on first request. A second load under a VRAM limit **fails** — eviction is *not* guaranteed. | Yes — native API (below). This is the only provider we drive. |
| **Ollama** | Auto-loads on first request; self-manages VRAM eviction (`OLLAMA_MAX_LOADED_MODELS`, `keep_alive`). | No — load/unload routes reject it with `400`. |
| **OpenRouter** | Hosted; no loading concept. | No. |

### LM Studio native API (`services/lmstudio/client.ts`)

| Operation | Endpoint | Helper |
|-----------|----------|--------|
| Load | `POST /api/v1/models/load` `{model, context_length?}` | `loadModel` |
| Unload | `POST /api/v1/models/unload` `{instance_id}` | `unloadModel` |
| Status | `GET /api/v1/models` → `loaded_instances[]` | `listModelsWithStatus`, `isModelLoaded`, `getLoadedContextLength` |

`context_length` is set at **load** time (LM Studio ignores `num_ctx` in the request body — see [Context window](#context-window)). `instance_id` == model key in practice.

### Auto-swap (`autoSwapModel` connection flag — LM Studio only)

Opt-in per connection. When on, before every provider request the harness unloads any *other* model loaded on the instance and loads the requested one — so a single VRAM-limited instance can be driven from the CLI/MCP without manual load/unload.

Key design decisions:

- **Request-level, not a session concern.** Implemented as a gateway decorator `withAutoModelSwap` (`runtime/autoModelSwapGateway.ts`) wrapping the `ChatCompletionGateway` in `app.ts`. Sessions never see the flag — there is no `modelProfileSnapshot` field for it. The flag is read **live** per request, so it self-heals if another process evicts our model mid-session.
- **One central rule.** `ensureModelReady` (`services/provider/modelLoading.ts`) is the only place that knows the swap logic: no-op unless `providerType === "lmstudio"` *and* the flag is on; otherwise unload every other loaded model, then load the target. Both the decorator and the manual load button call it.
- **`baseUrl` identifies the instance.** The decorator resolves the connection by `baseUrl` (same base URL = same physical process = same VRAM). A `baseUrl`-keyed in-process mutex serializes the swap sequence so concurrent requests don't interleave load/unload.
- **Manual load button** (`POST /api/lm-connections/models/load`) routes through the same `ensureModelReady`; **preflight** skips its `model_not_loaded` 409 for auto-swap connections.
- **Tradeoff:** two sessions requesting *different* models on one instance will thrash (each turn re-asserts its model) — correct but inefficient. Accepted; LM Studio is single-model under a VRAM limit anyway.

---

## Reasoning tokens

### Request body params (`buildReasoningParams` in `reasoning.ts`)

| Provider | Parameter | When |
|----------|-----------|------|
| **LM Studio** | `reasoning: "on"` or `"off"` | Always sent when user has a preference |
| **OpenRouter** | `reasoning: {}` + `include_reasoning: true` | Sent when reasoning is enabled |
| **Ollama** | `think: true` | Sent when reasoning is enabled |

### Streaming extraction (`extractReasoningContent` in `openai/client.ts`)

| Provider | SSE delta field | notes |
|----------|----------------|-------|
| **LM Studio** | `delta.reasoning_content` | Standard OpenAI format |
| **OpenRouter** | `delta.reasoning` | Uses `reasoning` not `reasoning_content` |
| **Ollama** | `delta.thinking` | OAI-compat mode |

---

## Token counting

### Streaming usage (`normalizeStreamUsage` in `tokenUsage.ts`)

| Provider | Usage source | Fields used |
|----------|-------------|-------------|
| **LM Studio** | SSE final chunk with `usage` sub-object | `prompt_tokens`, `completion_tokens`, `total_tokens`, `completion_tokens_details.reasoning_tokens` |
| **OpenRouter** | Same as LM Studio, SSE may be prefixed with `: OPENROUTER PROCESSING` comment | Same fields |
| **Ollama** | SSE final chunk with `"done": true` and top-level fields, OR standard OAI usage | `prompt_eval_count` → `promptTokens`, `eval_count` → `completionTokens` |

### Non-streaming probing (`probeRequestPromptTokens` in `promptTokenProbing.ts`)

| Provider | Probe result | Fallback |
|----------|-------------|----------|
| **LM Studio** | Returns `usage.prompt_tokens` from response | None needed |
| **OpenRouter** | Non-streaming responses don't include `usage` | Estimates from text + tool definitions length using `estimateTokensFromText`. Also degrades to this estimate when the probe itself is rejected with HTTP 400 (OpenRouter/OpenAI reject the `max_tokens: 1` probe when the prompt would trigger a tool call). Non-400 errors (auth/transport/5xx) still propagate. |
| **Ollama** | Same as LM Studio format | None needed |

### Reasoning token handling

| Provider | Reasoning tokens reported | Part attribution |
|----------|-------------------------|-----------------|
| **LM Studio / OpenRouter** | Exact from `completion_tokens_details.reasoning_tokens` | Parts get exact count |
| **Ollama** | Not reported separately | Parts get estimated count from thinking text length via `estimateTokensFromText`; displayed with `~` prefix |

---

## Context window

### Model context length (`getProviderContextLength` in `contextLength.ts`)

Resolution order:

1. User-configured `contextSize` from model config (authoritative — this is what gets sent as `num_ctx`)
2. Provider-native API (Ollama `/api/show`)
3. OAI `/v1/models` endpoint (OpenRouter, OpenAI)

| Provider | Native endpoint | Notes |
|----------|----------------|-------|
| **LM Studio** | N/A — handled by gateway's `getLoadedContextLength()` | Queries `/api/v1/models` for loaded model info |
| **OpenRouter** | None — uses OAI `/v1/models` | Returns model's max context |
| **Ollama** | `/api/show` | Returns `context_length` from `model_info`; tries multiple model key variants (exact, without tag, with `:latest`) |

### Context size in request body (`sessionContextBody` in `modelTurns.ts`)

`num_ctx` is sent to all providers. Only Ollama uses it to set the context window; LM Studio and OpenRouter ignore it.

---

## Key reference files

| File | Purpose |
|------|---------|
| `backend/src/services/provider/index.ts` | `ProviderType` type definition, barrel exports |
| `backend/src/services/provider/modelLoading.ts` | `ensureModelReady` — central auto-swap rule + per-instance lock |
| `backend/src/runtime/autoModelSwapGateway.ts` | `withAutoModelSwap` gateway decorator (wired in `app.ts`) |
| `backend/src/services/lmstudio/client.ts` | LM Studio native load/unload/status helpers |
| `backend/src/services/provider/reasoning.ts` | Request-body reasoning params + `estimateTokensFromText` |
| `backend/src/services/provider/tokenUsage.ts` | Provider-aware response usage normalization |
| `backend/src/services/provider/contextLength.ts` | Provider-aware context window resolution |
| `backend/src/services/openai/client.ts` | Shared SSE parsing, `extractReasoningContent` |
| `backend/src/runtime/modelTurns.ts` | Session and turn creation, `sessionContextBody` |
| `backend/src/runtime/toolTurns.ts` | Tool-enabled turn execution, part attribution |
| `backend/src/runtime/sessionPrelude.ts` | Session initialization, token probing |
| `backend/src/runtime/promptTokenProbing.ts` | Token probe requests, OpenRouter fallback |
| `backend/src/domain/compaction.ts` | Compaction logic, context tracking integrity |
| `backend/src/domain/tokenAccounting.ts` | `normalizeUsage`, `allocateProportionalTokenCounts` |

---

## Adding a new provider

1. **Connection type**: Add the value to `providerTypeValues` in `configuration.ts` and to the `ProviderType` type in `index.ts`
2. **Reasoning params**: Add a `case` in `buildReasoningParams` in `reasoning.ts`
3. **Token parsing**: Add a `case` in `normalizeStreamUsage` in `tokenUsage.ts` and implement a provider-specific normalizer
4. **Context length**: Add resolution in `getProviderContextLength` in `contextLength.ts`
5. **Probing**: Add fallback in `probeRequestPromptTokens` in `promptTokenProbing.ts` if the provider doesn't return usage in non-streaming responses
6. **Loading**: If the provider needs explicit load/unload (rather than auto-loading on first request), extend `ensureModelReady` in `modelLoading.ts`; otherwise it is a no-op for the new provider by default. See [Model loading / unloading](#model-loading--unloading).
