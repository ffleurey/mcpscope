Goal of this task is to add support for Ollama models in addition to LMStudio and OpenRouter.

A by-product is could be to add/expose a geenric strict OpenAI API support so that other providers can be connected. But that is a secondary goal. It can be a good way of helping us separate what is standard and what is specific. The first step of the task could be to add the OpenAI API and test Ollama with it and then just add ant Ollama specific feature we want to have to make the dedicated Ollama integration.


As we have decided before (backlog/completed/support-openrouter-provider.md), we do not want to re-invent a complicated abstraction layer and in the future we may consider using a lib if we want to support a wider range of providers. At this point we want to simple and strait forwrd implementation where we share an impelmentation of the common openAPI part and add small customizations to support the features we need for having streaming and model config/detail from LMStudio, OpenRouter and Ollama. We have to make sure that we keep this spirit thougout the task.

## Implementation plan

### Step 1 — Extract shared OAI functions into `services/openai/client.ts`

**What:** The LM Studio client (`services/lmstudio/client.ts`) currently holds both generic OAI-compatible functions (chat completions, streaming, token probing, model listing) and LM Studio-specific functions (native model listing, load/unload, reasoning toggle). Extract the shared OAI functions into a new module at `services/openai/client.ts` without changing behavior.

**Files to create/modify:**
- Create `backend/src/services/openai/client.ts` — extracted shared OAI types and functions
- Modify `backend/src/services/lmstudio/client.ts` — re-export shared functions from `openai/client.ts`, keep LM Studio-specifics
- Modify `backend/src/services/openrouter/client.ts` — update import path to `openai/client.ts`
- Update all files that import from `lmstudio/client.ts` for the shared types

**Status: COMPLETE**

**Acceptance criteria (verified):**
- ✅ All existing imports resolve and `npm test` still passes
- ✅ `npm run check:backend` passes
- ✅ `npm run check:cli` passes
- ✅ The OpenRouter re-export file has exactly one changed line (the import path) and nothing else
- ✅ `git --no-pager diff --stat` shows only the extraction — zero net behavior changes

**What happened:**
- Created `backend/src/services/openai/client.ts` with all shared OAI types and functions
- `backend/src/services/lmstudio/client.ts` now re-exports from `openai/client.ts` and keeps only LM Studio-specific code
- `backend/src/services/openrouter/client.ts` imports from `openai/client.ts` instead of `lmstudio/client.ts`

### Step 2 — Add Ollama provider type and client

**Status: COMPLETE**

**What happened:**
- Added `'ollama'` to `providerTypeValues` in `configuration.ts`
- Created `backend/src/services/ollama/client.ts` — thin re-export of shared OAI functions following OpenRouter pattern
- The existing single `ChatCompletionGateway` works for all providers since the shared OAI functions are provider-agnostic. `getLoadedContextLength` returns null for non-LM-Studio providers and the session prelude fallback (`listModels` → `/v1/models`) handles context length discovery.

**Acceptance criteria (verified):**
- ✅ `providerTypeValues` includes `'ollama'`
- ✅ Ollama client module exists and re-exports shared OAI functions
- ✅ `npm run check:backend` passes
- ✅ `npm run check:cli` passes
- ✅ `npm test` passes (187/187)

### Step 3 — Frontend: add Ollama to connection and model config UI

**Status: COMPLETE**

**What happened:**
- Added `'ollama'` to `ProviderType` in `types.ts` and `providerTypeSchema` in `backendTypes.ts`
- Updated `LmConnectionForm.svelte` with Ollama option (default URL hint: `http://localhost:11434`)
- Updated `backendClient.ts` function type constraints (`testLmConnection`, `listLmConnectionModels`, `preflightSession`)
- Updated `services/lmstudio.ts` `listModels()` type constraint

**Acceptance criteria (verified):**
- ✅ User can create a connection with provider type "Ollama (local)"
- ✅ Default base URL hint shown for Ollama
- ✅ `npm run check` passes (0 errors, 0 warnings)
- ✅ `npm test` passes (187/187)

### Step 4 — Update configuration routes for Ollama

**Status: COMPLETE**

**What happened:**
- Added `providerLabel()` helper function for consistent provider names in error messages
- Updated Zod enums on test, models, and preflight endpoints to accept `'ollama'`
- Preflight check skips `isModelLoaded` for both OpenRouter and Ollama

**Acceptance criteria (verified):**
- ✅ Connection test endpoint accepts `providerType: 'ollama'`
- ✅ Models listing endpoint accepts `providerType: 'ollama'`
- ✅ Error messages reference "Ollama" appropriately
- ✅ Preflight check skips model-loaded validation for Ollama
- ✅ `npm test` passes (187/187)

### Step 5 — Update exchange kind types and replay support

**Status: COMPLETE — no changes needed**

**Finding:** The `exchangeKindValues` (`lmstudio-request`, `lmstudio-response`, `lmstudio-probe-request`, `lmstudio-probe-response`, `mcp-request`, `mcp-response`) are set by the probe origin (the shared OAI functions in `openai/client.ts`) not by the provider type. Since Ollama goes through the same shared OAI functions for chat completions, streaming, and token probing, the same exchange kind values apply. The replay harness matches exchanges by comparing request/response body shapes, not by provider labels.

**Acceptance criteria (verified):**
- ✅ `npm test` passes (187/187) — existing replay fixtures unaffected
- ✅ No regressions in trace replay
