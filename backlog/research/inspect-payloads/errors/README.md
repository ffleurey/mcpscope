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

## Inspection gaps the error payloads exposed — all resolved (Phase 2)

Error inspection was the weakest surface; these four findings are now fixed:

1. **The text renderer dropped `latest_error` (F8).** ✅ Fixed in Phase 1: an errored step
   now renders `error  <kind>: <message>` (e.g. `error  json_parse_error: Judge response
   was not valid JSON`).

2. **A primary session exposed no top-level status/error (F9).** ✅ Fixed: every session
   payload now carries a top-level **`terminal_status`** (rendered as `status`), and when
   it is `error` the header shows the failure reason — for a primary session, the trailing
   `diagnostic` part's stop reason is surfaced there. `N8GF` now reads `status error` +
   `error  Turn stopped: reached the maximum of 20 tool-call rounds…` from the header.

3. **Failure was exposed inconsistently across session kinds (F10).** ✅ Fixed: the same
   `terminal_status` + failure-summary path runs for primary, analysis, and judge sessions.
   `N8GF` (primary, diagnostic part) and `E5TS` (judge, `json_parse_error`) now present an
   identical header shape.

4. **An evaluation's partial-ness was only visible by comparing two numbers (F11).** ✅
   Fixed: the evaluation payload carries an explicit **`incomplete`** flag and renders
   `judged 20/22  ⚠ incomplete`, marking `overall_pct` provisional.

## New object detail discovered here

- **`diagnostic` part type (`-DN`)** — not seen in the success traces; it is the canonical
  carrier of a turn's stop reason (`context_state: excluded`, `token_count: null`). Now
  documented as a part subtype in [`../part/README.md`](../part/README.md).
