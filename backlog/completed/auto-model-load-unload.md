We have an issue with lmstudio (and maybe ollama) that usually when working locally and instance of lmstudio should really only load one model at the time. Trying to load a second will fail because of lack of VRAM.

If we want to switch between models, currentlty the loading/unloading has to be done manually (expecially the unloading).

We shoudl consider an option on the connection configuration called "auto-swap-model" (or something like that, feel free to suggest a better name). The semantics of this option on the Connection is that when starting a session that request one of its model, we will check if there is another model already loaded by this Connection (the instance of lmstudio) and first unload whatever model is loaded before loading the requested model.

The sessing should be on the Connection (ie the provider) but the logic should happen whenever we are loading (or requesting) a model from this propvider. This means at least 2 places:
* Whenever statting a session of any kind
* Whenever clicking the load model button in the configuration page

We have to find a good design for this so that it is handled "centrally" in our model management module, is fully optional and only applies to providers for which it is relevant (lmstidio for sure, Ollama maybe but I have the imlpression that Ollama might handle that for us). It shoudl not be an option for OpenRouter since we do not need to worry about any loading/unloading.

The value of that feature is to reduce friction when using mcpscope via the CLI/MCP to avoid having to worry about loading and unloading models and dealing with failures realted to it.

Important to have a very good undestanding of our Connection and model management architecture as it is now before starting to make any changes. Also important to clarify how model loading/unloading happens when it comes to starting sessions, what is done by us vs what the provider is doing.

---

# Status: implemented (2026-06-27)

Implemented per the gateway-decorator design below. Files: `domain/configuration.ts` (`autoSwapModel` flag), `services/provider/modelLoading.ts` (`ensureModelReady` + per-`baseUrl` lock), `runtime/autoModelSwapGateway.ts` (`withAutoModelSwap`, wired in `app.ts`), `routes/configurationRoutes.ts` (preflight 409 skip + load-button route), frontend `LmConnectionForm.svelte` toggle + `backendTypes.ts`. Tests: `modelLoading.test.ts`, `autoModelSwapGateway.test.ts` (12 tests). Full backend suite (276) green; typecheck/lint/format clean. Verified live against the dev LM Studio: both the load-button route and a real session's first request unloaded the prior model and loaded the requested one at its configured context. Provider/model-management architecture is documented in `PROVIDERS.md` (§ Model loading / unloading).

# Investigation (2026-06-27)

## How loading/unloading works today — us vs. the provider

**Key finding: today mcpscope never explicitly loads a model when starting a session.** Session start just relies on the provider auto-loading the model on the first chat request.

- **Session creation** (`createSession`, `backend/src/runtime/modelTurns.ts`) only writes metadata — no provider contact.
- **Session init** (`runSessionInitialization`, `backend/src/runtime/sessionInit.ts`) probes token counts (`ensureSessionPreludeTokenMetadata`). That first `/chat/completions` request is what implicitly triggers LM Studio's auto-load. There is no explicit load call in this path.
- **The only guard** is the UI-only preflight endpoint `POST /api/sessions/preflight` (`configurationRoutes.ts:421`), which for LM Studio calls `isModelLoaded()` and returns a `409 model_not_loaded` if the model isn't already loaded — telling the user to load it manually. CLI/MCP sessions do **not** hit preflight, so they just fail on the first request with LM Studio's own OOM error. This is exactly the friction the feature targets.

Provider differences:
- **LM Studio** — we have full explicit load/unload control via its native API (`POST /api/v1/models/load`, `/unload`, `GET /api/v1/models`). Loading a new model *can* evict the current one, but it is not guaranteed — with a hard VRAM limit a second load **fails**. This is the provider that needs the feature.
- **Ollama** — auto-loads on first request and self-manages VRAM eviction (`OLLAMA_MAX_LOADED_MODELS`, `keep_alive`). Our code has **no** Ollama load/unload support (the load/unload routes explicitly `400` for non-lmstudio). → out of scope for v1.
- **OpenRouter** — hosted, no loading concept. → never applicable (explicitly excluded by the brief).

## Relevant building blocks (already exist)

LM Studio client `backend/src/services/lmstudio/client.ts`:
- `listModelsWithStatus(baseUrl, apiKey)` → per-model `{ key, isLoaded, loadedContextLength, ... }` — gives us the set of currently-loaded model keys.
- `loadModel(baseUrl, apiKey, modelKey, contextSize?)` — synchronous, blocks until ready; reloading an already-loaded model is a no-op.
- `unloadModel(baseUrl, apiKey, instanceId)` — `instanceId` == model key in practice.
- `isModelLoaded(...)`, `getLoadedContextLength(...)`.

These are LM-Studio-specific and **not** part of the `ChatCompletionGateway` interface — load/unload currently lives only at the HTTP route layer (`configurationRoutes.ts`).

## The two trigger sites (per the brief)

1. **Session start (any kind).** The single chokepoint that *all* session kinds pass through is `runSessionInitialization` — primary chat, benchmark runs (`operations/benchmark.ts`), and analysis/judge sessions (`operations/launchAnalysis.ts`) all enqueue an init job that runs it. Hooking the swap here covers every session kind in one place. The swap must run **before** the token-probe phase (which otherwise auto-loads the wrong/failing model).
2. **Load model button.** `POST /api/lm-connections/models/load` (`configurationRoutes.ts:266`), called from `ModelConfigs.svelte` / `ModelConfigForm.svelte`.

## Where the flag lives — and why sessions never see it

