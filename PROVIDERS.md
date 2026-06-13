# Provider-Specific Behavior

mcpscope supports three LLM providers: **LM Studio**, **Ollama**, and **OpenRouter**. Each has different conventions for reasoning tokens, token reporting, model loading, and context window configuration.

All provider-specific logic is consolidated in `backend/src/services/provider/`. Adding a fourth provider means extending this module — see [Adding a new provider](#adding-a-new-provider).

---

## Detection

Provider detection happens via `detectProvider(baseUrl, explicitProviderType?)` in `backend/src/services/provider/detection.ts`.

Each [LM Connection](backend/src/domain/configuration.ts) carries a `providerType` field (`"lmstudio"`, `"openrouter"`, or `"ollama"` set by the user when creating the connection). This is the authoritative source.

During session creation, `providerType` is copied from the connection into the [modelProfileSnapshot](backend/src/domain/model.ts). All runtime code passes this explicit type to `detectProvider`, avoiding URL sniffing.

| Priority | Source |
|----------|--------|
| **1** (authoritative) | `modelProfileSnapshot.providerType` (from connection config) |
| **2** (fallback) | URL patterns for sessions created before `providerType` was added |

### Adding a new provider type

1. Add the value to `providerTypeValues` in `backend/src/domain/configuration.ts`
2. Add a pattern to `URL_PATTERNS` in `detection.ts` (optional, for backward compat)
3. Update the `ProviderType` union in `detection.ts` if needed
4. Add a `case` in `buildReasoningParams`, `normalizeStreamUsage`, `getProviderContextLength`, and `probeRequestPromptTokens`

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
| **OpenRouter** | Non-streaming responses don't include `usage` | Estimates from text + tool definitions length using `estimateTokensFromText` |
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
| `backend/src/services/provider/detection.ts` | Provider identification from base URL |
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

1. **Connection type**: Add the value to `providerTypeValues` in `configuration.ts` and to the `ProviderType` union in `detection.ts`
2. **Reasoning params**: Add a `case` in `buildReasoningParams` in `reasoning.ts`
3. **Token parsing**: Add a `case` in `normalizeStreamUsage` in `tokenUsage.ts` and implement a provider-specific normalizer
4. **Context length**: Add resolution in `getProviderContextLength` in `contextLength.ts`
5. **Probing**: Add fallback in `probeRequestPromptTokens` in `promptTokenProbing.ts` if the provider doesn't return usage in non-streaming responses
