# inspect: deterministic `step` (`SSS.NW` / `SSS.CN`)

**What it is:** a non-turn execution unit in the session's ordered step list. The shipped
concrete case is **compaction** (e.g. `strip-reasoning`), which records which parts it
stripped from future context
([`hierarchicalLookup.ts:321-376,449-488`](../../../../backend/src/runtime/hierarchicalLookup.ts);
[`DATA-MODEL.md:23,239`](../../../../DATA-MODEL.md)). Turns are also "steps" but are
documented separately under [`turn/`](../turn/).

Example: [`example-9LJM-compaction.md`](example-9LJM-compaction.md) (a `strip-reasoning`
compaction after turn 1).

## Summary mode — use-cases

- **"How much context did compaction reclaim, and which parts went away?"** — summary
  returns the bare `stripped_part_ids` list plus the accounting fields
  (`context_tokens_before` / `context_tokens_after` / `tokens_removed`)
  ([`hierarchicalLookup.ts:342-353`](../../../../backend/src/runtime/hierarchicalLookup.ts)).

## Full mode — use-cases

- **Audit *why* a part is no longer in model-visible context** — full returns the
  enriched `stripped_parts` array: each part's `type`, `token_count`, `round_id`, and a
  human-readable `reason` (e.g. "Removed from future context because strip-reasoning
  compaction excludes assistant reasoning parts")
  ([`hierarchicalLookup.ts:354-375`](../../../../backend/src/runtime/hierarchicalLookup.ts)).
  The CLI renderer collapses the shared reason to one line
  ([`cli/src/commands/inspect.ts:105-127`](../../../../cli/src/commands/inspect.ts)).
- Steps also carry an embedded `latest_error` diagnostic for failed analysis steps
  ([`hierarchicalLookup.ts:442-457`](../../../../backend/src/runtime/hierarchicalLookup.ts)).
  **⚠️ But the CLI text renderer drops it** — an errored step shows as just
  `… analysis_benchmark_evaluation  error`, with no reason. The `latest_error`
  (`error_kind` + message) is only in the JSON. See the worked example in
  [`../errors/example-judge-session-error-E5TS.md`](../errors/example-judge-session-error-E5TS.md).
  This is a high-priority error-inspection gap.

## Dog-fooding evidence

- **None.** No system prompt drives an internal agent (analysis or judge) into a `C`/`W`
  step. Step inspection is purely a developer / UI affordance today — an asymmetry vs.
  every other runtime type where dog-fooding evidence is explicit. (See top-level
  finding #6.) This is the cleanest "rich payload, no consumer" gap to weigh in tuning.

## Tuning notes

- The summary→full split here is genuinely useful (IDs only vs. annotated reasons) and is
  a good model. The open question is whether anything *reads* it beyond the UI.
