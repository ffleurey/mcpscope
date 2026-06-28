# Inspect payload — findings register

The single tracked list of findings from this investigation. The per-type READMEs,
[`formats.md`](formats.md), [`use-cases.md`](use-cases.md), and [`errors/`](errors/) hold
the narrative + evidence; **this file is the triage register** we work from in the
decision phase. Severity = impact on core use-cases × cheapness of fix.

Legend — **Area:** FMT (format/efficiency) · GRAN (summary/full dial) · ERR (error
inspection) · COV (coverage) · DOC (hygiene). **Sev:** 🔴 high · 🟡 medium · ⚪ low.

> **Implemented (Phase 1 refactor, 2026-06-27):** the serializer architecture is in.
> Rendering is now a backend domain feature (`backend/src/inspect/renderInspect.ts`)
> consumed by CLI + MCP + API via a `format: text|json` param (text default). This
> **resolves F1, F2, F8, F15, F16** and the safe direction of **F4** (text ⊆ json by
> construction + a coverage test for the rest: `renderInspect.coverage.test.ts` +
> `omissionAllowList.ts`). Benchmark `B-`/`R-`/`E-` payloads were **redesigned**
> (drill-oriented; F5/F12 addressed for those types). Remaining open: the GRAN/content
> items below for runtime + the deferred Phase-2 content critique.

