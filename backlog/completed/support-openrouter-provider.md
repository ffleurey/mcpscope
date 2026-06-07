# Add support for running sessions via OpenRouter

Currently we only support LM Studio connections. We want to use hosted models,
and OpenRouter is a good fit since it is fully OpenAI API-compatible.

---

## OpenRouter API reference

OpenRouter exposes a fully OpenAI-compatible REST API.

| Resource | Endpoint | Docs |
|----------|----------|------|
| Chat completions | `POST /api/v1/chat/completions` | [openrouter.ai/docs/quickstart](https://openrouter.ai/docs/quickstart) |
| Models listing | `GET /api/v1/models` | [openrouter.ai/docs/api-reference/models/get-models](https://openrouter.ai/docs/api-reference/models/get-models) |
| Streaming | Standard SSE over chat completions | [openrouter.ai/docs/api/reference/streaming](https://openrouter.ai/docs/api/reference/streaming) |
| Full docs | — | [openrouter.ai/docs/llms-full.txt](https://openrouter.ai/docs/llms-full.txt) |

**Base URL:** `https://openrouter.ai/api/v1`  
**Auth:** `Authorization: Bearer <api-key>`  

The Models API returns per-model metadata including `context_length`, `supported_parameters`
(tools, reasoning, structured_outputs, etc.), `pricing`, and `top_provider.context_length`.

---

## Current implementation (findings before work)

### No SDK — raw HTTP via built-in `fetch()`

Zero HTTP-client or SDK dependencies for LLM calls. No `openai` npm package, no axios,
no Vercel AI SDK. SSE streaming parsing is hand-rolled in `backend/src/services/lmstudio/client.ts`.

### Provider abstraction

The gateway interface `LmStudioGateway` was defined in `backend/src/runtime/modelTurns.ts`
and injected via `OperationContext.lmStudioGateway`. It exposed five methods:

- `createChatCompletion(baseUrl, apiKey?, body)` — non-streaming
- `streamChatCompletion(baseUrl, apiKey?, body, callbacks?)` — streaming
- `probePromptTokens(baseUrl, apiKey?, body)` — simple token count
- `probePromptTokensDetailed(baseUrl, apiKey?, body)` — probe with raw exchange
- `getLoadedContextLength(baseUrl, apiKey?, modelKey)` — context window size

The interface was clean (takes baseUrl/apiKey/body parameters), but its return types
all carried `LmStudio*` prefixes even though most were standard OAI shapes.

### Standard OpenAI API (works with OpenRouter, Groq, Together, vLLM)

| Operation | Endpoint / Shape |
|-----------|-----------------|
| Chat completion | `POST {baseUrl}/chat/completions` with `{ model, messages, temperature, stream, stream_options: { include_usage }, tools, tool_choice }` |
| Model listing | `GET {baseUrl}/models` → `{ data: [{ id, object, owned_by, context_length }] }` |
| Auth | `Authorization: Bearer <api-key>` |
| SSE streaming | `data: {...}` payloads, `data: [DONE]` terminator |
| Token usage | `usage.prompt_tokens`, `usage.completion_tokens`, `usage.total_tokens` |
| Tool calls | `choices[].delta.tool_calls[]` with `{ index, id, type, function: { name, arguments } }` |
| Reasoning (non-standard but widely supported) | `choices[].delta.reasoning_content`, `usage.reasoning_tokens`, `usage.completion_tokens_details.reasoning_tokens` |

### LM Studio proprietary (no equivalent on OpenRouter)

| Operation | Endpoint | Purpose |
|-----------|----------|---------|
| Native model list | `GET /api/v1/models` (different path) | Model metadata, loaded instances, context lengths |
| Load model | `POST /api/v1/models/load` | Load a model by key |
| Unload model | `POST /api/v1/models/unload` | Unload by instance ID |
| Reasoning toggle | `reasoning: "on"\|"off"` in request body | Enable/disable chain-of-thought |
| Reasoning fields | `reasoning_content` in delta/message, `reasoning_tokens` in usage | Extended reasoning output |

### Where "lmstudio" was hardcoded (before rename)

| Layer | What was named "lmstudio" |
|-------|--------------------------|
| Domain config | `lmStudioConnectionSchema` — no `providerType` field |
| Domain model | `exchangeKindValues` has `lmstudio-request/response/probe-*` |
| Gateway type | `LmStudioGateway` interface + all return types |
| Routes | `/api/lm-connections/*`, preflight checks reference LM Studio |
| Persistence | `lm_connections` table, `listLmConnections` etc. |
| Frontend stores | `lmConnections` writable, `upsertConnection` |
| Frontend services | `lmstudio.ts` service wrapping backend API |
| Frontend types | `LmStudioConnection`, `LmStudioModel` |
| Replay harness | `createReplayLmStudioGateway` pairs `lmstudio-*` exchanges |

---

## Options considered

### Option A: Full abstraction layer (rejected)

Rename `LmStudioGateway` → `LLMProvider`, create a generic interface with
provider-agnostic return types, extract shared OAI logic into a common module,
add a provider plugin system.

**Rejected because** this is effectively building a custom version of the OpenAI SDK.
All that work gets thrown away the moment we adopt the SDK.

### Option B: Minimal with pragmatic renames (selected)

Keep the existing architecture. Rename the misleading `LmStudio*` type names.
Add a `providerType` discriminator to the connection schema. Create a thin
`openrouter/client.ts` that reuses the shared OAI functions. Guard LM Studio-only
features behind `providerType === 'lmstudio'`.

**Rationale:** The existing gateway interface is already provider-agnostic in its
function signatures. Only the naming is misleading.

### Option C: OpenAI SDK (deferred — Increment 2)

Swap raw `fetch()` for `new OpenAI({ baseURL, apiKey })`. The SDK handles SSE
streaming, type safety, retries, and error classes natively.

### Option D: Vercel AI SDK (not considered)

Overkill unless multi-provider with non-OAI APIs is a hard requirement.

### Decision

**Increment 1 (this task):** Option B with pragmatic renames.  
**Increment 2 (future):** Option C — adopt the `openai` npm SDK.

---

## Increment 1 — what was implemented

### Type renames (33 backend files, 8 frontend files)

| Old name | New name | Notes |
|----------|----------|-------|
| `LmStudioGateway` | `ChatCompletionGateway` | Interface + all 91 field/parameter references |
| `LmStudioChatCompletionResponse` | `OaiChatCompletionResponse` | |
| `LmStudioChatCompletionChunk` | `OaiChatCompletionChunk` | |
| `LmStudioChatCompletionUsage` | `OaiChatCompletionUsage` | |
| `LmStudioStreamedChatCompletionResult` | `OaiStreamedChatCompletionResult` | |
| `LmStudioAssistantSegment` | `AssistantSegment` | |
| `LmStudioStreamDelta` | `StreamDelta` | |
| `LmStudioStreamCallbacks` | `StreamCallbacks` | |
| `LmStudioPromptProbeResult` | `PromptProbeResult` | |
| `LmStudioRawExchange` | `ProbeRawExchange` | |
| `LmStudioModelListResponse` | `OaiModelListResponse` | |
| `NormalizedLmStudioUsage` | `NormalizedUsage` | |
| `normalizeLmStudioUsage` | `normalizeUsage` | |
| `normalizeLmStudioUsageFromResponse` | `normalizeUsageFromResponse` | |

Kept LM Studio-specific: `LmStudioNativeModel`, `LmStudioModelStatus`,
`listModelsWithStatus`, `loadModel`, `unloadModel`, `createLmStudioRawExchange`,
`lmstudio-*` exchange kinds.

### Provider config

- `backend/src/domain/configuration.ts`: `providerConnectionSchema` with
  `providerType: 'lmstudio' | 'openrouter'` (default `'lmstudio'`)
- `lmStudioConnectionSchema` kept as backward-compatible alias for persistence layer

### OpenRouter client

- `backend/src/services/openrouter/client.ts` — 54-line thin re-export wrapper
  around the shared OAI functions from `lmstudio/client.ts`

### Provider-aware preflight & routes

- `POST /api/sessions/preflight` accepts `providerType`, skips `isModelLoaded`
  check for OpenRouter (hosted models are always available)
- Error codes: `provider_unreachable` / `model_not_loaded` (was `lm_studio_unreachable` / `lm_model_not_loaded`)
- `POST /api/lm-connections/test` and `POST /api/lm-connections/models` accept
  optional `providerType` for correct error messages

### Session init error handling

- `runSessionInitialization` in `sessionInit.ts` wraps initialization in try/catch
- On failure: sets `session.initStatus = 'error'` in the DB, emits `prelude-failed`
  event with the actual error message (frontend surfaces it through the error dialog)
- Previously the session stayed stuck in `'initializing'` forever

### Context length for OpenRouter

OpenRouter's `GET /api/v1/models` returns `context_length` per model
([source](https://openrouter.ai/docs/api-reference/models/get-models)).

**Per-model schema:**
```json
{
  "id": "openai/gpt-4o",
  "context_length": 128000,
  "top_provider": { "context_length": 128000 }
}
```

How it's used:
1. `OaiModelListResponse` now includes `context_length?: number`
2. `listModelsWithStatus()` OAI-compat fallback passes `context_length` as `maxContextLength`
   and includes it in the `raw` field (visible in the "Details" dialog)
3. In `ensureSessionPreludeTokenMetadata` (`sessionPrelude.ts`), when the LM Studio
   native API returns null, the code queries `GET /v1/models` and looks up `context_length`
   by model key

### Frontend features

- **Connection form**: Provider type selector (LM Studio / OpenRouter) with
  contextual placeholder hints
- **Connection list**: Shows provider type in each card; test dialog title is
  dynamic per provider
- **Model config form**: Model dropdown sorted alphabetically with text search/filter;
  load button and reasoning toggle hidden for OpenRouter; context length shown
  when available
- **Model config list**: Context length shown for both LM Studio ("N loaded / max M")
  and OpenRouter ("M tokens"); Load/Eject buttons hidden for OpenRouter

---

## OpenRouter API capabilities not yet used

| Feature | Available on OpenRouter | Why deferred |
|---------|------------------------|-------------|
| `supported_parameters` per model | Models API returns which params each model supports (tools, reasoning, structured_outputs, etc.) | Would need frontend plumbing for per-model feature toggles |
| `top_provider.context_length` | Provider-specific context limit (may differ from model max) | Nice-to-have — model-level `context_length` is sufficient |
| `HTTP-Referer` / `X-OpenRouter-Title` headers | Optional attribution headers for OpenRouter rankings | No functional impact, purely cosmetic |
| `reasoning` parameter | Listed as supported by many models | OpenRouter's `reasoning` format may differ from LM Studio's `"on"\|"off"`; needs investigation |
| `include_reasoning` parameter | Returns reasoning content in response | Requires testing against OpenRouter models |
| Models endpoint filtering | `?output_modalities=`, `?supported_parameters=` query params | Useful for narrowing the model list |

---

## Data flow per provider

```
LM Studio:
  listModelsWithStatus → native /api/v1/models (rich metadata, loaded instances, context)
                      → fallback OAI /v1/models (when native unavailable)
  Session init context length → getLoadedContextLength() → native /api/v1/models

OpenRouter:
  listModelsWithStatus → native /api/v1/models → 404 → fallback OAI /v1/models
                      → captures context_length, raw data
  Session init context length → getLoadedContextLength() → native → null
                              → fallback OAI /v1/models → context_length by model key
```

## File manifest (48 changed + 2 new)

### Backend core (33 files, all under `backend/src/`)

**Type renames:** `services/lmstudio/client.ts`, `domain/tokenAccounting.ts`,
`domain/tokenSanity.test.ts`, `runtime/modelTurns.ts`, `runtime/streamedCompletion.ts`,
`runtime/promptTokenProbing.ts`, `runtime/toolTurns.ts`, `runtime/chatSession.ts`,
`runtime/sessionInit.ts`, `runtime/sessionPrelude.ts`, `runtime/schedulerTypes.ts`,
`runtime/schedulerDispatch.ts`, `runtime/streamEvents.ts`, `runtime/modelTurns.test.ts`,
`runtime/toolTurns.test.ts`, `testing/replayHarness.ts`, `testing/replayHarness.test.ts`,
`operations/context.ts`, `operations/launchAnalysis.ts`, `routes/configurationRoutes.ts`,
`app.ts`, `app.test.ts`

**Provider config:** `domain/configuration.ts`, `dev/seedDevConfig.ts`

**Analysis layer:** `analysis/analysisSessionBase.ts`, `analysis/analysisWorkflowFactory.ts`,
`analysis/analysisWorkflow.test.ts`, `analysis/boundedTurn.ts`,
`analysis/fullSession/fullSessionAnalysis.ts`, `analysis/fastSession/fastSessionAnalysis.ts`,
`analysis/fastTool/fastToolAnalysis.ts`, `analysis/fastTool/fastToolGroupedAssessmentStep.ts`,
`analysis/shared/bootstrapStep.ts`, `analysis/shared/turnSummaryStep.ts`,
`analysis/shared/toolCallAssessmentStep.ts`, `analysis/shared/finalAggregationStep.ts`,
`workflow/workflowStep.ts`

### Backend new files

- `services/openrouter/client.ts` — thin OAI re-export wrapper
- `backlog/support-openrouter-provider.md` — this file

### Frontend (8 files, under `frontend/src/lib/`)

`types.ts`, `backendTypes.ts`, `api/backendClient.ts`, `sessionStore.ts`,
`sessionStore.test.ts`, `services/lmstudio.ts`, `components/LmConnectionForm.svelte`,
`components/LmConnections.svelte`, `components/ModelConfigForm.svelte`,
`components/ModelConfigs.svelte`