The option lives on the **Connection** (`ProviderConnection`, `configuration.ts` — currently `{id, name, baseUrl, apiKey, providerType}`, no per-connection options yet). It is **not** snapshotted into the session. Auto-swap describes the *physical state of the LM Studio instance right now*, not a reproducible property of the session — the `modelProfileSnapshot` exists for reproducibility of what the model did; loading is operational plumbing. So the flag is read **live** from config at request time, and sessions stay completely ignorant of it.

---

# Chosen design — request-level gateway decorator

Rather than triggering at session-init and snapshotting the flag, the swap is a **harness feature at the request layer**: whenever mcpscope makes a request to an LM Studio instance, if auto-swap is active for that instance, swap the model first. Sessions don't need to know about it.

## The single seam
Every provider request flows through the one `chatCompletionGateway` constructed in `app.ts:58` (`createChatCompletion`, `streamChatCompletion`, `probePromptTokens`, `probePromptTokensDetailed`). Wrap it once:

```ts
chatCompletionGateway: withAutoModelSwap({
  createChatCompletion, streamChatCompletion, probePromptTokens, probePromptTokensDetailed, getLoadedContextLength,
})
```

The decorator, before delegating each method, reads `body.model` (the model key) + `baseUrl`, looks up the live connection, and calls the central `ensureModelReady(...)`. Every request path — turns, token probes, and any future caller — is covered automatically. **No `sessionInit.ts` change, no `modelProfileSnapshot` change, no `resolvePrimarySessionInputs` change.**

## Central function (the "model management module")
Per `PROVIDERS.md`, provider-specific logic lives in `backend/src/services/provider/`. Add `backend/src/services/provider/modelLoading.ts`, re-exported from `provider/index.ts`:

```ts
ensureModelReady({ baseUrl, apiKey, providerType, modelKey, contextSize, autoSwap }): Promise<void>
```

Logic:
- `providerType !== "lmstudio"` → **no-op** (rely on auto-load). Covers ollama/openrouter centrally.
- `autoSwap === false` → **no-op** (preserve today's behavior). The flag is what authorizes us to act.
- `autoSwap === true` (lmstudio), under the per-instance lock:
  1. `listModelsWithStatus()` → loaded model keys.
  2. If requested model already loaded → done (LM Studio reload is a no-op anyway).
  3. Else: `unloadModel()` every loaded key that isn't the target, then `loadModel(target, contextSize)`.

## Connection lookup by `baseUrl`
The decorator only has `baseUrl`/`apiKey`/`body` — no connection id. Look the connection up by `baseUrl`. This is the *correct* key, not a compromise: same `baseUrl` **is** the same physical LM Studio instance = same VRAM = should share swap behavior. If no connection matches (ad-hoc request) → no-op. If two connections share a `baseUrl` with different flags, treat "any auto-swap connection for this baseUrl" as enabling it (document the edge).

## Per-instance lock
An in-process async mutex keyed by `baseUrl`, around the `ensureModelReady` swap sequence only (not the request), so concurrent requests to the same instance don't issue interleaved load/unload. Lock the swap, not the turn — accept the thrashing.

## Concurrency: correct, not just tolerated
Two sessions on the same instance requesting *different* models will swap on every turn (thrash) — inefficient but **correct**: each turn re-asserts its model and self-heals. This also defends against *other processes* sharing the same LM Studio instance evicting our model out from under us — the per-request check re-loads it. (The rejected session-init approach swapped once at init and would silently break mid-session if anything evicted the model later.) The small `GET /api/v1/models` per request is single-digit ms locally — accepted.

## Other wiring
- **Load button** (`configurationRoutes.ts:266`): also route through `ensureModelReady(...)`. Add `autoSwapModel` to the request body; frontend passes `conn.autoSwapModel`. Fast-follow — the gateway path delivers the core CLI/MCP value.
- **Preflight** (`/api/sessions/preflight`): with `autoSwap` on, the `409 model_not_loaded` is wrong (the first turn will swap it in). Skip the loaded-model 409 for auto-swap connections. Preflight reads live config already, so this is a simple lookup.

## Schema / frontend changes
- `providerConnectionSchema`: add `autoSwapModel: z.boolean().optional().default(false)`. Per [[db-no-backwards-compat]], optional-with-default avoids a migration; confirm whether the DB needs a reset.
- Frontend: add the toggle to `LmConnectionForm.svelte`, **shown only for `providerType === "lmstudio"`**; thread through `connectionStore`. No `modelProfileSnapshot` / session-side changes.

---

# Notes / relationships

- **Relationship to [[model-load-recovery]] candidate.** That feature is the *manual* path (a dialog offering "load / unload-then-load" when a model isn't loaded). Auto-swap is the *automatic* path. Complementary: auto-swap off → recovery dialog; auto-swap on → silent swap. The preflight change here must not conflict with the recovery dialog.
- **Context size.** Pass the model config's `contextSize` to `loadModel` so the swapped-in model loads with the right window. The decorator has `body` (which may carry `num_ctx`) and the connection; resolve context the same way the load route does.
- **`autoSwap` off does nothing new** — no explicit load, no unload. That stays the recovery-dialog feature's job. Auto-swap is strictly the unload-then-load behavior.

# Suggested implementation slices
1. Connection schema `autoSwapModel` + central `ensureModelReady` (no-op for non-lmstudio / autoSwap-off) + per-`baseUrl` lock.
2. `withAutoModelSwap` gateway decorator wired in `app.ts` + preflight 409-skip (core CLI/MCP value).
3. Frontend connection toggle (lmstudio-only).
4. Load-button route wiring (fast-follow).
5. Tests — central function unit tests (already-loaded no-op, swap, multi-loaded unload, non-lmstudio no-op, autoSwap-off no-op) and a decorator test (swap invoked before delegate, lock serializes concurrent calls). Per [[testing-philosophy]], test the contract boundary, not provider internals.