| ID | Area | Sev | Finding | Evidence | Proposed direction |
|----|------|-----|---------|----------|--------------------|
| **F1** | FMT | 🔴 | **MCP has no text option** — it returns `JSON.stringify` in `content` *and* the same object again in `structuredContent`. The readable text view is CLI-only. | [`server.ts:46-54`](../../../backend/src/mcp/server.ts) | Add a content-identical `format: text\|json` param on both surfaces; decide whether to keep `structuredContent` (double-encode). |
| **F2** | FMT/COV | 🔴 | **No CLI text renderer for benchmark types** (`B-`/`R-`/`E-`) — they dump raw JSON. These are the report/compare payloads. | [`cli/.../inspect.ts:235-256`](../../../cli/src/commands/inspect.ts); [`benchmark-run/example-R-RZNP.md`](benchmark-run/example-R-RZNP.md) | Build text/table renderers; measure (expected to mirror the session win). |
| **F3** | FMT | 🔴 | **JSON costs 2.8–3.1× the tokens of text** for tree/overview payloads (session 2.79×, turn 3.10×); ~1.0× for leaf content. The reads agents repeat most are the most over-priced. | [`formats.md`](formats.md) §3; [`_measurements/token-efficiency.tsv`](_measurements/token-efficiency.tsv) | Default model-facing navigation payloads to log-style text. |
| **F4** | FMT | 🟡 | **CLI text is a lossy projection of the JSON** (drops `token_source`, `token_confidence`, `owner_step_id`, `parent_ref`, …) — so "text vs JSON" is not yet content-identical, violating the design constraint. | [`formats.md`](formats.md) §2 | Define one canonical info-set per payload; render identically; drop graph-plumbing from both. |
| **F5** | GRAN | 🟡 | **`summary` is a no-op for parts, `B-`, `B-.N`, `E-`.** Parts are hard-coded full; `B-`/`B-.N` ignore mode; `E-` returns the full scored grid in both modes (byte-identical but for the echoed `mode`). Only runtime containers + `R-` have a real dial. | [`hierarchicalLookup.ts:732`](../../../backend/src/runtime/hierarchicalLookup.ts); [`benchmarkOperations.ts:307-348`](../../../backend/src/operations/benchmarkOperations.ts); [`benchmark-evaluation/example-E-FE7K-complete.md`](benchmark-evaluation/example-E-FE7K-complete.md) | Decide per type: give `E-` a genuinely lean summary (`overall_pct` + completeness); decide if `B-`/`B-.N` need one. |
| **F6** | FMT/COV | 🟡 | **Full content only reachable by direct part lookup:** tool-definition *schemas* (every container shows names only — even full setup) and tool *results* (overviews cap args at 80 chars, no result). A "full" session/setup is not "everything". | [`hierarchicalLookup.ts:169-208`](../../../backend/src/runtime/hierarchicalLookup.ts); [`setup/README.md`](setup/README.md) | Document explicitly in the payload; consider a hint pointing to the drillable part IDs. |
| **F7** | GRAN | ⚪ | **Round full-lookup does not expand its own tool result** — you still must inspect the `tool_call` part. | [`hierarchicalLookup.ts:182-208,699-705`](../../../backend/src/runtime/hierarchicalLookup.ts); [`round/README.md`](round/README.md) | Consider expanding tool results for a (narrow, deliberate) round request. |
| **F8** | ERR | 🔴 | **The text renderer drops `latest_error`** — an errored step shows only `… error`, never the reason (`json_parse_error`, "Judge response was not valid JSON"). The most important field for error inspection is invisible in text. | [`errors/example-judge-session-error-E5TS.md`](errors/example-judge-session-error-E5TS.md); `renderGenericStep` in [`cli/.../inspect.ts`](../../../cli/src/commands/inspect.ts) | Render `latest_error` (kind + message) on failed steps. Cheap, high value. |
| **F9** | ERR | 🟡 | **A primary session exposes no top-level status/error** — you can't tell from the header it failed; the reason lives on a turn step + a trailing `diagnostic` part (turn `latest_error` was even `null`). | [`errors/example-primary-session-error-N8GF.md`](errors/example-primary-session-error-N8GF.md) | Surface a terminal status + failure summary on the session payload. |
| **F10** | ERR | 🟡 | **Failure is exposed inconsistently across session kinds** — analysis/judge sessions carry top-level `latest_error`; primary sessions don't. | F8 + F9 examples | One uniform "how did this session end and why" field. |
| **F11** | ERR | ⚪ | **An evaluation's score doesn't flag its own incompleteness** beyond a `judged < expected` count mismatch; `overall_pct` is computed over the partial set with no provisional marker. | [`benchmark-evaluation/example-E-2BPM-error.md`](benchmark-evaluation/example-E-2BPM-error.md) | Mark the score provisional when `status:error` / incomplete. |
| **F12** | GRAN | 🟡 | **Run `summary` embeds the full case rubric** — heavy for a comparison that only needs config + IDs + status. | [`benchmark-run/README.md`](benchmark-run/README.md); [`use-cases.md`](use-cases.md) UC-5 | A leaner run summary tuned for "compare many runs". |
| **F13** | COV | ⚪ | **No internal agent inspects compaction/deterministic steps** — rich payload (`stripped_parts` + reasons), no consumer drives it; purely a UI/dev affordance. | [`step/README.md`](step/README.md) | Decide whether to invest in step inspection or leave UI-only. |
| **F14** | DOC | ⚪ | **Doc/code drift:** an older design doc says the judge seeds from `short=true`; the shipped prompt says "default, not short". | [`completed/benchmark-llm-evaluation-v1.md`](../../completed/benchmark-llm-evaluation-v1.md) vs [`benchmarkEvaluation/systemPrompt.ts:22`](../../../backend/src/analysis/benchmarkEvaluation/systemPrompt.ts) | Reconcile the doc to shipped behaviour. |
| **F15** | MCP | 🟡 | **MCP payload double-encoding** — `content` (JSON string) + `structuredContent` (object) means a client reading both pays for the payload twice. | [`server.ts:46-54`](../../../backend/src/mcp/server.ts) | Decide a single canonical channel per format. |
| **F16** | FMT/ARCH | 🔴 | **Text is a second, independent traversal in the CLI package** — it re-reads `data` and hand-picks fields, so it can never be guaranteed equivalent to JSON; it is the structural root cause of F2/F4/F8. The payload builders (`build*Node` / `*ToSnake`) are untyped and split across two families with no shared contract. | [`cli/.../inspect.ts:143-217`](../../../cli/src/commands/inspect.ts); [`hierarchicalLookup.ts:139-221`](../../../backend/src/runtime/hierarchicalLookup.ts) | Adopt the serializer pattern in [`serialization-architecture.md`](serialization-architecture.md): one typed, context-aware `InspectNode` builder per type; per-type text formatters whose **only input is the node** (→ text ⊆ json by construction, killing fabrication/drift); free per-type layout; a coverage test + reviewed omission allow-list for the json ⊆ text direction. Fixes F1/F2/F4/F8. |

## Themes for the decision phase

1. **Format & efficiency (F1–F4, F15, F16)** — the biggest lever: a content-identical
   `format` param, text-default for navigation, build benchmark renderers, fix double-encode.
   **F16 is the enabling refactor** — the serializer pattern
   ([`serialization-architecture.md`](serialization-architecture.md)) makes F1/F2/F4/F8
   fall out by construction rather than being fixed one renderer at a time.
2. **Granularity that actually splits (F5, F7, F12)** — make `summary` mean "cheap" for
   every type that claims to have it, or drop the claim.
3. **Error inspection (F8–F11)** — currently the weakest surface; F8 is the cheapest
   high-value fix in the whole register.
4. **Reachability & coverage (F6, F13)** — make "what's full vs drillable" legible.
