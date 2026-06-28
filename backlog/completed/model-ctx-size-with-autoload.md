# Model context size ignored on auto-load

**Status:** Fixed.

## Original report

> Check and fix model loading. I have the impression that when we load the models
> we do not necessarily get the correct requested context size. Maybe a side
> effect of having the "default" temperature and the logic we made to auto eject
> and load models, but I observed that the model which was set to be 32k ctx was
> loaded with only 8k.

## Root cause

LM Studio fixes `context_length` at **load** time and ignores `num_ctx` in the
request body. mcpscope never loads explicitly — the model auto-loads on the
**first request**, which is the token probe during session init
(`sessionPrelude.ts`). Two defects compounded:

1. **The probe didn't carry `num_ctx`.** `buildProbeBody`
   (`runtime/promptTokenProbing.ts`) spread `sessionTemperatureBody` + reasoning
   params but **not** `sessionContextBody`. So the load-triggering request had no
   context size → `withAutoModelSwap` passed `contextSize: undefined` →
   `loadModel` omitted `context_length` → LM Studio picked its own default
   (8192 under VRAM pressure, 65496 when free — never the configured 32768).
   The early-return in `ensureModelReady` ("single loaded model == target →
   no-op") then meant later chat turns (which *do* send `num_ctx`) never
   triggered a corrective reload, so the wrong size stuck for the whole session.
   (Temperature was a red herring — it was always sent and is unrelated.)

2. **Reported `loadedContextLength` was a config echo, not reality.**
   `ensureSessionPreludeTokenMetadata` captured the loaded size **before** the
   probe loaded the model, so the authoritative `getLoadedContextLength` returned
   null and the fallback echoed the configured `contextSize`. mcpscope therefore
   reported 32768 while the model was really at 8192/65496 — masking the bug and
   corrupting context-budget/compaction/exhaustion accounting. Visible across
   many benchmark runs that recorded `loaded_context_length: 8192` for a 32768
   config.

## Fix

1. `buildProbeBody` now includes `...sessionContextBody(session)` so the first
   (load-triggering) request carries `num_ctx`.
2. `ensureModelReady` (`services/provider/modelLoading.ts`) reloads the target
   when it is already resident at a different context size than requested
   (compares `loadedContextLength` vs `contextSize`; null/unknown is left alone).
3. `ensureSessionPreludeTokenMetadata` captures `loadedContextLength` **after**
   probing, preferring the authoritative `getLoadedContextLength`; the
   config-echo fallback only fills a still-empty value and never overwrites a
   real reading.

## Verification (live, LM Studio Local, auto-swap on)

- **Fresh load** of `gemma-4-e4b` (config 32768): loaded at **32768** (was 65496).
- **Swap** to `gemma-4-12b-qat` (config 32768): evicted e4b, loaded at **32768**
  (this is the benchmark model that was running at 8192).
- **Reload-on-mismatch**: manually loaded e4b at 8192, then started a session →
  reloaded to **32768**; stayed 32768 through a real turn.
- mcpscope's reported context now matches the real loaded value in every case.

Tests: added three cases to `modelLoading.test.ts` (reload on mismatch, no-op
when sizes match, no-op when loaded size unknown). Full runtime + services
suites green.
