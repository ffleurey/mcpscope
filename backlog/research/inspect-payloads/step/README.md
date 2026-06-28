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
  ([`hierarchicalLookup.ts`](../../../../backend/src/runtime/hierarchicalLookup.ts)).
  **Resolved (F8):** the text renderer now prints it — an errored step shows
  `error  <kind>: <message>` (e.g. `error  json_parse_error: Judge response was not valid
  JSON`). See the worked example in
  [`../errors/example-judge-session-error-E5TS.md`](../errors/example-judge-session-error-E5TS.md).

## Dog-fooding evidence

- **None.** No system prompt drives an internal agent (analysis or judge) into a `C`/`W`
  step. Step inspection is purely a developer / UI affordance today — an asymmetry vs.
  every other runtime type where dog-fooding evidence is explicit. (See top-level
  finding #6.) This is the cleanest "rich payload, no consumer" gap to weigh in tuning.

## Tuning notes (Phase 2)

- The summary→full split here is genuinely useful (IDs only vs. annotated reasons) and is
  a good model — **kept as-is.**
- **F13 decided:** no internal agent drives step inspection today, but the payload is
  correct and cheap and the GUI/developer use it. Decision: **leave it UI/dev-only; do not
  build a consumer now.** Revisit only if a workflow needs to audit compaction
  programmatically.
- **Content pass — kind-specific fields gated.** The dead `workflow_kind`/`workflow_label`
  null fields were removed; the compaction accounting (`strategy`, `source_turn_*`,
  `context_tokens_*`, `tokens_removed`, `stripped_*`) is emitted **only for compaction
  steps**, and the turn-owning fields (`owned_turn_ids`/`turns`/`postamble_step_ids`) only for
  analysis steps that actually own turns — so neither kind is padded with the other's
  null/empty fields. `parts` stays always-present (the step-level parallel to a turn's
  `rounds`).
- **Owned turns now render in text.** An analysis step owns the agent/judge's turn(s); the
  renderer used to drop them, so an analysis-session inspect showed only step headers (the
  judge's tool calls + verdict were invisible). Fixed — see
  [`../session/example-ZTJE-analysis-session.md`](../session/example-ZTJE-analysis-session.md).
