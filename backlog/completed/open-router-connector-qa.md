It seems that our Open Router connection is not working. we might have some regressions.

We should do some testing with ddifferent models and check that model configuration, testing and usage works as it should.

TODO: start with a full test of what we have to figure out where we stand.

---

# Status: completed (2026-06-27)

QA of the OpenRouter connector found two real regressions (both fixed) and confirmed chat, judging, and tool-calling all work across the configured paid models (`openai/gpt-4o-mini`, `google/gemini-2.5-flash-lite`, `moonshotai/kimi-k2.5`, `xiaomi/mimo-v2.5`). A "temperature optional / provider default" feature was also implemented in the same branch.

## Where we stood
- Connection test + model discovery (`/api/lm-connections/test`, `/models`, OpenRouter `listUserModels`) already worked.
- Plain chat already worked for all paid models.
- The original "not working" report was the result of two bugs below, surfaced once OpenRouter models were used for **analysis/judge** and **tool-calling** sessions (the prior config had zero OpenRouter model configs, so those paths had never run).

## Bugs found and fixed
1. **Analysis/judge snapshot missing `providerType`** (`operations/launchAnalysis.ts`). Without it, `buildReasoningParams` fell back to the LM Studio format (`reasoning: "on"`); OpenRouter/Ollama reject that with a 400 (`"reasoning: expected object, received string"`), so any analysis/judge session on those providers with reasoning enabled failed init. Fixed by propagating `providerType` like regular sessions do.
2. **Token probe not resilient to OpenRouter 400s** (`runtime/promptTokenProbing.ts`). The probe sends `max_tokens: 1`; OpenRouter/OpenAI return a hard 400 (`"max_tokens ... reached"`) when the prompt would trigger a tool call, instead of a truncated 200 like LM Studio. The throw wasn't caught — one root cause behind two symptoms: (a) tool-enabled OpenRouter sessions failed init when the tool-definitions probe elicited a tool call; (b) multi-round tool turns errored at round 2+, because the post-round attribution probe (tool result in context) reliably elicits the next tool call and 400s, killing the turn before the round was recorded. Fixed by degrading to the text estimate on probe failure for OpenRouter (best-effort token accounting must never abort a session/turn); other providers keep fail-fast.

## Temperature optional (provider default) — shipped in the same branch
Temperature is now optional across model configs, analysis launches, and judge/eval runs; when unset, the request omits `temperature` so the provider uses its own default (mirrors `contextSize`; gated on `!= null` since 0 is valid). Judge `judge_temperature` column made nullable (`SCHEMA_VERSION` 5 → 6, fresh DB). CLI `benchmark_evaluate --temperature` is optional (omit ⇒ provider default). Frontend forms gained a "Provider default / Custom…" control.

## Verification
- Full verify gate green (305 tests, +6 new across the temperature + probe changes); typecheck/lint/format clean.
- Live, against real paid OpenRouter models: all 4 models answered plain chat with `temperature` omitted; a provider-default judge scored a run 2/2; `gpt-4o-mini + ha-replay` now inits; `gpt-4o-mini + meteo` ran a full 3-round geocode → forecast → answer turn.

See branch `open-router-connector-qa` for the commits.
