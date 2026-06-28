# inspect: error & non-success scenarios

Inspecting **failed** runs is at least as important as inspecting successful ones — and,
because failures here are usually driven by **non-determinism** (the same case passes on
other repetitions), the completed run `R-RZNP` gave us real, naturally-occurring errors to
study. This folder captures them and the inspection gaps they expose. It is a *cross-cutting*
folder: the errors live on `session`, `step`, `part`, and `benchmark_evaluation` objects,
documented per-type elsewhere but collected here for the error use-case.

## The error landscape in run `R-RZNP`

| Where | Object | What | Example |
|---|---|---|---|
| Primary session | `N8GF` (also `U7WR`, `39RT`) | model looped to the 20-round cap, no final answer | [`example-primary-session-error-N8GF.md`](example-primary-session-error-N8GF.md) |
| Failure marker | part `N8GF.1T.21.1-DN` | `diagnostic` part stating the stop reason | [`../part/example-diagnostic.md`](../part/example-diagnostic.md) |
| Judge session | `E5TS` (also `ETTB`) | judge model returned invalid JSON (`json_parse_error`) | [`example-judge-session-error-E5TS.md`](example-judge-session-error-E5TS.md) |
| Evaluation pass | `E-2BPM` | `status:error`, `judged 20/22` — incomplete | [`../benchmark-evaluation/example-E-2BPM-error.md`](../benchmark-evaluation/example-E-2BPM-error.md) |

## Use-case: "why did this fail, and was it the model, the server, or the harness?"

The error-inspection fetch path:

1. **Run report (`R-` full)** → per-session metrics flag which reps have `terminal_status:
   error`. (Single fetch localises the failures.)
2. **The failed session (`inspect <session>`)** → read the trace to the end. For a primary
   session the stop reason is the trailing **`diagnostic`** part. For a judge/analysis
   session the reason is the **`latest_error`** on the failed step.
3. **The errored step / diagnostic part** → the exact `error_kind` + message.

This separates failure causes: a `diagnostic` "reached max tool rounds" is a *model/harness
budget* issue; a judge `json_parse_error` is a *judge-model capability* issue (a small model
that can't hold the JSON contract); a tool error inside a round is a *server* issue.

## ⚠️ Inspection gaps the error payloads expose

These are concrete tuning findings — error inspection is where the current payloads are
weakest:

1. **The text renderer drops `latest_error`.** An errored step renders as just
   `… analysis_benchmark_evaluation  error` — the *reason* (`json_parse_error`, "Judge
   response was not valid JSON") is in the JSON but **invisible in text**
   ([`cli/src/commands/inspect.ts` `renderGenericStep`](../../../../cli/src/commands/inspect.ts)).
   For error inspection this is the single most important field. **High-priority fix.**

2. **A primary session exposes no top-level status/error.** You cannot tell from the
   session header that `N8GF` failed; the `status:error` lives on the turn step and the
   reason on the trailing `diagnostic` part. The session payload should surface a terminal
   status / failure summary so a failure is visible without reading the whole trace.

3. **Failure is exposed inconsistently across session kinds.** Analysis/judge sessions
   carry a top-level `latest_error`; primary sessions do not (turn-step `latest_error` was
   even `null` while the real reason sat in a `diagnostic` part). One uniform "how did this
   session end and why" field would make error inspection predictable.

4. **An evaluation's partial-ness is only visible by comparing two numbers.**
   `E-2BPM` reports an `overall_pct` *and* `status:error` / `judged 20/22`. The score is
   over an incomplete set; nothing in the payload flags the headline number as provisional
   beyond the count mismatch. Worth an explicit "incomplete" marker on the score.

## New object detail discovered here

- **`diagnostic` part type (`-DN`)** — not seen in the success traces; it is the canonical
  carrier of a turn's stop reason (`context_state: excluded`, `token_count: null`). Now
  documented as a part subtype in [`../part/README.md`](../part/README.md).
